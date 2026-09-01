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
  type RenderWaveform,
} from "@studynarrator/shared-types";
import {
  concatenateWavs,
  encodeMp3,
  extractWaveformPeaks,
  normalizeSpeechWav,
  probeAudioFile,
  remuxMp3Metadata,
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
  reconcileProjectName(projectId: string, projectName: string): Promise<void>;
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
  readFileSystemStats: (
    path: string,
  ) => Promise<{ bavail: bigint; bsize: bigint }>;
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

  async function regularFileSizeAt(path: string): Promise<number> {
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink() || details.size < 1)
      throw new Error("Render media must be a non-empty regular file.");
    return details.size;
  }

  async function segmentFileMetadataAt(
    path: string,
  ): Promise<{ checksum: string; sizeBytes: number }> {
    const sizeBytes = await regularFileSizeAt(path);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path))
      hash.update(chunk as Buffer);
    return { checksum: hash.digest("hex"), sizeBytes };
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
        expectedSize < 1 ||
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

  async function reconcileRenderMetadata(
    renderId: string,
    projectName: string,
  ) {
    const mp3 = options.repository
      .listRenderArtifacts(renderId)
      .find(({ type }) => type === "mp3");
    if (!mp3) return;
    const stored = options.repository.getRenderArtifactPath(mp3.id);
    const path = resolve(stored.path);
    const expectedDirectory = join(root, renderId);
    const sourceDetails = await lstat(path).catch(() => null);
    if (
      dirname(path) !== expectedDirectory ||
      basename(path) !== mp3.fileName ||
      !sourceDetails?.isFile() ||
      sourceDetails.isSymbolicLink() ||
      sourceDetails.size < 1
    )
      throw new Error("Final MP3 metadata could not be updated.");
    const existing = await probeAudioFile({
      inputPath: path,
      ...(ffprobePath ? { ffprobePath } : {}),
    });
    const persistCurrentMetadata = (sizeBytes: number, durationMs: number) => {
      options.repository.replaceRenderArtifacts(
        renderId,
        options.repository.listRenderArtifacts(renderId).map((artifact) => ({
          ...artifact,
          ...(artifact.id === mp3.id ? { sizeBytes, durationMs } : {}),
          path:
            artifact.id === mp3.id
              ? path
              : options.repository.getRenderArtifactPath(artifact.id).path,
        })),
      );
    };
    if (
      existing.decodable &&
      existing.formatName?.includes("mp3") &&
      existing.title === projectName &&
      existing.artist === "StudyNarrator AI"
    ) {
      if (
        mp3.sizeBytes !== sourceDetails.size ||
        mp3.durationMs !== existing.durationMs
      )
        try {
          persistCurrentMetadata(sourceDetails.size, existing.durationMs);
        } catch {
          throw new Error("Final MP3 metadata could not be updated.");
        }
      return;
    }
    const temporary = join(
      dirname(path),
      `.${basename(path, ".mp3")}.${options.createId()}.tmp.mp3`,
    );
    try {
      const storage = await options.readFileSystemStats(dirname(path));
      if (storage.bavail * storage.bsize < BigInt(sourceDetails.size))
        throw new Error();
      await remuxMp3Metadata({
        inputPath: path,
        outputPath: temporary,
        metadata: {
          title: projectName,
          artist: "StudyNarrator AI",
          year: options.now().getFullYear(),
          genre: "Speech",
        },
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
      });
      const probe = await probeAudioFile({
        inputPath: temporary,
        ...(ffprobePath ? { ffprobePath } : {}),
      });
      const sizeBytes = await regularFileSizeAt(temporary);
      if (
        !probe.decodable ||
        !probe.formatName?.includes("mp3") ||
        probe.title !== projectName ||
        probe.artist !== "StudyNarrator AI"
      )
        throw new Error();
      await rename(temporary, path);
      persistCurrentMetadata(sizeBytes, probe.durationMs);
    } catch {
      await rm(temporary, { force: true });
      throw new Error("Final MP3 metadata could not be updated.");
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
    const projectName = options.repository.getProject?.(
      options.repository.getRenderJob(normalized).projectId,
    )?.name;
    return {
      path,
      fileName: projectName ? `${slug(projectName)}.mp3` : artifact.fileName,
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
          durationMs: value.durationMs,
          sampleRate: value.sampleRate,
          peaks: value.peaks,
        });
      } catch {
        return null;
      }
    };
    const cached = await readCache();
    if (cached?.status === "available") return cached;
    let temporary: string | undefined;
    try {
      const waveform = await extractWaveformPeaks({
        inputPath: media.path,
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
        ...(ffprobePath ? { ffprobePath } : {}),
      });
      const available = RenderWaveformSchema.parse({
        status: "available",
        renderId: normalized,
        durationMs: waveform.durationMs,
        sampleRate: waveform.sampleRate,
        peaks: waveform.peaks,
      });
      if (available.status !== "available") throw new Error();
      temporary = join(
        dirname(media.path),
        `waveform.${options.createId()}.tmp`,
      );
      await writeFile(
        temporary,
        `${JSON.stringify({
          schemaVersion: RENDER_CONTRACT_VERSION,
          durationMs: available.durationMs,
          sampleRate: available.sampleRate,
          peaks: available.peaks,
        })}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await rename(temporary, cachePath);
      return available;
    } catch {
      if (temporary) await rm(temporary, { force: true });
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
      details.isSymbolicLink() ||
      details.size < 1
    ) {
      throw new Error("The render artifact path failed validation.");
    }
    if (details.size !== resolved.artifact.sizeBytes)
      throw new Error("The render artifact failed integrity validation.");
    return { artifact: resolved.artifact, path };
  }

  async function resolveDetailsArchive(renderIdInput: string) {
    const renderId = RenderIdSchema.parse(renderIdInput);
    const artifacts = options.repository.listRenderArtifacts(renderId);
    const expected = [
      "originalScript",
      "readableTranscript",
      "ttsTranscript",
      "projectSnapshot",
    ] as const;
    if (
      expected.some(
        (type) => !artifacts.some((artifact) => artifact.type === type),
      )
    )
      throw new Error("The render details package is incomplete.");
    const entries: Record<string, Uint8Array> = {};
    for (const type of expected) {
      const artifact = artifacts.find((candidate) => candidate.type === type);
      if (!artifact)
        throw new Error("The render details package is incomplete.");
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
        metadata: {
          title: projectName,
          artist: "StudyNarrator AI",
          year: options.now().getFullYear(),
          genre: "Speech",
        },
        signal,
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
            durationMs: waveform.durationMs,
            sampleRate: waveform.sampleRate,
            peaks: waveform.peaks,
          })}\n`,
          { encoding: "utf8", mode: 0o600, flag: "wx" },
        );
      } catch {
        // Waveform data is derived review metadata. Its fallback must never invalidate a completed render.
      }

      const finalDirectory = join(root, renderId);
      await rename(stage, finalDirectory);
      const createdAt = options.now().toISOString();
      const artifacts: Array<RenderArtifact & { path: string }> = [];
      for (const [fileName, details] of files) {
        const sizeBytes = await regularFileSizeAt(
          join(finalDirectory, fileName),
        );
        artifacts.push({
          contractVersion: RENDER_CONTRACT_VERSION,
          id: RenderArtifactIdSchema.parse(options.createId()),
          renderId,
          type: details.type,
          fileName,
          sizeBytes,
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
    async reconcileProjectName(projectId, projectName) {
      for (const job of options.repository.listRenderJobs(projectId)) {
        if (job.state === "complete")
          await reconcileRenderMetadata(job.id, projectName);
      }
    },
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
      const segmentMetadata = await segmentFileMetadataAt(join(stage, output));
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
