import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { PersistenceClient, RenderJob } from "@studynarrator/shared-types";
import { queryKeys } from "@/app/queryKeys.js";
import {
  readViewedRenders,
  storeViewedRenders,
} from "@/services/renders/renderActivityStore.js";
import type { RenderProgressClient } from "@/services/renders/renderClient.js";

type RenderActivityClient = Pick<
  RenderProgressClient,
  "get" | "list" | "listArtifacts" | "subscribe"
>;
type RenderActivityPersistence = {
  projects: Pick<PersistenceClient["projects"], "list">;
};

export const terminalRenderStates = new Set<RenderJob["state"]>([
  "complete",
  "failed",
  "canceled",
]);

const renderPhaseLabels: Record<RenderJob["state"], string> = {
  queued: "Queued…",
  validating: "Validating render…",
  synthesizing: "Synthesizing audio…",
  assembling: "Assembling audio…",
  normalizing: "Normalizing audio…",
  encoding: "Encoding MP3…",
  writing_artifacts: "Writing render files…",
  complete: "Render complete",
  failed: "Render failed",
  canceled: "Render canceled",
};

export function renderProgressLabel(job: RenderJob): string {
  if (job.state !== "synthesizing" || job.progress.totalChunks === 0)
    return renderPhaseLabels[job.state];
  const current = Math.min(
    job.progress.totalChunks,
    job.progress.completedChunks + 1,
  );
  return `Processing chunk ${String(current)} of ${String(job.progress.totalChunks)}`;
}

interface ProjectRenderActivity {
  projectName: string;
  jobs: RenderJob[];
  unavailable: string[];
}

interface ActiveProjectRender {
  projectName: string;
  job: RenderJob;
}

interface RenderActivityContextValue {
  active: ActiveProjectRender[];
  unviewed: ActiveProjectRender[];
  markViewed: (job: RenderJob) => void;
  projects: Record<string, ProjectRenderActivity>;
  track: (job: RenderJob, projectName?: string) => void;
}

const Context = createContext<RenderActivityContextValue | null>(null);

function upsertJob(jobs: RenderJob[], job: RenderJob): RenderJob[] {
  return [job, ...jobs.filter(({ id }) => id !== job.id)];
}

