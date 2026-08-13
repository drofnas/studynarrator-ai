import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  RENDER_CONTRACT_VERSION,
  RenderArtifactIdSchema,
  RenderIdSchema,
  RenderJobSchema,
  RenderPlanIdSchema,
  type RenderArtifact,
  type RenderClient,
  type RenderError,
  type RenderJob,
  type RenderPlanEntry,
  type RenderProgress,
  type RenderSegment
} from "@studynarrator/shared-types";
import {
  concatenateWavs,
  encodeMp3,
  normalizeSpeechWav,
  probeAudioFile,
  type RenderPlanStore
} from "@studynarrator/rendering";
import type { StudyNarratorRepository } from "@studynarrator/persistence";
import type { CachedSpeechSynthesis } from "./cachedSpeech.js";

const NONTERMINAL = new Set<RenderJob["state"]>([
  "queued", "validating", "synthesizing", "assembling", "normalizing", "encoding", "writing_artifacts"
]);

export type RenderRepository = Pick<StudyNarratorRepository,
  "getConnectionProfile" | "createRenderJob" | "getRenderJob" | "listRenderJobs" | "findActiveRenderJob" |
  "listRecoverableRenderJobs" | "updateRenderJob" | "updateRenderSegment" | "replaceRenderArtifacts" |
  "listRenderArtifacts" | "getRenderArtifactPath">;

export interface RenderService extends RenderClient {
  resolveArtifact(artifactId: string): Promise<{ artifact: RenderArtifact; path: string }>;
  close(): Promise<void>;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function initialProgress(plan: Awaited<ReturnType<RenderPlanStore["get"]>>): RenderProgress {
  const speechCount = plan.entries.filter(({ type }) => type === "speech").length;
  return {
    phase: "queued", sectionTitle: null, sectionOrdinal: 0, sectionCount: plan.summary.sectionCount,
    entryOrdinal: null, speechOrdinal: 0, speechCount, chunkOrdinal: null,
    completedChunks: 0, totalChunks: speechCount, cacheHits: 0, cacheMisses: 0, ttsRequests: 0,
    speakerId: null, voiceId: null, excerpt: null, elapsedMs: 0
  };
}

function segment(renderId: string, entry: RenderPlanEntry): RenderSegment {
  return { renderId, ordinal: entry.ordinal, type: entry.type, state: "pending", cacheStatus: null, audioDurationMs: null, error: null };
}

function slug(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-|-$/gu, "").toLowerCase();
  return normalized.slice(0, 80) || "study-narration";
}

function safeRenderError(error: unknown, phase: RenderJob["state"], entry: RenderPlanEntry | null): RenderError {
  const aborted = error instanceof DOMException && error.name === "AbortError";
  return {
    code: aborted ? "RENDER_ABORTED" : phase === "validating" ? "RENDER_VALIDATION_FAILED"
      : phase === "synthesizing" ? "RENDER_SYNTHESIS_FAILED"
        : phase === "assembling" ? "RENDER_ASSEMBLY_FAILED"
          : phase === "encoding" ? "RENDER_ENCODING_FAILED" : "RENDER_ARTIFACT_FAILED",
    message: aborted ? "The render operation stopped before completion."
      : phase === "validating" ? "The frozen render plan no longer matches its configured speech endpoint."
        : phase === "synthesizing" ? "Speech generation failed for the current segment."
          : phase === "assembling" ? "The generated audio segments could not be assembled."
            : phase === "encoding" ? "The final MP3 could not be encoded or validated."
              : "The render artifact bundle could not be published.",
    retryable: phase !== "validating",
    phase,
    entryOrdinal: entry?.ordinal ?? null,
    chunkOrdinal: entry?.type === "speech" ? 1 : null,
    sourceRange: entry?.sourceRange ?? null,
    speakerId: entry?.type === "speech" ? entry.speakerId : null,
    voiceId: entry?.type === "speech" ? entry.voiceId : null
  };
}

