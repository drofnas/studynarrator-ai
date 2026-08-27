import { spawn } from "node:child_process";
import {
  RENDER_PLAN_CHANNELS,
  RENDER_PLAN_SAMPLE_RATE,
} from "./renderPlanStore.js";

interface AudioProbeMetadata {
  decodable: boolean;
  durationMs: number;
  bitRate: number | null;
  formatName: string | null;
}

export interface Mp3Metadata {
  title: string;
  artist: string;
  year: number;
  genre: string;
}

interface WaveformPeaks {
  durationMs: number;
  sampleRate: number;
  peaks: number[];
}

function processError(name: string): Error {
  return new Error(`${name} could not complete the audio operation.`);
}

async function runAudioProcess(
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  return await new Promise<string>((resolveProcess, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderrBytes = 0;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException("The operation was aborted.", "AbortError"),
        ),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 256_000)
        stdout += chunk.slice(0, 256_000 - stdout.length);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
    });
    child.once("error", () => finish(() => reject(processError(command))));
    child.once("close", (code) =>
      finish(() =>
        code === 0 && stderrBytes <= 256_000
          ? resolveProcess(stdout)
          : reject(processError(command)),
      ),
    );
  });
}

export async function extractWaveformPeaks(options: {
  inputPath: string;
  maxPeaks?: number;
  sampleRate?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  signal?: AbortSignal;
}): Promise<WaveformPeaks> {
  const maxPeaks = options.maxPeaks ?? 1_024;
  const sampleRate = options.sampleRate ?? 8_000;
  if (!Number.isInteger(maxPeaks) || maxPeaks < 1 || maxPeaks > 1_024)
    throw new Error("Waveform peak count is invalid.");
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 1_000 ||
    sampleRate > 48_000
  )
    throw new Error("Waveform sample rate is invalid.");
  const probe = await probeAudioFile({
    inputPath: options.inputPath,
    ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!probe.decodable)
    throw new Error("Waveform source audio did not decode.");
  if (options.signal?.aborted)
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new DOMException("The operation was aborted.", "AbortError");

  return await new Promise<WaveformPeaks>((resolvePeaks, reject) => {
    const child = spawn(
      options.ffmpegPath ?? "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        options.inputPath,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        String(sampleRate),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "pipe:1",
      ],
      { shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const peaks: number[] = [];
    let samplesPerPeak = Math.max(
      1,
      Math.ceil(((probe.durationMs / 1_000) * sampleRate) / maxPeaks),
    );
    let bucketSamples = 0;
    let bucketPeak = 0;
    let trailingByte: number | null = null;
    let stderrBytes = 0;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const compact = () => {
      const compacted: number[] = [];
      for (let index = 0; index < peaks.length; index += 2)
        compacted.push(Math.max(peaks[index] ?? 0, peaks[index + 1] ?? 0));
      peaks.splice(0, peaks.length, ...compacted);
      samplesPerPeak *= 2;
    };
    const emitPeak = () => {
      if (peaks.length >= maxPeaks) compact();
      peaks.push(bucketPeak);
      bucketSamples = 0;
      bucketPeak = 0;
    };
    const acceptSample = (sample: number) => {
      bucketPeak = Math.max(
        bucketPeak,
        Math.min(255, Math.round((Math.abs(sample) / 32_768) * 255)),
      );
      bucketSamples += 1;
      if (bucketSamples >= samplesPerPeak) emitPeak();
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          options.signal?.reason instanceof Error
            ? options.signal.reason
            : new DOMException("The operation was aborted.", "AbortError"),
        ),
      );
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      let offset = 0;
      if (trailingByte !== null && chunk.byteLength > 0) {
        const unsigned = trailingByte | (chunk[0]! << 8);
        acceptSample(unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned);
        trailingByte = null;
        offset = 1;
      }
      for (; offset + 1 < chunk.byteLength; offset += 2)
        acceptSample(chunk.readInt16LE(offset));
      if (offset < chunk.byteLength) trailingByte = chunk[offset]!;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
    });
    child.once("error", () =>
      finish(() => reject(processError(options.ffmpegPath ?? "ffmpeg"))),
    );
    child.once("close", (code) =>
      finish(() => {
        if (code !== 0 || stderrBytes > 256_000)
          reject(processError(options.ffmpegPath ?? "ffmpeg"));
        else {
          if (bucketSamples > 0) emitPeak();
          while (peaks.length > maxPeaks) compact();
          resolvePeaks({
            durationMs: probe.durationMs,
            sampleRate,
            peaks: peaks.length > 0 ? peaks : [0],
          });
        }
      }),
    );
  });
}