function RenderWatcher({
  renderClient,
  renderId,
  updateJob,
}: {
  renderClient: RenderActivityClient;
  renderId: string;
  updateJob: (job: RenderJob) => void;
}) {
  useEffect(() => {
    let active = true;
    let polling = !renderClient.subscribe;
    let inFlight = false;
    let timer: number | undefined;
    let streamedRevision = 0;
    const poll = async () => {
      if (!active || !polling || inFlight) return;
      inFlight = true;
      const revision = streamedRevision;
      try {
        const job = await renderClient.get(renderId);
        if (active && revision === streamedRevision) {
          if (terminalRenderStates.has(job.state)) polling = false;
          updateJob(job);
        }
      } catch {
        // Keep the last known state until the service is reachable again.
      } finally {
        inFlight = false;
        if (active && polling)
          timer = window.setTimeout(() => void poll(), 500);
      }
    };
    const unsubscribe = renderClient.subscribe?.(
      renderId,
      (job) => {
        if (!active) return;
        streamedRevision += 1;
        polling = false;
        window.clearTimeout(timer);
        updateJob(job);
      },
      () => {
        if (!active || polling) return;
        polling = true;
        void poll();
      },
    );
    if (!renderClient.subscribe)
      timer = window.setTimeout(() => void poll(), 500);
    return () => {
      active = false;
      window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, [renderClient, renderId, updateJob]);

  return null;
}

export function RenderActivityProvider({
  children,
  persistence,
  renderClient,
}: {
  children: ReactNode;
  persistence: RenderActivityPersistence;
  renderClient?: RenderActivityClient;
}) {
  const projectsQuery = useQuery({
    queryKey: queryKeys.persistence.projects(),
    queryFn: () => persistence.projects.list(),
    enabled: Boolean(renderClient),
    retry: false,
  });
  const [projects, setProjects] = useState<
    Record<string, ProjectRenderActivity>
  >({});

  const [viewed, setViewed] = useState(readViewedRenders);
  const projectsRef = useRef(projects);
  const viewedRef = useRef(viewed);
  projectsRef.current = projects;
  viewedRef.current = viewed;
  useEffect(() => storeViewedRenders(viewed), [viewed]);
  const markViewed = (job: RenderJob) => {
    if (terminalRenderStates.has(job.state))
      setViewed((current) => new Set([...current, job.id]));
  };

  const track = useCallback((job: RenderJob, projectName?: string) => {
    setProjects((current) => {
      const project = current[job.projectId];
      if (!project && !projectName) return current;
      return {
        ...current,
        [job.projectId]: {
          projectName: projectName ?? project!.projectName,
          jobs: upsertJob(project?.jobs ?? [], job),
          unavailable: project?.unavailable ?? [],
        },
      };
    });
  }, []);

  useEffect(() => {
    if (!renderClient || !projectsQuery.data) return;
    let active = true;
    let inFlight = false;
    let timer: number | undefined;
    const reconcile = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      window.clearTimeout(timer);
      const before = projectsRef.current;
      const viewedBefore = viewedRef.current;
      const loaded = await Promise.all(
        projectsQuery.data.map(async (project) => {
          try {
            const jobs = await renderClient.list(project.id);
            const unavailable = new Set(before[project.id]?.unavailable);
            await Promise.all(
              jobs.map(async (job) => {
                if (job.state !== "complete" || viewedRef.current.has(job.id))
                  return;
                try {
                  const artifacts = await renderClient.listArtifacts(job.id);
                  if (artifacts.some(({ type }) => type === "mp3"))
                    unavailable.delete(job.id);
                  else unavailable.add(job.id);
                } catch {
                  // An unavailable service does not prove that audio was removed.
                }
              }),
            );
            return {
              project,
              jobs,
              unavailable: [...unavailable].filter((id) =>
                jobs.some((job) => job.id === id),
              ),
            };
          } catch {
            return { project };
          }
        }),
      );
      if (!active) return;
      setProjects((current) =>
        Object.fromEntries(
          loaded.flatMap(({ project, jobs, unavailable }) => {
            const existing = current[project.id];
            if (!jobs)
              return existing
                ? [[project.id, { ...existing, projectName: project.name }]]
                : [];
            const previous = new Map(
              before[project.id]?.jobs.map((job) => [job.id, job]),
            );
            const merged = new Map(jobs.map((job) => [job.id, job]));
            // A history response must not overwrite progress received while it was loading.
            for (const job of current[project.id]?.jobs ?? [])
              if (job !== previous.get(job.id)) merged.set(job.id, job);
            return [
              [
                project.id,
                {
                  projectName: project.name,
                  jobs: [...merged.values()].sort((left, right) =>
                    right.createdAt.localeCompare(left.createdAt),
                  ),
                  unavailable: unavailable ?? [],
                },
              ],
            ];
          }),
        ),
      );
      if (loaded.every(({ jobs }) => jobs)) {
        const knownIds = new Set(
          loaded.flatMap(({ jobs }) => jobs!.map(({ id }) => id)),
        );
        // Preserve a viewed result that arrived during this reconciliation.
        setViewed((current) => {
          const retained = new Set(
            [...current].filter(
              (id) => knownIds.has(id) || !viewedBefore.has(id),
            ),
          );
          return retained.size === current.size ? current : retained;
        });
      }
      inFlight = false;
      timer = window.setTimeout(() => void reconcile(), 10_000);
    };
    void reconcile();
    const onFocus = () => void reconcile();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [projectsQuery.data, renderClient]);

  const active = Object.values(projects)
    .flatMap(({ projectName, jobs }) =>
      jobs
        .filter(({ state }) => !terminalRenderStates.has(state))
        .map((job) => ({ projectName, job })),
    )
    .sort((left, right) =>
      left.job.createdAt.localeCompare(right.job.createdAt),
    );
  const unviewed = Object.values(projects)
    .flatMap(({ projectName, jobs, unavailable }) =>
      jobs
        .filter(
          (job) =>
            terminalRenderStates.has(job.state) &&
            !viewed.has(job.id) &&
            !unavailable.includes(job.id),
        )
        .map((job) => ({ projectName, job })),
    )
    .sort((left, right) =>
      right.job.createdAt.localeCompare(left.job.createdAt),
    );
  return (
    <Context value={{ active, unviewed, markViewed, projects, track }}>
      {children}
      {renderClient
        ? active.map(({ job }) => (
            <RenderWatcher
              key={job.id}
              renderClient={renderClient}
              renderId={job.id}
              updateJob={track}
            />
          ))
        : null}
    </Context>
  );
}

export function useRenderActivity(): RenderActivityContextValue {
  const value = useContext(Context);
  if (!value)
    throw new Error(
      "useRenderActivity must be used within RenderActivityProvider",
    );
  return value;
}
