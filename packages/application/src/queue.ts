import {
  RenderJobSchema,
  type RenderError,
  type RenderJob,
  type RenderProgress,
} from "@studynarrator/shared-types";
import type {
  SpeechCacheActivityGate,
  SpeechCacheActivityLease,
} from "@studynarrator/rendering";
import type { RenderRepository } from "./render.js";

const NONTERMINAL = new Set<RenderJob["state"]>([
  "queued",
  "validating",
  "synthesizing",
  "assembling",
  "normalizing",
  "encoding",
  "writing_artifacts",
]);

export interface RenderLifecycleLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

export interface RenderQueue {
  cancel(renderId: string): Promise<RenderJob>;
  close(): Promise<void>;
  enqueue(renderId: string): void;
  isClosing(): boolean;
  isNonterminal(state: RenderJob["state"]): boolean;
  isUserCanceled(renderId: string): boolean;
  recover(): Promise<void>;
  reserveActivity(): Promise<SpeechCacheActivityLease | undefined>;
  startForProject(
    projectId: string,
    start: () => Promise<RenderJob>,
  ): Promise<RenderJob>;
  subscribe(renderId: string, callback: (job: RenderJob) => void): () => void;
  trackActivity(
    renderId: string,
    activity: SpeechCacheActivityLease | undefined,
  ): void;
  update(
    job: RenderJob,
    state: RenderJob["state"],
    patch?: Partial<RenderProgress>,
    error?: RenderError | null,
  ): RenderJob;
}

export function createRenderQueue(options: {
  repository: RenderRepository;
  now: () => Date;
  logger: RenderLifecycleLogger;
  activityGate?: SpeechCacheActivityGate | undefined;
  execute(renderId: string, signal: AbortSignal): Promise<void>;
}): RenderQueue {
  const queue: string[] = [];
  const controllers = new Map<string, AbortController>();
  const subscribers = new Map<string, Set<(job: RenderJob) => void>>();
  const userCanceled = new Set<string>();
  const startingProjects = new Map<string, Promise<RenderJob>>();
  const activities = new Map<string, SpeechCacheActivityLease>();
  const reserveActivity = async (): Promise<
    SpeechCacheActivityLease | undefined
  > => await options.activityGate?.beginActivity();
  const releaseActivity = (renderId: string): void => {
    activities.get(renderId)?.release();
    activities.delete(renderId);
  };
  let draining = false;
  let closing = false;
  let drainPromise: Promise<void> = Promise.resolve();

  const enqueue = (renderId: string) => {
    if (!queue.includes(renderId)) queue.push(renderId);
    if (!draining && !closing) {
      draining = true;
      drainPromise = drain().finally(() => {
        draining = false;
      });
    }
  };

  const update = (
    job: RenderJob,
    state: RenderJob["state"],
    patch: Partial<RenderProgress> = {},
    error: RenderError | null = job.error,
  ): RenderJob => {
    const timestamp = options.now().toISOString();
    const startedAt = job.startedAt ?? (state === "queued" ? null : timestamp);
    const finishedAt = NONTERMINAL.has(state) ? null : timestamp;
    const elapsedMs = startedAt
      ? Math.max(0, Date.parse(timestamp) - Date.parse(startedAt))
      : 0;
    const next = RenderJobSchema.parse({
      ...job,
      state,
      error,
      startedAt,
      finishedAt,
      progress: { ...job.progress, ...patch, phase: state, elapsedMs },
    });
    const persisted = options.repository.updateRenderJob(next);
    if (!NONTERMINAL.has(persisted.state)) releaseActivity(persisted.id);
    if (job.state !== persisted.state)
      options.logger.info(
        {
          event: "render-phase-transition",
          renderId: persisted.id,
          projectId: persisted.projectId,
          fromPhase: job.state,
          toPhase: persisted.state,
        },
        "Render phase transitioned",
      );
    for (const subscriber of [...(subscribers.get(persisted.id) ?? [])]) {
      try {
        subscriber(persisted);
      } catch {
        // Observer failures must not interrupt the render or other observers.
      }
    }
    return persisted;
  };

  async function drain(): Promise<void> {
    while (!closing && queue.length > 0) {
      const renderId = queue.shift()!;
      const job = options.repository.getRenderJob(renderId);
      if (NONTERMINAL.has(job.state)) {
        const controller = new AbortController();
        controllers.set(renderId, controller);
        try {
          await options.execute(renderId, controller.signal);
        } finally {
          controllers.delete(renderId);
          userCanceled.delete(renderId);
        }
      }
    }
  }

  return {
    async cancel(renderId) {
      const job = options.repository.getRenderJob(renderId);
      if (!NONTERMINAL.has(job.state)) return await Promise.resolve(job);
      userCanceled.add(renderId);
      const queuedIndex = queue.indexOf(renderId);
      if (queuedIndex >= 0) {
        queue.splice(queuedIndex, 1);
        userCanceled.delete(renderId);
        return await Promise.resolve(update(job, "canceled", {}, null));
      }
      controllers
        .get(renderId)
        ?.abort(new DOMException("The render was canceled.", "AbortError"));
      return await Promise.resolve(options.repository.getRenderJob(renderId));
    },
    async close() {
      closing = true;
      for (const controller of controllers.values())
        controller.abort(
          new DOMException("StudyNarrator is shutting down.", "AbortError"),
        );
      try {
        await drainPromise;
      } finally {
        for (const renderId of activities.keys()) releaseActivity(renderId);
        subscribers.clear();
      }
    },
    enqueue,
    isClosing: () => closing,
    isNonterminal: (state) => NONTERMINAL.has(state),
    isUserCanceled: (renderId) => userCanceled.has(renderId),
    async recover() {
      for (const interrupted of options.repository.listRecoverableRenderJobs()) {
        const activity = await reserveActivity();
        const recovered = RenderJobSchema.parse({
          ...interrupted,
          state: "queued",
          error: null,
          startedAt: null,
          finishedAt: null,
          progress: { ...interrupted.progress, phase: "queued", elapsedMs: 0 },
        });
        options.repository.updateRenderJob(recovered);
        if (activity) activities.set(recovered.id, activity);
        enqueue(recovered.id);
      }
    },
    reserveActivity,
    async startForProject(projectId, start) {
      const starting = startingProjects.get(projectId);
      if (starting) return await starting;
      const promise = start().finally(() => startingProjects.delete(projectId));
      startingProjects.set(projectId, promise);
      return await promise;
    },
    subscribe(renderId, callback) {
      const listeners = subscribers.get(renderId) ?? new Set();
      listeners.add(callback);
      subscribers.set(renderId, listeners);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(callback);
        if (listeners.size === 0 && subscribers.get(renderId) === listeners)
          subscribers.delete(renderId);
      };
    },
    trackActivity(renderId, activity) {
      if (activity) activities.set(renderId, activity);
    },
    update,
  };
}
