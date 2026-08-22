import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { zipSync } from "fflate";
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
  RenderArtifactIdSchema,
  RenderEstimateContextInputSchema,
  RenderEstimateContextResultSchema,
  RenderHistorySegmentCollectionSchema,
  RenderIdSchema,
  RenderJobSchema,
  RenderStartOptionsSchema,
  renderDiskSpaceBlockMessage,
  RenderWaveformSchema,
  type RenderArtifact,
  type RenderClient,
  type RenderError,
  type RenderEstimateContextResult,
  type RenderHistorySegment,
  type RenderJob,
  type RenderPlan,
  type RenderPlanEntry,
  type RenderProgress,
  type RenderSegment,
  type RenderStartOptions,
  type RenderWaveform,
} from "@studynarrator/shared-types";
import { ProjectIdSchema } from "@studynarrator/shared-types";
import {
  concatenateWavs,
  encodeMp3,
  extractWaveformPeaks,
  normalizeSpeechWav,
  probeAudioFile,
  type RenderPlanStore,
  type SpeechCacheActivityGate,
  type SpeechCacheActivityLease,
} from "@studynarrator/rendering";
import type { StudyNarratorRepository } from "@studynarrator/persistence";
import type { CachedSpeechSynthesis } from "./cachedSpeech.js";
import type { ResolvedRenderMedia } from "./renderMedia.js";
import type { ComputedRenderPlan, RenderPlanComputer } from "./renderPlan.js";

const NONTERMINAL = new Set<RenderJob["state"]>([
  "queued",
  "validating",
  "synthesizing",
  "assembling",
  "normalizing",
  "encoding",
  "writing_artifacts",
]);

class RenderMediaUnavailableError extends Error {
  readonly code = "RENDER_MEDIA_UNAVAILABLE";
}

export class RenderDiskSpaceError extends Error {
  readonly code = "RENDER_DISK_SPACE_INSUFFICIENT";
  readonly estimatedPeakBytes: number;
  readonly freeSpaceBytes: bigint;
  readonly usableBytes: bigint;

  constructor(
    estimatedPeakBytes: number,
    freeSpaceBytes: bigint,
    usableBytes: bigint,
  ) {
    super(
      renderDiskSpaceBlockMessage(
        estimatedPeakBytes,
        freeSpaceBytes,
        usableBytes,
      ),
    );
    this.name = "RenderDiskSpaceError";
    this.estimatedPeakBytes = estimatedPeakBytes;
    this.freeSpaceBytes = freeSpaceBytes;
    this.usableBytes = usableBytes;
  }
}

interface RenderLifecycleLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

interface RenderFileSystemStats {
  bavail: bigint;
  bsize: bigint;
}

type RenderStatfs = (path: string) => Promise<RenderFileSystemStats>;

export type RenderRepository = Pick<
  StudyNarratorRepository,
  | "getSpeechBackendConnection"
  | "createRenderJob"
  | "getRenderJob"
  | "listRenderJobs"
  | "listRecoverableRenderJobs"
  | "updateRenderJob"
  | "updateRenderSegment"
  | "replaceRenderArtifacts"
  | "listRenderArtifacts"
  | "getRenderArtifactPath"
  | "listRenderSegments"
  | "getRenderSegmentPath"
  | "getVoiceTimingCalibration"
  | "upsertVoiceTimingCalibration"
> &
  Partial<Pick<StudyNarratorRepository, "getProject">>;

export interface RenderService extends Omit<
  RenderClient,
  "renderAudioSource" | "segmentAudioSource" | "exportAudio" | "exportDetails"
