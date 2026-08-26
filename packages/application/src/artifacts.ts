import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { zipSync } from "fflate";
import {
  RENDER_CONTRACT_VERSION,
  RenderArtifactIdSchema,
  RenderHistorySegmentCollectionSchema,
  RenderIdSchema,
  RenderWaveformSchema,
  type ProjectSnapshot,
  type RenderArtifact,
  type RenderHistorySegment,
  type RenderPlan,
  type RenderPlanEntry,
  type RenderProgress,
  type RenderWaveform,
} from "@studynarrator/shared-types";
import {
  concatenateWavs,
  encodeMp3,
  extractWaveformPeaks,
  normalizeSpeechWav,
  probeAudioFile,
  writeFinalMp3Metadata,
  type RenderPlanStore,
} from "@studynarrator/rendering";
import type { ResolvedRenderMedia } from "./renderMedia.js";
import type { RenderRepository } from "./render.js";

class RenderMediaUnavailableError extends Error {
  readonly code = "RENDER_MEDIA_UNAVAILABLE";
}

export interface RenderArtifacts {
  assembleAudio(
    stage: string,
    orderedAudio: string[],
    signal: AbortSignal,
  ): Promise<string>;
  cleanupStage(stage: string): Promise<void>;
  createStage(renderId: string): Promise<string>;
  encodeAudio(
    stage: string,
    projectName: string,
    combined: string,
    signal: AbortSignal,
  ): Promise<{
    mp3Name: string;
    mp3Path: string;
    mp3Probe: Awaited<ReturnType<typeof probeAudioFile>>;
  }>;
  publishArtifacts(options: {
    stage: string;
    renderId: string;
    plan: RenderPlan;
    snapshot: ProjectSnapshot;
    mp3Name: string;
    mp3Path: string;
    mp3Probe: Awaited<ReturnType<typeof probeAudioFile>>;
    combined: string;
    actualCacheStatuses: Map<number, "hit" | "miss">;
    actualDurations: Map<number, number>;
    progress: RenderProgress;
  }): Promise<void>;
  resolveArtifactFile(
    artifactId: string,
  ): Promise<{ artifact: RenderArtifact; path: string }>;
  resolveDetailsArchive(renderId: string): Promise<{
    bytes: Uint8Array;
    fileName: string;
    mimeType: "application/zip";
  }>;
  resolveRenderAudio(renderId: string): Promise<ResolvedRenderMedia>;
  resolveSegmentAudio(
    renderId: string,
    ordinal: number,
  ): Promise<ResolvedRenderMedia>;
  segmentPath(renderId: string, fileName: string): string;
  stagePath(renderId: string): string;
  buildHistorySegments(renderId: string): Promise<RenderHistorySegment[]>;
  waveformFor(renderId: string): Promise<RenderWaveform>;
  writePauseAsset(
    stage: string,
    ordinal: number,
    bytes: Uint8Array,
  ): Promise<string>;
  writeSpeechAudio(
    stage: string,
    entry: Extract<RenderPlanEntry, { type: "speech" }>,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<{
    output: string;
    audioFileName: string;
    durationMs: number;
    sizeBytes: number;
    checksum: string;
  }>;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
  return normalized.slice(0, 80) || "study-narration";
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

export async function createRenderArtifacts(options: {
  repository: RenderRepository;
  plans: RenderPlanStore;
  dataDirectory: string;
  ffmpegPath?: string | undefined;
  ffprobePath?: string | undefined;
  now: () => Date;
  createId: () => string;
}): Promise<RenderArtifacts> {
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

  const ffprobePath =
    options.ffprobePath ??
    (options.ffmpegPath
      ? join(
          dirname(options.ffmpegPath),
          process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
        )
      : undefined);

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

  async function replaceFileAtomically(
    path: string,
    bytes: Uint8Array,
  ): Promise<{ checksum: string; sizeBytes: number }> {
    let temporary: string | undefined;
    try {
      temporary = join(
        dirname(path),
        `.${basename(path)}.${options.createId()}.tmp`,
      );
      await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
      const metadata = await fileMetadataAt(temporary);
      await rename(temporary, path);
      return metadata;
    } catch {
      if (temporary) await rm(temporary, { force: true });
      throw new Error("The render artifact could not be updated.");
    }
  }

  async function refreshTitleForCurrentProject(renderId: string) {
    const job = options.repository.getRenderJob(renderId);
    const currentProject = options.repository.getProject?.(job.projectId);
    if (!currentProject) return;
    const artifacts = options.repository.listRenderArtifacts(renderId);
    const mp3 = artifacts.find(({ type }) => type === "mp3");
    const manifest = artifacts.find(({ type }) => type === "manifest");
    const checksums = artifacts.find(({ type }) => type === "checksums");
    if (!mp3 || !manifest || !checksums)
      throw new Error("The render details package is incomplete.");

    const resolvedArtifacts = new Map(
      await Promise.all(
        artifacts.map(
          async (artifact) =>
            [artifact.id, await resolveArtifactFile(artifact.id)] as const,
        ),
      ),
    );
    const mp3Path = resolvedArtifacts.get(mp3.id)?.path;
    const manifestPath = resolvedArtifacts.get(manifest.id)?.path;
    const checksumsPath = resolvedArtifacts.get(checksums.id)?.path;
    if (!mp3Path || !manifestPath || !checksumsPath)
      throw new Error("The render details package is incomplete.");

    const persistArtifacts = (values: RenderArtifact[]) => {
      options.repository.replaceRenderArtifacts(
        renderId,
        values.map((artifact) => {
          const path = resolvedArtifacts.get(artifact.id)?.path;
          if (!path)
            throw new Error("The render details package is incomplete.");
          return { ...artifact, path };
        }),
      );
    };

    const temporary = join(
      dirname(mp3Path),
      `.${basename(mp3Path)}.${options.createId()}.tmp`,
    );
    let mp3Metadata: { checksum: string; sizeBytes: number };
    try {
      await writeFile(temporary, await readFile(mp3Path), {
        mode: 0o600,
        flag: "wx",
      });
      writeFinalMp3Metadata({
        path: temporary,
        title: currentProject.name,
        year: options.now().getFullYear(),
      });
      mp3Metadata = await fileMetadataAt(temporary);
      await rename(temporary, mp3Path);
    } catch {
      await rm(temporary, { force: true });
      throw new Error("Final MP3 metadata could not be updated.");
    }
    let refreshedArtifacts = artifacts.map((artifact) =>
      artifact.id === mp3.id ? { ...artifact, ...mp3Metadata } : artifact,
    );
    persistArtifacts(refreshedArtifacts);
    let manifestValue: { artifacts?: unknown };
    try {
      manifestValue = JSON.parse(await readFile(manifestPath, "utf8")) as {
        artifacts?: unknown;
      };
      if (!Array.isArray(manifestValue.artifacts)) throw new Error();
      const manifestArtifacts = manifestValue.artifacts as unknown[];
      const matchingArtifact = manifestArtifacts.find(
        (artifact): artifact is Record<string, unknown> =>
          typeof artifact === "object" &&
          artifact !== null &&
          "fileName" in artifact &&
          artifact.fileName === mp3.fileName,
      );
      if (!matchingArtifact) throw new Error();
      matchingArtifact.checksum = mp3Metadata.checksum;
      matchingArtifact.sizeBytes = mp3Metadata.sizeBytes;
    } catch {
      throw new Error("The render manifest could not be updated.");
    }
    const manifestMetadata = await replaceFileAtomically(
      manifestPath,
      new TextEncoder().encode(`${JSON.stringify(manifestValue, null, 2)}\n`),
    );
    refreshedArtifacts = refreshedArtifacts.map((artifact) =>
      artifact.id === manifest.id
        ? { ...artifact, ...manifestMetadata }
        : artifact,
    );
    persistArtifacts(refreshedArtifacts);
    const checksumContents = refreshedArtifacts
      .filter(({ type }) => type !== "checksums")
      .map(({ checksum, fileName }) => `${checksum}  ${fileName}`)
      .join("\n");
    const checksumsMetadata = await replaceFileAtomically(
      checksumsPath,
      new TextEncoder().encode(`${checksumContents}\n`),
    );
    refreshedArtifacts = refreshedArtifacts.map((artifact) =>
      artifact.id === checksums.id
        ? { ...artifact, ...checksumsMetadata }
        : artifact,
    );
    persistArtifacts(refreshedArtifacts);
  }

  async function resolveRenderAudio(
    renderId: string,
  ): Promise<ResolvedRenderMedia> {
    const normalized = RenderIdSchema.parse(renderId);
    await refreshTitleForCurrentProject(normalized);
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
      const temporary = join(
        dirname(media.path),
        `waveform.${options.createId()}.tmp`,
      );
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
    await refreshTitleForCurrentProject(renderId);
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

  return {
    async assembleAudio(stage, orderedAudio, signal) {
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
        signal,
      });
      return combined;
    },
    async cleanupStage(stage) {
      await rm(stage, { recursive: true, force: true });
    },
    async createStage(renderId) {
      const stage = join(stagingRoot, renderId);
      await mkdir(stage, { mode: 0o700 });
      await mkdir(join(stage, "segments"), { mode: 0o700 });
      await mkdir(join(stage, "work"), { mode: 0o700 });
      return stage;
    },
    async encodeAudio(stage, projectName, combined, signal) {
      const mp3Name = `${slug(projectName)}.mp3`;
      const mp3Path = join(stage, mp3Name);
      await encodeMp3({
        inputPath: combined,
        outputPath: mp3Path,
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
        signal,
      });
      writeFinalMp3Metadata({
        path: mp3Path,
        title: projectName,
        year: options.now().getFullYear(),
      });
      const mp3Probe = await probeAudioFile({
        inputPath: mp3Path,
        ...(ffprobePath ? { ffprobePath } : {}),
        signal,
      });
      if (!mp3Probe.decodable || !mp3Probe.formatName?.includes("mp3"))
        throw new Error("Final MP3 validation failed.");
      return { mp3Name, mp3Path, mp3Probe };
    },
    async publishArtifacts({
      stage,
      renderId,
      plan,
      snapshot,
      mp3Name,
      mp3Path,
      mp3Probe,
      combined,
      actualCacheStatuses,
      actualDurations,
      progress,
    }) {
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
        createdAt: options.now().toISOString(),
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
        progress,
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
      const createdAt = options.now().toISOString();
      const artifacts: Array<RenderArtifact & { path: string }> = [];
      for (const [fileName, details] of files) {
        const metadata = await fileMetadataAt(join(finalDirectory, fileName));
        artifacts.push({
          contractVersion: RENDER_CONTRACT_VERSION,
          id: RenderArtifactIdSchema.parse(options.createId()),
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
    },
    resolveArtifactFile,
    resolveDetailsArchive,
    resolveRenderAudio,
    resolveSegmentAudio,
    segmentPath: (renderId, fileName) =>
      join(root, renderId, "segments", fileName),
    stagePath: (renderId) => join(stagingRoot, renderId),
    buildHistorySegments,
    waveformFor,
    async writePauseAsset(stage, ordinal, bytes) {
      const output = `work/pause-${String(ordinal).padStart(6, "0")}.wav`;
      await writeFile(join(stage, output), bytes, {
        mode: 0o600,
        flag: "wx",
      });
      return output;
    },
    async writeSpeechAudio(stage, entry, bytes, signal) {
      const audioFileName = `${String(entry.ordinal).padStart(6, "0")}.wav`;
      const raw = join(
        stage,
        "work",
        `raw-${String(entry.ordinal).padStart(6, "0")}.wav`,
      );
      const output = `segments/${audioFileName}`;
      await writeFile(raw, bytes, { mode: 0o600, flag: "wx" });
      await normalizeSpeechWav({
        inputPath: raw,
        outputPath: join(stage, output),
        gainDb: entry.gainDb,
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
        signal,
      });
      await rm(raw);
      const audio = await probeAudioFile({
        inputPath: join(stage, output),
        ...(ffprobePath ? { ffprobePath } : {}),
        signal,
      });
      if (!audio.decodable)
        throw new Error("Normalized speech did not decode.");
      const segmentMetadata = await fileMetadataAt(join(stage, output));
      return {
        output,
        audioFileName,
        durationMs: audio.durationMs,
        sizeBytes: segmentMetadata.sizeBytes,
        checksum: segmentMetadata.checksum,
      };
    },
  };
}
