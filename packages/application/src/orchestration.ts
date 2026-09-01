import {
  estimateCacheBytes,
  estimatePeakDiskBytes,
  estimatePlanDurationMs,
  type EstimablePlan,
} from "@studynarrator/core";
import {
  RENDER_CONTRACT_VERSION,
  RENDER_DISK_HARD_RESERVE_PERCENT,
  RENDER_DISK_SOFT_RESERVE_PERCENT,
  RenderEstimateContextInputSchema,
  RenderEstimateContextResultSchema,
  RenderIdSchema,
  RenderJobSchema,
  type RenderError,
  type RenderEstimateContextResult,
  type RenderJob,
  type RenderPlan,
  type RenderPlanEntry,
  type RenderProgress,
  type RenderSegment,
  type RenderStartOptions,
} from "@studynarrator/shared-types";
import type {
  RenderPlanStore,
  SpeechCacheActivityLease,
} from "@studynarrator/rendering";
import type { CachedSpeechSynthesis } from "./cachedSpeech.js";
import { sha256, type RenderArtifacts } from "./artifacts.js";
import type { RenderQueue, RenderLifecycleLogger } from "./queue.js";
import type { RenderRepository } from "./render.js";
import type { ComputedRenderPlan, RenderPlanComputer } from "./renderPlan.js";

interface RenderFileSystemStats {
  bavail: bigint;
  bsize: bigint;
}

type RenderStatfs = (path: string) => Promise<RenderFileSystemStats>;

type RenderDiskSpaceErrorFactory = (
  estimatedPeakBytes: number,
  freeSpaceBytes: bigint,
  usableBytes: bigint,
) => Error;

interface RenderOrchestration {
  execute(renderId: string, signal: AbortSignal): Promise<void>;
  getEstimateContext(input: unknown): Promise<RenderEstimateContextResult>;
  retry(renderId: string): Promise<RenderJob>;
  startProject(
    projectId: string,
    startOptions: RenderStartOptions,
  ): Promise<RenderJob>;
}

function initialProgress(plan: RenderPlan): RenderProgress {
  const speechCount = plan.entries.filter(
    ({ type }) => type === "speech",
  ).length;
  return {
    phase: "queued",
    sectionTitle: null,
    sectionOrdinal: 0,
    sectionCount: plan.summary.sectionCount,
    entryOrdinal: null,
    speechOrdinal: 0,
    speechCount,
    chunkOrdinal: null,
    completedChunks: 0,
    totalChunks: speechCount,
    cacheHits: 0,
    cacheMisses: 0,
    ttsRequests: 0,
    speakerId: null,
    voiceId: null,
    excerpt: null,
    elapsedMs: 0,
  };
}

function segment(renderId: string, entry: RenderPlanEntry): RenderSegment {
  return {
    renderId,
    ordinal: entry.ordinal,
    type: entry.type,
    state: "pending",
    cacheStatus: null,
    audioDurationMs: null,
    audioFileName: null,
    audioSizeBytes: null,
    audioChecksum: null,
    error: null,
  };
}

function safeRenderError(
  error: unknown,
  phase: RenderJob["state"],
  entry: RenderPlanEntry | null,
): RenderError {
  const aborted = error instanceof DOMException && error.name === "AbortError";
  const legacyConnectionUnavailable =
    error instanceof Error &&
    error.message ===
      "Legacy connection unavailable. Freeze this project again.";
  return {
    code: aborted
      ? "RENDER_ABORTED"
      : legacyConnectionUnavailable
        ? "RENDER_LEGACY_CONNECTION_UNAVAILABLE"
        : phase === "validating"
          ? "RENDER_VALIDATION_FAILED"
          : phase === "synthesizing"
            ? "RENDER_SYNTHESIS_FAILED"
            : phase === "assembling"
              ? "RENDER_ASSEMBLY_FAILED"
              : phase === "encoding"
                ? "RENDER_ENCODING_FAILED"
                : "RENDER_ARTIFACT_FAILED",
    message: aborted
      ? "The render operation stopped before completion."
      : legacyConnectionUnavailable
        ? "This render uses a legacy connection that is no longer available. Start a new render."
        : phase === "validating"
          ? "The saved render input no longer matches its configured speech endpoint."
          : phase === "synthesizing"
            ? "Speech generation failed for the current segment."
            : phase === "assembling"
              ? "The generated audio segments could not be assembled."
              : phase === "encoding"
                ? "The final MP3 could not be encoded or validated."
                : "The render artifact bundle could not be published.",
    retryable: !legacyConnectionUnavailable && phase !== "validating",
    phase,
    entryOrdinal: entry?.ordinal ?? null,
    chunkOrdinal: entry?.type === "speech" ? 1 : null,
    sourceRange: entry?.sourceRange ?? null,
    speakerId: entry?.type === "speech" ? entry.speakerId : null,
    voiceId: entry?.type === "speech" ? entry.voiceId : null,
  };
}