> {
  exportAudio?(renderId: string): Promise<{
    disposition: "download" | "saved" | "canceled";
    fileName: string;
  }>;
  exportDetails?(renderId: string): Promise<{
    disposition: "download" | "saved" | "canceled";
    fileName: string;
  }>;
  resolveArtifact(
    artifactId: string,
  ): Promise<{ artifact: RenderArtifact; path: string }>;
  resolveRenderAudio(renderId: string): Promise<ResolvedRenderMedia>;
  resolveSegmentAudio(
    renderId: string,
    ordinal: number,
  ): Promise<ResolvedRenderMedia>;
  subscribe(renderId: string, callback: (job: RenderJob) => void): () => void;
  resolveDetailsArchive?(renderId: string): Promise<{
    bytes: Uint8Array;
    fileName: string;
    mimeType: "application/zip";
  }>;
  close(): Promise<void>;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
  return normalized.slice(0, 80) || "study-narration";
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

function transcript(
  plan: { entries: RenderPlanEntry[] },
  kind: "readable" | "tts",
): string {
  return `${plan.entries
    .map((entry) => {
      if (entry.type === "section") return `# ${entry.title}`;
      if (entry.type === "pause")
        return `[pause ${String(entry.durationMs)} ms]`;
      return `${entry.speakerId}: ${kind === "readable" ? entry.readableText : entry.ttsText}`;
    })
    .join("\n\n")}\n`;
}

export async function createRenderService(options: {
  repository: RenderRepository;
  plans: RenderPlanStore;
  speech: CachedSpeechSynthesis;
  dataDirectory: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  now?: () => Date;
  createId?: () => string;
  planComputer: RenderPlanComputer;
  logger: RenderLifecycleLogger;
  statfs?: RenderStatfs;
  activityGate?: SpeechCacheActivityGate;
}): Promise<RenderService> {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const readFileSystemStats: RenderStatfs =
    options.statfs ??
    (async (path) => {
      return await statfs(path, { bigint: true });
    });
  const root = resolve(options.dataDirectory, "renders");
  const stagingRoot = join(root, ".staging");
  if (
    root === resolve("/") ||
    !root.startsWith(`${resolve(options.dataDirectory)}${sep}`)
  )
    throw new Error("Render output root must be scoped to the data directory.");
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const rootDetails = await lstat(root);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink())
    throw new Error("Render output root must be a real directory.");
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });

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
  const ffprobePath =
    options.ffprobePath ??
    (options.ffmpegPath
      ? join(
          dirname(options.ffmpegPath),
          process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
        )
      : undefined);
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
    const timestamp = now().toISOString();
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
      const updatedAt = now().toISOString();
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

  async function execute(renderId: string): Promise<void> {
    let job = options.repository.getRenderJob(renderId);
    const controller = new AbortController();
    controllers.set(renderId, controller);
    let currentEntry: RenderPlanEntry | null = null;
    const stage = join(stagingRoot, renderId);
    try {
      await mkdir(stage, { mode: 0o700 });
      await mkdir(join(stage, "segments"), { mode: 0o700 });
      await mkdir(join(stage, "work"), { mode: 0o700 });
      job = update(job, "validating");
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
      const actualCacheStatuses = new Map<number, "hit" | "miss">();
      const actualDurations = new Map<number, number>();
      let speechOrdinal = 0;
      let sectionOrdinal = 0;
      for (const entry of plan.entries) {
        currentEntry = entry;
        if (controller.signal.aborted)
          throw new DOMException("The operation was aborted.", "AbortError");
        if (entry.type === "section") {
          sectionOrdinal += 1;
          options.repository.updateRenderSegment({
            ...segment(renderId, entry),
            state: "skipped",
          });
          job = update(job, "synthesizing", {
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
            const output = `work/pause-${String(entry.ordinal).padStart(6, "0")}.wav`;
            await writeFile(join(stage, output), bytes, {
              mode: 0o600,
              flag: "wx",
            });
            orderedAudio.push(output);
            actualDurations.set(entry.ordinal, entry.durationMs);
            options.repository.updateRenderSegment({
              ...segment(renderId, entry),
              state: "complete",
              audioDurationMs: entry.durationMs,
            });
          }
          continue;
        }

        speechOrdinal += 1;
        job = update(job, "synthesizing", {
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
          signal: controller.signal,
        });
        if (result.key !== entry.chunks[0]?.cacheKey)
          throw new Error(
            "Synthesized cache identity did not match the frozen plan.",
          );
        const audioFileName = `${String(entry.ordinal).padStart(6, "0")}.wav`;
        const raw = join(
          stage,
          "work",
          `raw-${String(entry.ordinal).padStart(6, "0")}.wav`,
        );
        const output = `segments/${audioFileName}`;
        await writeFile(raw, result.bytes, { mode: 0o600, flag: "wx" });
        await normalizeSpeechWav({
          inputPath: raw,
          outputPath: join(stage, output),
          gainDb: entry.gainDb,
          ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
          signal: controller.signal,
        });
        await rm(raw);
        const audio = await probeAudioFile({
          inputPath: join(stage, output),
          ...(ffprobePath ? { ffprobePath } : {}),
          signal: controller.signal,
        });
        if (!audio.decodable)
          throw new Error("Normalized speech did not decode.");
        orderedAudio.push(output);
        actualCacheStatuses.set(entry.ordinal, result.status);
        actualDurations.set(entry.ordinal, audio.durationMs);
        const segmentMetadata = await fileMetadataAt(join(stage, output));
        options.repository.updateRenderSegment(
          {
            ...segment(renderId, entry),
            state: "complete",
            cacheStatus: result.status,
            audioDurationMs: audio.durationMs,
            audioFileName,
            audioSizeBytes: segmentMetadata.sizeBytes,
            audioChecksum: segmentMetadata.checksum,
          },
          join(root, renderId, "segments", audioFileName),
        );
        job = update(job, "synthesizing", {
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
      job = update(job, "assembling", {
        entryOrdinal: null,
        chunkOrdinal: null,
        speakerId: null,
        voiceId: null,
        excerpt: null,
      });
      await writeFile(
        join(stage, "concat.txt"),
        `${orderedAudio.map((name) => `file '${name}'`).join("\n")}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      const combined = join(stage, "combined.wav");
      await concatenateWavs({
        listPath: join(stage, "concat.txt"),
        outputPath: combined,
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
        signal: controller.signal,
      });

      job = update(job, "encoding");
      const mp3Name = `${slug(snapshot.project.name)}.mp3`;
      const mp3Path = join(stage, mp3Name);
      await encodeMp3({
        inputPath: combined,
        outputPath: mp3Path,
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
        signal: controller.signal,
      });
      const mp3Probe = await probeAudioFile({
        inputPath: mp3Path,
        ...(ffprobePath ? { ffprobePath } : {}),
        signal: controller.signal,
      });
      if (!mp3Probe.decodable || !mp3Probe.formatName?.includes("mp3"))
        throw new Error("Final MP3 validation failed.");

      job = update(job, "writing_artifacts");
      await Promise.all([
        rm(combined),
        rm(join(stage, "concat.txt")),
        rm(join(stage, "work"), { recursive: true }),
      ]);
      const files = new Map<
        string,
        { type: RenderArtifact["type"]; durationMs: number | null }
      >([
        [mp3Name, { type: "mp3", durationMs: mp3Probe.durationMs }],
        ["original-script.txt", { type: "originalScript", durationMs: null }],
        [
          "readable-transcript.txt",
          { type: "readableTranscript", durationMs: null },
        ],
        ["tts-transcript.txt", { type: "ttsTranscript", durationMs: null }],
        [
          "project-snapshot.json",
          { type: "projectSnapshot", durationMs: null },
        ],
      ]);
      await writeFile(
        join(stage, "original-script.txt"),
        snapshot.project.scriptSource,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await writeFile(
        join(stage, "readable-transcript.txt"),
        transcript(plan, "readable"),
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await writeFile(
        join(stage, "tts-transcript.txt"),
        transcript(plan, "tts"),
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await writeFile(
        join(stage, "project-snapshot.json"),
        `${JSON.stringify(snapshot, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );

      const mp3Metadata = await fileMetadataAt(mp3Path);
      try {
        const waveform = await extractWaveformPeaks({
          inputPath: mp3Path,
          ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
          ...(ffprobePath ? { ffprobePath } : {}),
        });
        await writeFile(
          join(stage, "waveform.json"),
          `${JSON.stringify({
            schemaVersion: RENDER_CONTRACT_VERSION,
            sourceChecksum: mp3Metadata.checksum,
            durationMs: waveform.durationMs,
            sampleRate: waveform.sampleRate,
            peaks: waveform.peaks,
          })}\n`,
          { encoding: "utf8", mode: 0o600, flag: "wx" },
        );
      } catch {
        // Waveform data is derived review metadata. Its fallback must never invalidate a completed render.
      }

      const fileMetadata = async (fileName: string) => {
        const metadata = await fileMetadataAt(join(stage, fileName));
        return { fileName, ...metadata };
      };
      const initialMetadata = await Promise.all(
        [...files.keys()].map(fileMetadata),
      );
      let timelineMs = 0;
      const sectionTimestamps: Array<{ title: string; startMs: number }> = [];
      for (const entry of plan.entries) {
        if (entry.type === "section")
          sectionTimestamps.push({ title: entry.title, startMs: timelineMs });
        else timelineMs += actualDurations.get(entry.ordinal) ?? 0;
      }
      const manifest = {
        schemaVersion: RENDER_CONTRACT_VERSION,
        renderId,
        projectId: plan.projectId,
        planId: plan.id,
        createdAt: now().toISOString(),
        scriptHash: plan.scriptHash,
        snapshotHash: plan.snapshotHash,
        planHash: plan.planHash,
        connection: snapshot.connection,
        versions: snapshot.versions,
        encoding: {
          format: "mp3",
          codec: "libmp3lame",
          bitRate: 192_000,
          sampleRate: 24_000,
          channels: 1,
        },
        durationMs: mp3Probe.durationMs,
        sectionTimestamps,
        progress: job.progress,
        entries: plan.entries.map((entry) => ({
          ...entry,
          actualDurationMs: actualDurations.get(entry.ordinal) ?? null,
          ...(entry.type === "speech"
            ? {
                actualCacheStatus:
                  actualCacheStatuses.get(entry.ordinal) ?? null,
              }
            : {}),
        })),
        artifacts: initialMetadata,
      };
      await writeFile(
        join(stage, "render-manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      files.set("render-manifest.json", { type: "manifest", durationMs: null });
      const checksummed = await Promise.all(
        [...files.keys()].map(fileMetadata),
      );
      await writeFile(
        join(stage, "checksums.txt"),
        `${checksummed.map(({ checksum, fileName }) => `${checksum}  ${fileName}`).join("\n")}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      files.set("checksums.txt", { type: "checksums", durationMs: null });

      const finalDirectory = join(root, renderId);
      await rename(stage, finalDirectory);
      const createdAt = now().toISOString();
      const artifacts: Array<RenderArtifact & { path: string }> = [];
      for (const [fileName, details] of files) {
        const metadata = await fileMetadataAt(join(finalDirectory, fileName));
        artifacts.push({
          contractVersion: RENDER_CONTRACT_VERSION,
          id: RenderArtifactIdSchema.parse(createId()),
          renderId,
          type: details.type,
          fileName,
          sizeBytes: metadata.sizeBytes,
          checksum: metadata.checksum,
          durationMs: details.durationMs,
          createdAt,
          path: join(finalDirectory, fileName),
        });
      }
      options.repository.replaceRenderArtifacts(renderId, artifacts);
      const completed = update(job, "complete");
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
      if (!closing)
        recordVoiceTimingCalibration(
          completed,
          plan,
          snapshot.connection.modelId,
        );
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
      const phase = job.state;
      if (closing) update(job, "queued", {}, null);
      else if (userCanceled.has(renderId)) update(job, "canceled", {}, null);
      else {
        const sanitized = safeRenderError(error, phase, currentEntry);
        if (currentEntry)
          options.repository.updateRenderSegment({
            ...segment(renderId, currentEntry),
            state: "failed",
            error: sanitized,
          });
        const failed = update(job, "failed", {}, sanitized);
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
    } finally {
      controllers.delete(renderId);
      userCanceled.delete(renderId);
    }
  }

  async function fileMetadataAt(
    path: string,
  ): Promise<{ checksum: string; sizeBytes: number }> {
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink())
      throw new Error("Render media must be a regular file.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path))
      hash.update(chunk as Buffer);
    return { checksum: hash.digest("hex"), sizeBytes: details.size };
  }

  async function resolveRegularMedia(
    pathValue: string,
    expectedDirectory: string,
    expectedFileName: string,
    expectedSize: number,
  ): Promise<string> {
    try {
      const path = resolve(pathValue);
      const details = await lstat(path);
      if (
        dirname(path) !== expectedDirectory ||
        basename(path) !== expectedFileName ||
        !details.isFile() ||
        details.isSymbolicLink() ||
        details.size !== expectedSize
      ) {
        throw new RenderMediaUnavailableError(
          "The render media is unavailable.",
        );
      }
      return path;
    } catch (error) {
      if (error instanceof RenderMediaUnavailableError) throw error;
      throw new RenderMediaUnavailableError("The render media is unavailable.");
    }
  }

  async function buildHistorySegments(
    renderId: string,
  ): Promise<RenderHistorySegment[]> {
    const job = options.repository.getRenderJob(RenderIdSchema.parse(renderId));
    const { plan, snapshot } = await options.plans.loadJob(job.id);
    const runtime = new Map(
      options.repository
        .listRenderSegments(job.id)
        .map((item) => [item.ordinal, item]),
    );
    const speakerLabels = new Map(
      snapshot.project.speakerMappings.map((item) => [
        item.speakerId,
        item.displayName,
      ]),
    );
    const values = await Promise.all(
      plan.entries.map(async (entry): Promise<RenderHistorySegment> => {
        const stored = runtime.get(entry.ordinal);
        if (!stored)
          throw new Error("The render segment history is incomplete.");
        const base = {
          renderId: job.id,
          ordinal: entry.ordinal,
          state: stored.state,
          sectionTitle: entry.sectionTitle,
          sourceRange: entry.sourceRange,
          audioDurationMs: stored.audioDurationMs,
          cacheStatus: stored.cacheStatus,
          error: stored.error,
        };
        if (entry.type === "section")
          return {
            ...base,
            type: "section",
            title: entry.title,
            audio: { status: "unavailable" },
          };
        if (entry.type === "pause")
          return {
            ...base,
            type: "pause",
            pauseId: entry.pauseId,
            pauseKind: entry.pauseKind,
            reason: entry.reason,
            durationMs: entry.durationMs,
            audio: { status: "unavailable" },
          };
        let audio: RenderHistorySegment["audio"] = { status: "unavailable" };
        if (
          stored.audioFileName &&
          stored.audioSizeBytes &&
          stored.audioChecksum
        ) {
          const resolvedSegment = options.repository.getRenderSegmentPath(
            job.id,
            entry.ordinal,
          );
          if (resolvedSegment.path) {
            try {
              await resolveRegularMedia(
                resolvedSegment.path,
                join(root, job.id, "segments"),
                stored.audioFileName,
                stored.audioSizeBytes,
              );
              audio = {
                status: "available",
                mimeType: "audio/wav",
                sizeBytes: stored.audioSizeBytes,
                checksum: stored.audioChecksum,
              };
            } catch {
              audio = { status: "unavailable" };
            }
          }
        }
        return {
          ...base,
          type: "speech",
          speakerId: entry.speakerId,
          speakerLabel: speakerLabels.get(entry.speakerId) ?? entry.speakerId,
          modelId: snapshot.connection.modelId,
          voiceId: entry.voiceId,
          readableText: entry.readableText,
          ttsText: entry.ttsText,
          audio,
        };
      }),
    );
    return RenderHistorySegmentCollectionSchema.parse(values);
  }

  async function waveformFor(renderId: string): Promise<RenderWaveform> {
    const normalized = RenderIdSchema.parse(renderId);
    const job = options.repository.getRenderJob(normalized);
    if (job.state !== "complete")
      return RenderWaveformSchema.parse({
        status: "unavailable",
        renderId: normalized,
        reason: "renderIncomplete",
      });
    let media: ResolvedRenderMedia;
    try {
      media = await resolveRenderAudio(normalized);
    } catch {
      return RenderWaveformSchema.parse({
        status: "unavailable",
        renderId: normalized,
        reason: "audioMissing",
      });
    }
    const cachePath = join(dirname(media.path), "waveform.json");
    const readCache = async (): Promise<RenderWaveform | null> => {
      try {
        const details = await lstat(cachePath);
        if (
          !details.isFile() ||
          details.isSymbolicLink() ||
          details.size > 64 * 1_024
        )
          return null;
        const value = JSON.parse(await readFile(cachePath, "utf8")) as Record<
          string,
          unknown
        >;
        return RenderWaveformSchema.parse({
          status: "available",
          renderId: normalized,
          sourceChecksum: value.sourceChecksum,
          durationMs: value.durationMs,
          sampleRate: value.sampleRate,
          peaks: value.peaks,
        });
      } catch {
        return null;
      }
    };
    const cached = await readCache();
    if (
      cached?.status === "available" &&
      cached.sourceChecksum ===
        options.repository
          .listRenderArtifacts(normalized)
          .find(({ type }) => type === "mp3")?.checksum
    )
      return cached;
    try {
      const artifact = options.repository
        .listRenderArtifacts(normalized)
        .find(({ type }) => type === "mp3");
      if (!artifact) throw new Error("The render MP3 is unavailable.");
      const waveform = await extractWaveformPeaks({
        inputPath: media.path,
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
        ...(ffprobePath ? { ffprobePath } : {}),
      });
      const available = RenderWaveformSchema.parse({
        status: "available",
        renderId: normalized,
        sourceChecksum: artifact.checksum,
        durationMs: waveform.durationMs,
        sampleRate: waveform.sampleRate,
        peaks: waveform.peaks,
      });
      if (available.status !== "available")
        throw new Error("The waveform result is unavailable.");
      const temporary = join(dirname(media.path), `waveform.${createId()}.tmp`);
      await writeFile(
        temporary,
        `${JSON.stringify({
          schemaVersion: RENDER_CONTRACT_VERSION,
          sourceChecksum: available.sourceChecksum,
          durationMs: available.durationMs,
          sampleRate: available.sampleRate,
          peaks: available.peaks,
        })}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await rename(temporary, cachePath);
      return available;
    } catch {
      return RenderWaveformSchema.parse({
        status: "unavailable",
        renderId: normalized,
        reason: "extractionFailed",
      });
    }
  }

  async function resolveRenderAudio(
    renderId: string,
  ): Promise<ResolvedRenderMedia> {
    const normalized = RenderIdSchema.parse(renderId);
    const artifact = options.repository
      .listRenderArtifacts(normalized)
      .find(({ type }) => type === "mp3");
    if (!artifact)
      throw new RenderMediaUnavailableError(
        "The completed render audio is unavailable.",
      );
    const resolvedArtifact = options.repository.getRenderArtifactPath(
      artifact.id,
    );
    const path = await resolveRegularMedia(
      resolvedArtifact.path,
      join(root, normalized),
      artifact.fileName,
      artifact.sizeBytes,
    );
    return {
      path,
      fileName: artifact.fileName,
      mimeType: "audio/mpeg",
      sizeBytes: artifact.sizeBytes,
    };
  }

  async function resolveSegmentAudio(
    renderId: string,
    ordinal: number,
  ): Promise<ResolvedRenderMedia> {
    const normalized = RenderIdSchema.parse(renderId);
    if (!Number.isInteger(ordinal) || ordinal < 1)
      throw new Error("The render segment ordinal is invalid.");
    const { segment: stored, path: storedPath } =
      options.repository.getRenderSegmentPath(normalized, ordinal);
    if (
      stored.type !== "speech" ||
      !storedPath ||
      !stored.audioFileName ||
      !stored.audioSizeBytes ||
      !stored.audioChecksum
    ) {
      throw new RenderMediaUnavailableError(
        "The render segment audio is unavailable.",
      );
    }
    const path = await resolveRegularMedia(
      storedPath,
      join(root, normalized, "segments"),
      stored.audioFileName,
      stored.audioSizeBytes,
    );
    return {
      path,
      fileName: stored.audioFileName,
      mimeType: "audio/wav",
      sizeBytes: stored.audioSizeBytes,
    };
  }

  async function resolveArtifactFile(artifactId: string) {
    const resolved = options.repository.getRenderArtifactPath(
      RenderArtifactIdSchema.parse(artifactId),
    );
    const path = resolve(resolved.path);
    const expectedDirectory = join(root, resolved.artifact.renderId);
    const details = await lstat(path);
    if (
      dirname(path) !== expectedDirectory ||
      basename(path) !== resolved.artifact.fileName ||
      !details.isFile() ||
      details.isSymbolicLink()
    ) {
      throw new Error("The render artifact path failed validation.");
    }
    const metadata = await fileMetadataAt(path);
    if (
      metadata.checksum !== resolved.artifact.checksum ||
      metadata.sizeBytes !== resolved.artifact.sizeBytes
    )
      throw new Error("The render artifact failed integrity validation.");
    return { artifact: resolved.artifact, path };
  }

  async function resolveDetailsArchive(renderIdInput: string) {
    const renderId = RenderIdSchema.parse(renderIdInput);
    const artifacts = options.repository.listRenderArtifacts(renderId);
    const expected = [
      "mp3",
      "originalScript",
      "readableTranscript",
      "ttsTranscript",
      "projectSnapshot",
      "manifest",
      "checksums",
    ] as const;
    if (
      expected.some(
        (type) => !artifacts.some((artifact) => artifact.type === type),
      )
    )
      throw new Error("The render details package is incomplete.");
    const entries: Record<string, Uint8Array> = {};
    for (const artifact of artifacts) {
      if (!expected.includes(artifact.type)) continue;
      const resolved = await resolveArtifactFile(artifact.id);
      entries[artifact.fileName] = new Uint8Array(
        await readFile(resolved.path),
      );
    }
    const job = options.repository.getRenderJob(renderId);
    const projectName =
      options.repository.getProject?.(job.projectId).name ?? "study-narration";
    return {
      bytes: zipSync(entries, { level: 6 }),
      fileName: `${slug(projectName)}-render-details.zip`,
      mimeType: "application/zip" as const,
    };
  }

  async function drain(): Promise<void> {
    while (!closing && queue.length > 0) {
      const renderId = queue.shift()!;
      const job = options.repository.getRenderJob(renderId);
      if (NONTERMINAL.has(job.state)) await execute(renderId);
    }
  }

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
    const stats = await readFileSystemStats(options.dataDirectory);
    if (stats.bavail < 0n || stats.bsize < 0n)
      throw new Error("Data-volume free space could not be measured.");
    const freeSpaceBytes = stats.bavail * stats.bsize;
    const hardUsableBytes =
      (freeSpaceBytes * BigInt(100 - RENDER_DISK_HARD_RESERVE_PERCENT)) / 100n;
    if (BigInt(estimatedPeakBytes) > hardUsableBytes)
      throw new RenderDiskSpaceError(
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
    const id = RenderIdSchema.parse(createId());
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
    const id = RenderIdSchema.parse(createId());
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
    if (closing) {
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
      createdAt: now().toISOString(),
      startedAt: null,
      finishedAt: null,
    });
    options.repository.createRenderJob(
      job,
      plan.entries.map((entry) => segment(id, entry)),
    );
    if (activity) activities.set(id, activity);
    enqueue(id);
    return job;
  };

  const startFromProject = async (
    projectId: string,
    startOptions: RenderStartOptions,
  ): Promise<RenderJob> => {
    const active = options.repository
      .listRenderJobs(projectId)
      .find((candidate) => NONTERMINAL.has(candidate.state));
    if (active) return active;
    const starting = startingProjects.get(projectId);
    if (starting) return await starting;
    const promise = (async () => {
      const activity = await reserveActivity();
      try {
        const computed = await options.planComputer.compute(projectId);
        if (startOptions.diskSpaceCheckEnabled)
          await preflightDiskSpace(computed);
        return await createNewJob(computed, activity);
      } catch (error) {
        activity?.release();
        throw error;
      }
    })().finally(() => startingProjects.delete(projectId));
    startingProjects.set(projectId, promise);
    return await promise;
  };

  return {
    startProject: (projectId, startOptions) =>
      startFromProject(
        ProjectIdSchema.parse(projectId),
        RenderStartOptionsSchema.parse(startOptions),
      ),
    async getEstimateContext(input) {
      const parsed = RenderEstimateContextInputSchema.parse(input);
      const stats = await readFileSystemStats(options.dataDirectory);
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
    async list(projectId) {
      return await Promise.resolve(
        options.repository.listRenderJobs(projectId),
      );
    },
    async get(renderId) {
      return await Promise.resolve(
        options.repository.getRenderJob(RenderIdSchema.parse(renderId)),
      );
    },
    subscribe(renderIdInput, callback) {
      const renderId = RenderIdSchema.parse(renderIdInput);
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
    async cancel(renderIdInput) {
      const renderId = RenderIdSchema.parse(renderIdInput);
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
    async retry(renderIdInput) {
      const prior = options.repository.getRenderJob(
        RenderIdSchema.parse(renderIdInput),
      );
      if (prior.state !== "failed")
        throw new Error("Only failed renders can be retried.");
      const active = options.repository
        .listRenderJobs(prior.projectId)
        .find((candidate) => NONTERMINAL.has(candidate.state));
      if (active) return active;
      const activity = await reserveActivity();
      try {
        return await createRetryJob(prior.id, activity);
      } catch (error) {
        activity?.release();
        throw error;
      }
    },
    async setPinned(renderIdInput, pinned) {
      const job = options.repository.getRenderJob(
        RenderIdSchema.parse(renderIdInput),
      );
      return await Promise.resolve(
        options.repository.updateRenderJob(
          RenderJobSchema.parse({ ...job, pinned: Boolean(pinned) }),
        ),
      );
    },
    async listArtifacts(renderId) {
      return await Promise.resolve(
        options.repository.listRenderArtifacts(RenderIdSchema.parse(renderId)),
      );
    },
    async exportArtifact(artifactId) {
      const { artifact } = options.repository.getRenderArtifactPath(
        RenderArtifactIdSchema.parse(artifactId),
      );
      return await Promise.resolve({
        disposition: "download" as const,
        fileName: artifact.fileName,
      });
    },
    async exportAudio(renderId) {
      const media = await resolveRenderAudio(renderId);
      return { disposition: "download" as const, fileName: media.fileName };
    },
    async exportDetails(renderId) {
      const archive = await resolveDetailsArchive(renderId);
      return { disposition: "download" as const, fileName: archive.fileName };
    },
    async resolveArtifact(artifactId) {
      return await resolveArtifactFile(artifactId);
    },
    async listSegments(renderId) {
      return await buildHistorySegments(renderId);
    },
    async getWaveform(renderId) {
      return await waveformFor(renderId);
    },
    async exportSegment(renderId, ordinal) {
      const media = await resolveSegmentAudio(renderId, ordinal);
      return { disposition: "download" as const, fileName: media.fileName };
    },
    resolveRenderAudio,
    resolveSegmentAudio,
    resolveDetailsArchive,
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
  };
}