function transcript(plan: { entries: RenderPlanEntry[] }, kind: "readable" | "tts"): string {
  return `${plan.entries.map((entry) => {
    if (entry.type === "section") return `# ${entry.title}`;
    if (entry.type === "pause") return `[pause ${String(entry.durationMs)} ms]`;
    return `${entry.speakerId}: ${kind === "readable" ? entry.readableText : entry.ttsText}`;
  }).join("\n\n")}\n`;
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
}): Promise<RenderService> {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const root = resolve(options.dataDirectory, "renders");
  const stagingRoot = join(root, ".staging");
  if (root === resolve("/") || !root.startsWith(`${resolve(options.dataDirectory)}${sep}`)) throw new Error("Render output root must be scoped to the data directory.");
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const rootDetails = await lstat(root);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) throw new Error("Render output root must be a real directory.");
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });

  const queue: string[] = [];
  const controllers = new Map<string, AbortController>();
  const userCanceled = new Set<string>();
  const startingPlans = new Map<string, Promise<RenderJob>>();
  const ffprobePath = options.ffprobePath ?? (options.ffmpegPath
    ? join(dirname(options.ffmpegPath), process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
    : undefined);
  let draining = false;
  let closing = false;
  let drainPromise: Promise<void> = Promise.resolve();

  const enqueue = (renderId: string) => {
    if (!queue.includes(renderId)) queue.push(renderId);
    if (!draining && !closing) {
      draining = true;
      drainPromise = drain().finally(() => { draining = false; });
    }
  };

  const update = (job: RenderJob, state: RenderJob["state"], patch: Partial<RenderProgress> = {}, error: RenderError | null = job.error): RenderJob => {
    const timestamp = now().toISOString();
    const startedAt = job.startedAt ?? (state === "queued" ? null : timestamp);
    const finishedAt = NONTERMINAL.has(state) ? null : timestamp;
    const elapsedMs = startedAt ? Math.max(0, Date.parse(timestamp) - Date.parse(startedAt)) : 0;
    const next = RenderJobSchema.parse({
      ...job, state, error, startedAt, finishedAt,
      progress: { ...job.progress, ...patch, phase: state, elapsedMs }
    });
    return options.repository.updateRenderJob(next);
  };

  async function execute(renderId: string): Promise<void> {
    let job = options.repository.getRenderJob(renderId);
    const controller = new AbortController();
    controllers.set(renderId, controller);
    let currentEntry: RenderPlanEntry | null = null;
    const stage = join(stagingRoot, renderId);
    try {
      await mkdir(stage, { mode: 0o700 });
      job = update(job, "validating");
      const { plan, snapshot, silenceAssets } = await options.plans.load(job.planId);
      const profile = options.repository.getConnectionProfile(snapshot.connection.profileId);
      if (!profile.baseUrl || sha256(profile.baseUrl) !== snapshot.connection.serverIdentityHash) throw new Error("Frozen endpoint identity changed.");

      const orderedAudio: string[] = [];
      const actualCacheStatuses = new Map<number, "hit" | "miss">();
      const actualDurations = new Map<number, number>();
      let speechOrdinal = 0;
      let sectionOrdinal = 0;
      for (const entry of plan.entries) {
        currentEntry = entry;
        if (controller.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
        if (entry.type === "section") {
          sectionOrdinal += 1;
          options.repository.updateRenderSegment({ ...segment(renderId, entry), state: "skipped" });
          job = update(job, "synthesizing", { sectionTitle: entry.title, sectionOrdinal, entryOrdinal: entry.ordinal });
          continue;
        }
        if (entry.type === "pause") {
          if (!entry.silence) {
            options.repository.updateRenderSegment({ ...segment(renderId, entry), state: "skipped", audioDurationMs: 0 });
          } else {
            const bytes = silenceAssets.get(entry.silence.checksum);
            if (!bytes || sha256(bytes) !== entry.silence.checksum) throw new Error("Frozen silence asset failed verification.");
            const output = `segment-${String(entry.ordinal).padStart(6, "0")}.wav`;
            await writeFile(join(stage, output), bytes, { mode: 0o600, flag: "wx" });
            orderedAudio.push(output);
            actualDurations.set(entry.ordinal, entry.durationMs);
            options.repository.updateRenderSegment({ ...segment(renderId, entry), state: "complete", audioDurationMs: entry.durationMs });
          }
          continue;
        }

        speechOrdinal += 1;
        job = update(job, "synthesizing", {
          entryOrdinal: entry.ordinal, speechOrdinal, chunkOrdinal: 1, speakerId: entry.speakerId,
          voiceId: entry.voiceId, excerpt: entry.readableText.slice(0, 160), sectionTitle: entry.sectionTitle
        });
        const result = await options.speech.synthesize({
          connectionProfileId: snapshot.connection.profileId, modelId: snapshot.connection.modelId,
          voiceId: entry.voiceId, speed: entry.speed, text: entry.ttsText,
          usage: { projectId: plan.projectId }, signal: controller.signal
        });
        if (result.key !== entry.chunks[0]?.cacheKey) throw new Error("Synthesized cache identity did not match the frozen plan.");
        const raw = join(stage, `raw-${String(entry.ordinal).padStart(6, "0")}.wav`);
        const output = `segment-${String(entry.ordinal).padStart(6, "0")}.wav`;
        await writeFile(raw, result.bytes, { mode: 0o600, flag: "wx" });
        await normalizeSpeechWav({ inputPath: raw, outputPath: join(stage, output), gainDb: entry.gainDb, ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}), signal: controller.signal });
        await rm(raw);
        const audio = await probeAudioFile({ inputPath: join(stage, output), ...(ffprobePath ? { ffprobePath } : {}), signal: controller.signal });
        if (!audio.decodable) throw new Error("Normalized speech did not decode.");
        orderedAudio.push(output);
        actualCacheStatuses.set(entry.ordinal, result.status);
        actualDurations.set(entry.ordinal, audio.durationMs);
        options.repository.updateRenderSegment({ ...segment(renderId, entry), state: "complete", cacheStatus: result.status, audioDurationMs: audio.durationMs });
        job = update(job, "synthesizing", {
          completedChunks: job.progress.completedChunks + 1,
          cacheHits: job.progress.cacheHits + (result.status === "hit" ? 1 : 0),
          cacheMisses: job.progress.cacheMisses + (result.status === "miss" ? 1 : 0),
          ttsRequests: job.progress.ttsRequests + (result.status === "miss" ? 1 : 0)
        });
      }

      if (orderedAudio.length === 0) throw new Error("The frozen plan contains no audible entries.");
      job = update(job, "assembling", { entryOrdinal: null, chunkOrdinal: null, speakerId: null, voiceId: null, excerpt: null });
      await writeFile(join(stage, "concat.txt"), `${orderedAudio.map((name) => `file '${name}'`).join("\n")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      const combined = join(stage, "combined.wav");
      await concatenateWavs({ listPath: join(stage, "concat.txt"), outputPath: combined, ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}), signal: controller.signal });

      job = update(job, "encoding");
      const mp3Name = `${slug(snapshot.project.name)}.mp3`;
      const mp3Path = join(stage, mp3Name);
      await encodeMp3({ inputPath: combined, outputPath: mp3Path, ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}), signal: controller.signal });
      const mp3Probe = await probeAudioFile({ inputPath: mp3Path, ...(ffprobePath ? { ffprobePath } : {}), signal: controller.signal });
      if (!mp3Probe.decodable || !mp3Probe.formatName?.includes("mp3")) throw new Error("Final MP3 validation failed.");

      job = update(job, "writing_artifacts");
      await Promise.all([rm(combined), rm(join(stage, "concat.txt")), ...orderedAudio.map((name) => rm(join(stage, name)))]);
      const files = new Map<string, { type: RenderArtifact["type"]; durationMs: number | null }>([
        [mp3Name, { type: "mp3", durationMs: mp3Probe.durationMs }],
        ["original-script.txt", { type: "originalScript", durationMs: null }],
        ["readable-transcript.txt", { type: "readableTranscript", durationMs: null }],
        ["tts-transcript.txt", { type: "ttsTranscript", durationMs: null }],
        ["project-snapshot.json", { type: "projectSnapshot", durationMs: null }]
      ]);
      await writeFile(join(stage, "original-script.txt"), snapshot.project.scriptSource, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await writeFile(join(stage, "readable-transcript.txt"), transcript(plan, "readable"), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await writeFile(join(stage, "tts-transcript.txt"), transcript(plan, "tts"), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await writeFile(join(stage, "project-snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });

      const fileMetadata = async (fileName: string) => {
        const bytes = await readFile(join(stage, fileName));
        return { fileName, checksum: sha256(bytes), sizeBytes: bytes.byteLength };
      };
      const initialMetadata = await Promise.all([...files.keys()].map(fileMetadata));
      let timelineMs = 0;
      const sectionTimestamps: Array<{ title: string; startMs: number }> = [];
      for (const entry of plan.entries) {
        if (entry.type === "section") sectionTimestamps.push({ title: entry.title, startMs: timelineMs });
        else timelineMs += actualDurations.get(entry.ordinal) ?? 0;
      }
      const manifest = {
        schemaVersion: 1, renderId, projectId: plan.projectId, planId: plan.id, createdAt: now().toISOString(),
        scriptHash: plan.scriptHash, snapshotHash: plan.snapshotHash, planHash: plan.planHash,
        connection: { profileId: snapshot.connection.profileId, profileName: snapshot.connection.profileName, profileSource: snapshot.connection.profileSource, modelId: snapshot.connection.modelId, serverIdentityHash: snapshot.connection.serverIdentityHash },
        versions: snapshot.versions,
        encoding: { format: "mp3", codec: "libmp3lame", bitRate: 192_000, sampleRate: 24_000, channels: 1 },
        durationMs: mp3Probe.durationMs,
        sectionTimestamps,
        progress: job.progress,
        entries: plan.entries.map((entry) => ({
          ...entry,
          actualDurationMs: actualDurations.get(entry.ordinal) ?? null,
          ...(entry.type === "speech" ? { actualCacheStatus: actualCacheStatuses.get(entry.ordinal) ?? null } : {})
        })),
        artifacts: initialMetadata
      };
      await writeFile(join(stage, "render-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      files.set("render-manifest.json", { type: "manifest", durationMs: null });
      const checksummed = await Promise.all([...files.keys()].map(fileMetadata));
      await writeFile(join(stage, "checksums.txt"), `${checksummed.map(({ checksum, fileName }) => `${checksum}  ${fileName}`).join("\n")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      files.set("checksums.txt", { type: "checksums", durationMs: null });

      const finalDirectory = join(root, renderId);
      await rename(stage, finalDirectory);
      const createdAt = now().toISOString();
      const artifacts: Array<RenderArtifact & { path: string }> = [];
      for (const [fileName, details] of files) {
        const metadata = await fileMetadataAt(join(finalDirectory, fileName));
        artifacts.push({
          contractVersion: RENDER_CONTRACT_VERSION, id: RenderArtifactIdSchema.parse(createId()), renderId,
          type: details.type, fileName, sizeBytes: metadata.sizeBytes, checksum: metadata.checksum,
          durationMs: details.durationMs, createdAt, path: join(finalDirectory, fileName)
        });
      }
      options.repository.replaceRenderArtifacts(renderId, artifacts);
      update(job, "complete");
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
      const phase = job.state;
      if (closing) update(job, "queued", {}, null);
      else if (userCanceled.has(renderId)) update(job, "canceled", {}, null);
      else {
        const sanitized = safeRenderError(error, phase, currentEntry);
        if (currentEntry) options.repository.updateRenderSegment({ ...segment(renderId, currentEntry), state: "failed", error: sanitized });
        update(job, "failed", {}, sanitized);
      }
    } finally {
      controllers.delete(renderId);
      userCanceled.delete(renderId);
    }
  }

  async function fileMetadataAt(path: string): Promise<{ checksum: string; sizeBytes: number }> {
    const bytes = await readFile(path);
    return { checksum: sha256(bytes), sizeBytes: bytes.byteLength };
  }

  async function drain(): Promise<void> {
    while (!closing && queue.length > 0) {
      const renderId = queue.shift()!;
      const job = options.repository.getRenderJob(renderId);
      if (NONTERMINAL.has(job.state)) await execute(renderId);
    }
  }

  for (const interrupted of options.repository.listRecoverableRenderJobs()) {
    const recovered = RenderJobSchema.parse({
      ...interrupted, state: "queued", error: null, startedAt: null, finishedAt: null,
      progress: { ...interrupted.progress, phase: "queued", elapsedMs: 0 }
    });
    options.repository.updateRenderJob(recovered);
    enqueue(recovered.id);
  }

  const createJob = async (planIdInput: string, retryOfRenderId: string | null): Promise<RenderJob> => {
    const plan = await options.plans.get(RenderPlanIdSchema.parse(planIdInput));
    const id = RenderIdSchema.parse(createId());
    const job = RenderJobSchema.parse({
      contractVersion: RENDER_CONTRACT_VERSION, id, projectId: plan.projectId, planId: plan.id,
      retryOfRenderId, state: "queued", progress: initialProgress(plan), error: null,
      createdAt: now().toISOString(), startedAt: null, finishedAt: null
    });
    options.repository.createRenderJob(job, plan.entries.map((entry) => segment(id, entry)));
    enqueue(id);
    return job;
  };

  return {
    async start(planId) {
      const normalized = RenderPlanIdSchema.parse(planId);
      const active = options.repository.findActiveRenderJob(normalized);
      if (active) return active;
      const starting = startingPlans.get(normalized);
      if (starting) return await starting;
      const promise = createJob(normalized, null).finally(() => startingPlans.delete(normalized));
      startingPlans.set(normalized, promise);
      return await promise;
    },
    async list(projectId) { return await Promise.resolve(options.repository.listRenderJobs(projectId)); },
    async get(renderId) { return await Promise.resolve(options.repository.getRenderJob(RenderIdSchema.parse(renderId))); },
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
      controllers.get(renderId)?.abort(new DOMException("The render was canceled.", "AbortError"));
      return await Promise.resolve(options.repository.getRenderJob(renderId));
    },
    async retry(renderIdInput) {
      const prior = options.repository.getRenderJob(RenderIdSchema.parse(renderIdInput));
      if (prior.state !== "failed") throw new Error("Only failed renders can be retried.");
      return options.repository.findActiveRenderJob(prior.planId) ?? await createJob(prior.planId, prior.id);
    },
    async listArtifacts(renderId) { return await Promise.resolve(options.repository.listRenderArtifacts(RenderIdSchema.parse(renderId))); },
    async exportArtifact(artifactId) {
      const { artifact } = options.repository.getRenderArtifactPath(RenderArtifactIdSchema.parse(artifactId));
      return await Promise.resolve({ disposition: "download" as const, fileName: artifact.fileName });
    },
    async resolveArtifact(artifactId) {
      const resolved = options.repository.getRenderArtifactPath(RenderArtifactIdSchema.parse(artifactId));
      const path = resolve(resolved.path);
      const expectedDirectory = join(root, resolved.artifact.renderId);
      const details = await lstat(path);
      if (dirname(path) !== expectedDirectory || basename(path) !== resolved.artifact.fileName || !details.isFile() || details.isSymbolicLink()) {
        throw new Error("The render artifact path failed validation.");
      }
      const metadata = await fileMetadataAt(path);
      if (metadata.checksum !== resolved.artifact.checksum || metadata.sizeBytes !== resolved.artifact.sizeBytes) throw new Error("The render artifact failed integrity validation.");
      return { artifact: resolved.artifact, path };
    },
    async close() {
      closing = true;
      for (const controller of controllers.values()) controller.abort(new DOMException("StudyNarrator is shutting down.", "AbortError"));
      await drainPromise;
    }
  };
}
