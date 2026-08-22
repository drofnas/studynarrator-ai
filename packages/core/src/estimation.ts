interface EstimableSpeechChunk {
  /** Normalized text measured with JavaScript string length (UTF-16 code units). */
  readonly text: string;
}

interface EstimableSpeechEntry {
  readonly type: "speech";
  readonly voiceId: string;
  readonly speed: number;
  readonly chunks: readonly EstimableSpeechChunk[];
}

interface EstimablePauseEntry {
  readonly type: "pause";
  readonly durationMs: number;
}

interface EstimableSectionEntry {
  readonly type: "section";
}

export type EstimablePlanEntry =
  EstimableSpeechEntry | EstimablePauseEntry | EstimableSectionEntry;

/** The minimal RenderPlan-compatible shape needed for duration estimation. */
export interface EstimablePlan {
  readonly entries: readonly EstimablePlanEntry[];
}

export interface EstimationCalibration {
  readonly millisecondsPerNormalizedCharacterByVoice?: Readonly<
    Record<string, number>
  >;
  readonly defaultMillisecondsPerNormalizedCharacter?: number;
}

export interface PeakDiskEstimateInput {
  /** Estimated bytes occupied by synthesized speech in the cache. */
  readonly speechCacheBytes: number;
  /** Speech plus exact pauses, in milliseconds. */
  readonly totalDurationMs: number;
  readonly bitrateKbps: number;
  readonly sampleRate: number;
  readonly bytesPerSample: number;
  readonly channels: number;
}

/**
 * 80 ms per normalized UTF-16 code unit approximates two hours for 15,000
 * words at six code units per word (about 125 words per minute).
 */
export const DEFAULT_MILLISECONDS_PER_NORMALIZED_CHARACTER = 80;

function requireNonnegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be a finite nonnegative number.`);
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be a finite positive number.`);
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive safe integer.`);
}

function requireByteCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a nonnegative safe integer.`);
}

function roundedSafeInteger(value: number, name: string): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0)
    throw new RangeError(`${name} exceeds the supported numeric range.`);
  return rounded;
}

function ceilingSafeInteger(value: number, name: string): number {
  const rounded = Math.ceil(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0)
    throw new RangeError(`${name} exceeds the supported numeric range.`);
  return rounded;
}

function speechMilliseconds(
  normalizedCharacters: number,
  millisecondsPerCharacter: number,
  speed: number,
): number {
  requireNonnegativeFinite(normalizedCharacters, "normalizedCharacters");
  requirePositiveFinite(millisecondsPerCharacter, "msPerCharacter");
  requirePositiveFinite(speed, "speed");
  return (normalizedCharacters * millisecondsPerCharacter) / speed;
}

/** Returns speech milliseconds rounded to the nearest integer. */
export function estimateSpeechMs(
  normalizedCharacters: number,
  msPerCharacter: number,
  speed: number,
): number {
  return roundedSafeInteger(
    speechMilliseconds(normalizedCharacters, msPerCharacter, speed),
    "Estimated speech duration",
  );
}

/**
 * Estimates speech from normalized chunk string lengths, adds pauses exactly,
 * ignores sections, and rounds the final total to the nearest millisecond.
 */
export function estimatePlanDurationMs(
  plan: EstimablePlan,
  calibration: EstimationCalibration = {},
): number {
  const defaultMillisecondsPerCharacter =
    calibration.defaultMillisecondsPerNormalizedCharacter ??
    DEFAULT_MILLISECONDS_PER_NORMALIZED_CHARACTER;
  requirePositiveFinite(
    defaultMillisecondsPerCharacter,
    "defaultMillisecondsPerNormalizedCharacter",
  );

  const perVoice = calibration.millisecondsPerNormalizedCharacterByVoice ?? {};
  for (const [voiceId, millisecondsPerCharacter] of Object.entries(perVoice))
    requirePositiveFinite(
      millisecondsPerCharacter,
      `millisecondsPerNormalizedCharacterByVoice[${voiceId}]`,
    );

  let durationMs = 0;
  for (const entry of plan.entries) {
    if (entry.type === "section") continue;
    if (entry.type === "pause") {
      requireNonnegativeFinite(entry.durationMs, "pause.durationMs");
      durationMs += entry.durationMs;
      continue;
    }

    const normalizedCharacters = entry.chunks.reduce(
      (total, chunk) => total + chunk.text.length,
      0,
    );
    const calibratedMillisecondsPerCharacter = Object.hasOwn(
      perVoice,
      entry.voiceId,
    )
      ? perVoice[entry.voiceId]
      : undefined;
    durationMs += speechMilliseconds(
      normalizedCharacters,
      calibratedMillisecondsPerCharacter ?? defaultMillisecondsPerCharacter,
      entry.speed,
    );
  }

  return roundedSafeInteger(durationMs, "Estimated plan duration");
}

/** Returns ceiling bytes at a decimal kilobits-per-second bitrate. */
export function estimateMp3Bytes(
  durationMs: number,
  bitrateKbps: number,
): number {
  requireNonnegativeFinite(durationMs, "durationMs");
  requirePositiveFinite(bitrateKbps, "bitrateKbps");
  return ceilingSafeInteger(
    (bitrateKbps * 1_000 * (durationMs / 1_000)) / 8,
    "Estimated MP3 size",
  );
}

/** Returns ceiling raw PCM bytes for the supplied duration and dimensions. */
export function estimateCacheBytes(
  durationMs: number,
  sampleRate: number,
  bytesPerSample: number,
  channels: number,
): number {
  requireNonnegativeFinite(durationMs, "durationMs");
  requirePositiveInteger(sampleRate, "sampleRate");
  requirePositiveInteger(bytesPerSample, "bytesPerSample");
  requirePositiveInteger(channels, "channels");
  return ceilingSafeInteger(
    (durationMs / 1_000) * sampleRate * bytesPerSample * channels,
    "Estimated cache size",
  );
}

/**
 * Returns cache + one total-duration PCM concatenation + one final MP3, in
 * bytes. No additional working-copy multiplier is included.
 */
export function estimatePeakDiskBytes(input: PeakDiskEstimateInput): number {
  requireByteCount(input.speechCacheBytes, "speechCacheBytes");
  const intermediatePcmBytes = estimateCacheBytes(
    input.totalDurationMs,
    input.sampleRate,
    input.bytesPerSample,
    input.channels,
  );
  const finalMp3Bytes = estimateMp3Bytes(
    input.totalDurationMs,
    input.bitrateKbps,
  );
  return ceilingSafeInteger(
    input.speechCacheBytes + intermediatePcmBytes + finalMp3Bytes,
    "Estimated peak disk size",
  );
}