export async function normalizeSpeechWav(options: {
  inputPath: string;
  outputPath: string;
  gainDb: number;
  ffmpegPath?: string;
  signal?: AbortSignal;
}): Promise<void> {
  await runAudioProcess(
    options.ffmpegPath ?? "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      options.inputPath,
      "-af",
      `volume=${String(options.gainDb)}dB,alimiter=limit=0.95`,
      "-ar",
      String(RENDER_PLAN_SAMPLE_RATE),
      "-ac",
      String(RENDER_PLAN_CHANNELS),
      "-c:a",
      "pcm_s16le",
      options.outputPath,
    ],
    options.signal,
  );
}

export async function concatenateWavs(options: {
  listPath: string;
  outputPath: string;
  ffmpegPath?: string;
  signal?: AbortSignal;
}): Promise<void> {
  await runAudioProcess(
    options.ffmpegPath ?? "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      options.listPath,
      "-ar",
      String(RENDER_PLAN_SAMPLE_RATE),
      "-ac",
      String(RENDER_PLAN_CHANNELS),
      "-c:a",
      "pcm_s16le",
      options.outputPath,
    ],
    options.signal,
  );
}

export async function encodeMp3(options: {
  inputPath: string;
  outputPath: string;
  metadata?: Mp3Metadata;
  ffmpegPath?: string;
  signal?: AbortSignal;
}): Promise<void> {
  const metadataArgs = options.metadata
    ? [
        "-metadata",
        `title=${options.metadata.title}`,
        "-metadata",
        `artist=${options.metadata.artist}`,
        "-metadata",
        `date=${String(options.metadata.year)}`,
        "-metadata",
        `genre=${options.metadata.genre}`,
        "-id3v2_version",
        "3",
      ]
    : [];
  await runAudioProcess(
    options.ffmpegPath ?? "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      options.inputPath,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      ...metadataArgs,
      options.outputPath,
    ],
    options.signal,
  );
}

export async function probeAudioFile(options: {
  inputPath: string;
  ffprobePath?: string;
  signal?: AbortSignal;
}): Promise<AudioProbeMetadata> {
  const stdout = await runAudioProcess(
    options.ffprobePath ?? "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=format_name,duration,bit_rate:stream=codec_type",
      "-of",
      "json",
      options.inputPath,
    ],
    options.signal,
  );
  try {
    const value = JSON.parse(stdout) as {
      format?: {
        format_name?: unknown;
        duration?: unknown;
        bit_rate?: unknown;
      };
      streams?: Array<{ codec_type?: unknown }>;
    };
    const duration =
      typeof value.format?.duration === "string"
        ? Number(value.format.duration)
        : Number.NaN;
    const bitRate =
      typeof value.format?.bit_rate === "string"
        ? Number(value.format.bit_rate)
        : null;
    return {
      decodable:
        value.streams?.some(({ codec_type }) => codec_type === "audio") ===
          true && Number.isFinite(duration),
      durationMs: Number.isFinite(duration)
        ? Math.max(0, Math.round(duration * 1_000))
        : 0,
      bitRate:
        bitRate !== null && Number.isFinite(bitRate)
          ? Math.round(bitRate)
          : null,
      formatName:
        typeof value.format?.format_name === "string"
          ? value.format.format_name
          : null,
    };
  } catch {
    return { decodable: false, durationMs: 0, bitRate: null, formatName: null };
  }
}