export function createRenderOrchestration(options: {
  repository: RenderRepository;
  plans: RenderPlanStore;
  speech: CachedSpeechSynthesis;
  dataDirectory: string;
  now: () => Date;
  createId: () => string;
  planComputer: RenderPlanComputer;
  logger: RenderLifecycleLogger;
  readFileSystemStats: RenderStatfs;
  createDiskSpaceError: RenderDiskSpaceErrorFactory;
  queue: RenderQueue;
  artifacts: RenderArtifacts;
}): RenderOrchestration {
  const recordVoiceTimingCalibration = (
    completed: RenderJob,
    plan: RenderPlan,
    modelId: string,
  ): void => {
    try {
      const speechEntries = new Map(
        plan.entries
          .filter((entry) => entry.type === "speech")
          .map((entry) => [entry.ordinal, entry]),
      );
      const samplesByVoice = new Map<string, { sum: number; count: number }>();
      for (const stored of options.repository.listRenderSegments(
        completed.id,
      )) {
        if (
          stored.type !== "speech" ||
          stored.state !== "complete" ||
          stored.audioDurationMs === null ||
          !Number.isFinite(stored.audioDurationMs) ||
          stored.audioDurationMs <= 0
        )
          continue;
        const entry = speechEntries.get(stored.ordinal);
        if (!entry) continue;
        const normalizedCharacters = entry.chunks[0]?.text.length ?? 0;
        if (normalizedCharacters === 0) continue;
        const sample =
          (stored.audioDurationMs * entry.speed) / normalizedCharacters;
        if (!Number.isFinite(sample) || sample <= 0) continue;
        const grouped = samplesByVoice.get(entry.voiceId) ?? {
          sum: 0,
          count: 0,
        };
        grouped.sum += sample;
        grouped.count += 1;
        samplesByVoice.set(entry.voiceId, grouped);
      }
      if (samplesByVoice.size === 0) return;
      const updatedAt = options.now().toISOString();
      for (const [voiceId, samples] of samplesByVoice) {
        const existing = options.repository.getVoiceTimingCalibration(
          modelId,
          voiceId,
        );
        const existingCount = existing?.sampleCount ?? 0;
        const sampleCount = existingCount + samples.count;
        if (sampleCount <= 0) continue;
        options.repository.upsertVoiceTimingCalibration({
          modelId,
          voiceId,
          millisecondsPerNormalizedCharacter:
            ((existing?.millisecondsPerNormalizedCharacter ?? 0) *
              existingCount +
              samples.sum) /
            sampleCount,
          sampleCount,
          updatedAt,
        });
      }
    } catch (error) {
      try {
        options.logger.error(
          {
            event: "render-calibration-failed",
            renderId: completed.id,
            projectId: completed.projectId,
            cause: {
              name: error instanceof Error ? "Error" : "UnknownError",
              code: "RENDER_CALIBRATION_FAILED",
            },
          },
          "Render calibration failed",
        );
      } catch {
        // Calibration and its diagnostics must never change render completion.
      }
    }
  };

  async function execute(renderId: string, signal: AbortSignal): Promise<void> {
    let job = options.repository.getRenderJob(renderId);
    let currentEntry: RenderPlanEntry | null = null;
    const stage = options.artifacts.stagePath(renderId);
    try {
      await options.artifacts.createStage(renderId);
      job = options.queue.update(job, "validating");
      options.logger.info(
        {
          event: "render-start",
          renderId: job.id,
          projectId: job.projectId,
        },
        "Render starting",
      );
      const jobBundle = await options.plans.loadJob(job.id);
      const { plan, snapshot, silenceAssets } = jobBundle;
      const connection = options.repository.getSpeechBackendConnection();
      if (
        !connection.baseUrl ||
        sha256(connection.baseUrl) !== snapshot.connection.serverIdentityHash
      )
        throw new Error("Frozen endpoint identity changed.");

      const orderedAudio: string[] = [];
      let speechOrdinal = 0;
      let sectionOrdinal = 0;
      for (const entry of plan.entries) {
        currentEntry = entry;
        if (signal.aborted)
          throw new DOMException("The operation was aborted.", "AbortError");
        if (entry.type === "section") {
          sectionOrdinal += 1;
          options.repository.updateRenderSegment({
            ...segment(renderId, entry),
            state: "skipped",
          });
          job = options.queue.update(job, "synthesizing", {
            sectionTitle: entry.title,
            sectionOrdinal,
            entryOrdinal: entry.ordinal,
          });
          continue;
        }
        if (entry.type === "pause") {
          if (!entry.silence) {
            options.repository.updateRenderSegment({
              ...segment(renderId, entry),
              state: "skipped",
              audioDurationMs: 0,
            });
          } else {
            const bytes = silenceAssets.get(entry.silence.checksum);
            if (!bytes || sha256(bytes) !== entry.silence.checksum)
              throw new Error("Frozen silence asset failed verification.");
            const output = await options.artifacts.writePauseAsset(
              stage,
              entry.ordinal,
              bytes,
            );
            orderedAudio.push(output);
            options.repository.updateRenderSegment({
              ...segment(renderId, entry),
              state: "complete",
              audioDurationMs: entry.durationMs,
            });
          }
          continue;
        }

        speechOrdinal += 1;
        job = options.queue.update(job, "synthesizing", {
          entryOrdinal: entry.ordinal,
          speechOrdinal,
          chunkOrdinal: 1,
          speakerId: entry.speakerId,
          voiceId: entry.voiceId,
          excerpt: entry.readableText.slice(0, 160),
          sectionTitle: entry.sectionTitle,
        });
        const result = await options.speech.synthesize({
          modelId: snapshot.connection.modelId,
          voiceId: entry.voiceId,
          speed: entry.speed,
          text: entry.ttsText,
          usage: { projectId: plan.projectId },
          signal,
        });
        if (result.key !== entry.chunks[0]?.cacheKey)
          throw new Error(
            "Synthesized cache identity did not match the frozen plan.",
          );
        const rendered = await options.artifacts.writeSpeechAudio(
          stage,
          entry,
          result.bytes,
          signal,
        );
        orderedAudio.push(rendered.output);
        options.repository.updateRenderSegment(
          {
            ...segment(renderId, entry),
            state: "complete",
            cacheStatus: result.status,
            audioDurationMs: rendered.durationMs,
            audioFileName: rendered.audioFileName,
            audioSizeBytes: rendered.sizeBytes,
            audioChecksum: rendered.checksum,
          },
          options.artifacts.segmentPath(renderId, rendered.audioFileName),
        );
        job = options.queue.update(job, "synthesizing", {
          completedChunks: job.progress.completedChunks + 1,
          cacheHits: job.progress.cacheHits + (result.status === "hit" ? 1 : 0),
          cacheMisses:
            job.progress.cacheMisses + (result.status === "miss" ? 1 : 0),
          ttsRequests:
            job.progress.ttsRequests + (result.status === "miss" ? 1 : 0),
        });
      }

      if (orderedAudio.length === 0)
        throw new Error("The frozen plan contains no audible entries.");
      job = options.queue.update(job, "assembling", {
        entryOrdinal: null,
        chunkOrdinal: null,
        speakerId: null,
        voiceId: null,
        excerpt: null,
      });
      const combined = await options.artifacts.assembleAudio(
        stage,
        orderedAudio,
        signal,
      );

      job = options.queue.update(job, "encoding");
      const { mp3Name, mp3Path, mp3Probe } =
        await options.artifacts.encodeAudio(
          stage,
          snapshot.project.name,
          combined,
          signal,
        );

      job = options.queue.update(job, "writing_artifacts");
      await options.artifacts.publishArtifacts({
        stage,
        renderId,
        plan,
        snapshot,
        mp3Name,
        mp3Path,
        mp3Probe,
        combined,
      });
      const completed = options.queue.update(job, "complete");
      options.logger.info(
        {
          event: "render-completed",
          renderId: completed.id,
          projectId: completed.projectId,
          durationMs: completed.progress.elapsedMs,
          cacheHits: completed.progress.cacheHits,
          cacheMisses: completed.progress.cacheMisses,
        },
        "Render completed",
      );
      if (!options.queue.isClosing())
        recordVoiceTimingCalibration(
          completed,
          plan,
          snapshot.connection.modelId,
        );
    } catch (error) {
      await options.artifacts.cleanupStage(stage).catch(() => undefined);
      const phase = job.state;
      if (options.queue.isClosing())
        options.queue.update(job, "queued", {}, null);
      else if (options.queue.isUserCanceled(renderId))
        options.queue.update(job, "canceled", {}, null);
      else {
        const sanitized = safeRenderError(error, phase, currentEntry);
        if (currentEntry)
          options.repository.updateRenderSegment({
            ...segment(renderId, currentEntry),
            state: "failed",
            error: sanitized,
          });
        const failed = options.queue.update(job, "failed", {}, sanitized);
        options.logger.error(
          {
            event: "render-failed",
            renderId: failed.id,
            projectId: failed.projectId,
            phase: sanitized.phase,
            cause: {
              code: sanitized.code,
              message: sanitized.message,
            },
          },
          "Render failed",
        );
      }
    }
  }

  const estimateRenderPeakDiskBytes = (
    computed: ComputedRenderPlan,
  ): number => {
    const modelId = computed.snapshot.connection.modelId;
    const voiceIds = [
      ...new Set(
        computed.plan.entries
          .filter((entry) => entry.type === "speech")
          .map(({ voiceId }) => voiceId),
      ),
    ];
    const millisecondsPerNormalizedCharacterByVoice = Object.create(
      null,
    ) as Record<string, number>;
    for (const voiceId of voiceIds) {
      try {
        const calibration = options.repository.getVoiceTimingCalibration(
          modelId,
          voiceId,
        );
        if (calibration?.modelId === modelId && calibration.voiceId === voiceId)
          millisecondsPerNormalizedCharacterByVoice[voiceId] =
            calibration.millisecondsPerNormalizedCharacter;
      } catch {
        // Missing calibration must fall back to the bundled timing estimate.
      }
    }
    const calibration = { millisecondsPerNormalizedCharacterByVoice };
    const speechPlan: EstimablePlan = {
      entries: computed.plan.entries.filter((entry) => entry.type === "speech"),
    };
    const speechDurationMs = estimatePlanDurationMs(speechPlan, calibration);
    const totalDurationMs = estimatePlanDurationMs(computed.plan, calibration);
    const speechCacheBytes = estimateCacheBytes(speechDurationMs, 24_000, 2, 1);
    return estimatePeakDiskBytes({
      speechCacheBytes,
      totalDurationMs,
      bitrateKbps: 192,
      sampleRate: 24_000,
      bytesPerSample: 2,
      channels: 1,
    });
  };

  const preflightDiskSpace = async (
    computed: ComputedRenderPlan,
  ): Promise<void> => {
    const estimatedPeakBytes = estimateRenderPeakDiskBytes(computed);
    const stats = await options.readFileSystemStats(options.dataDirectory);
    if (stats.bavail < 0n || stats.bsize < 0n)
      throw new Error("Data-volume free space could not be measured.");
    const freeSpaceBytes = stats.bavail * stats.bsize;
    const hardUsableBytes =
      (freeSpaceBytes * BigInt(100 - RENDER_DISK_HARD_RESERVE_PERCENT)) / 100n;
    if (BigInt(estimatedPeakBytes) > hardUsableBytes)
      throw options.createDiskSpaceError(
        estimatedPeakBytes,
        freeSpaceBytes,
        hardUsableBytes,
      );
    const softUsableBytes =
      (freeSpaceBytes * BigInt(100 - RENDER_DISK_SOFT_RESERVE_PERCENT)) / 100n;
    if (BigInt(estimatedPeakBytes) > softUsableBytes)
      options.logger.warn(
        {
          event: "render-disk-space-warning",
          projectId: computed.plan.projectId,
          estimatedPeakBytes: String(estimatedPeakBytes),
          freeSpaceBytes: freeSpaceBytes.toString(),
          usableBytes: softUsableBytes.toString(),
          reservePercent: RENDER_DISK_SOFT_RESERVE_PERCENT,
        },
        "Render is approaching available disk space",
      );
  };

  const createNewJob = async (
    computed: ComputedRenderPlan,
    activity: SpeechCacheActivityLease | undefined,
  ): Promise<RenderJob> => {
    const id = RenderIdSchema.parse(options.createId());
    await options.plans.snapshotJob(
      id,
      computed.snapshot,
      computed.plan,
      computed.silenceAssets,
    );
    return publishJob(id, computed.plan, null, activity);
  };

  const createRetryJob = async (
    sourceRenderId: string,
    activity: SpeechCacheActivityLease | undefined,
  ): Promise<RenderJob> => {
    const id = RenderIdSchema.parse(options.createId());
    await options.plans.cloneJobSnapshot(id, sourceRenderId);
    const { plan } = await options.plans.loadJob(id);
    return publishJob(id, plan, sourceRenderId, activity);
  };

  const publishJob = (
    id: string,
    plan: RenderPlan,
    retryOfRenderId: string | null,
    activity: SpeechCacheActivityLease | undefined,
  ): RenderJob => {
    if (options.queue.isClosing()) {
      activity?.release();
      throw new Error("Render service is closing.");
    }
    const job = RenderJobSchema.parse({
      contractVersion: RENDER_CONTRACT_VERSION,
      id,
      projectId: plan.projectId,
      planId: plan.id,
      retryOfRenderId,
      state: "queued",
      progress: initialProgress(plan),
      error: null,
      createdAt: options.now().toISOString(),
      startedAt: null,
      finishedAt: null,
    });
    options.repository.createRenderJob(
      job,
      plan.entries.map((entry) => segment(id, entry)),
    );
    options.queue.trackActivity(id, activity);
    options.queue.enqueue(id);
    return job;
  };

  const startFromProject = async (
    projectId: string,
    startOptions: RenderStartOptions,
  ): Promise<RenderJob> => {
    const active = options.repository
      .listRenderJobs(projectId)
      .find((candidate) => options.queue.isNonterminal(candidate.state));
    if (active) return active;
    return await options.queue.startForProject(projectId, async () => {
      const activity = await options.queue.reserveActivity();
      try {
        const computed = await options.planComputer.compute(projectId);
        if (startOptions.diskSpaceCheckEnabled)
          await preflightDiskSpace(computed);
        return await createNewJob(computed, activity);
      } catch (error) {
        activity?.release();
        throw error;
      }
    });
  };

  return {
    execute,
    async getEstimateContext(input) {
      const parsed = RenderEstimateContextInputSchema.parse(input);
      const stats = await options.readFileSystemStats(options.dataDirectory);
      if (stats.bavail < 0n || stats.bsize < 0n)
        throw new Error("Data-volume free space could not be measured.");
      const availableBytes = stats.bavail * stats.bsize;
      const maximumSafeBytes = BigInt(Number.MAX_SAFE_INTEGER);
      const calibrations: RenderEstimateContextResult["calibrations"] = [];
      if (parsed.modelId !== null) {
        for (const voiceId of parsed.voiceIds) {
          const calibration = options.repository.getVoiceTimingCalibration(
            parsed.modelId,
            voiceId,
          );
          if (
            calibration?.modelId === parsed.modelId &&
            calibration.voiceId === voiceId
          )
            calibrations.push(calibration);
        }
      }
      return RenderEstimateContextResultSchema.parse({
        freeSpaceBytes: Number(
          availableBytes > maximumSafeBytes ? maximumSafeBytes : availableBytes,
        ),
        calibrations,
      });
    },
    async retry(renderId) {
      const prior = options.repository.getRenderJob(renderId);
      if (prior.state !== "failed")
        throw new Error("Only failed renders can be retried.");
      const active = options.repository
        .listRenderJobs(prior.projectId)
        .find((candidate) => options.queue.isNonterminal(candidate.state));
      if (active) return active;
      const activity = await options.queue.reserveActivity();
      try {
        return await createRetryJob(prior.id, activity);
      } catch (error) {
        activity?.release();
        throw error;
      }
    },
    startProject: startFromProject,
  };
}
