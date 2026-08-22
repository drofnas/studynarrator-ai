import { describe, expect, it } from "vitest";
import {
  DEFAULT_MILLISECONDS_PER_NORMALIZED_CHARACTER,
  estimateCacheBytes,
  estimateMp3Bytes,
  estimatePeakDiskBytes,
  estimatePlanDurationMs,
  estimateSpeechMs,
  type EstimablePlan,
  type EstimablePlanEntry,
  type EstimationCalibration,
  type PeakDiskEstimateInput,
} from "./index.js";

describe("render duration estimation", () => {
  it("bundles a conservative default derived from the 15,000-word product assumption", () => {
    expect(DEFAULT_MILLISECONDS_PER_NORMALIZED_CHARACTER).toBe(80);
    expect(
      estimateSpeechMs(
        15_000 * 6,
        DEFAULT_MILLISECONDS_PER_NORMALIZED_CHARACTER,
        1,
      ),
    ).toBe(2 * 60 * 60 * 1_000);
  });

  it("estimates normalized characters at the requested speed and rounds milliseconds", () => {
    expect(estimateSpeechMs(10, 80, 1)).toBe(800);
    expect(estimateSpeechMs(10, 80, 2)).toBe(400);
    expect(estimateSpeechMs(1, 2.5, 2)).toBe(1);
    expect(estimateSpeechMs(0, 80, 1)).toBe(0);
  });

  it("treats supplied counts and chunk string lengths as UTF-16 code units", () => {
    const normalizedText = "A😀";

    expect(normalizedText.length).toBe(3);
    expect(estimateSpeechMs(normalizedText.length, 100, 1)).toBe(300);
    expect(
      estimatePlanDurationMs(
        {
          entries: [
            {
              type: "speech",
              voiceId: "voice-a",
              speed: 1,
              chunks: [{ text: normalizedText }],
            },
          ],
        },
        { defaultMillisecondsPerNormalizedCharacter: 100 },
      ),
    ).toBe(300);
  });

  it("uses per-voice calibration, falls back to an override, and adds pauses exactly", () => {
    const renderPlanShapedValue = {
      schemaVersion: 1,
      entries: [
        {
          type: "speech" as const,
          ordinal: 1,
          voiceId: "calibrated-voice",
          speed: 2,
          chunks: [{ ordinal: 1, text: "A😀" }, { text: "bc" }],
        },
        { type: "pause" as const, ordinal: 2, durationMs: 333 },
        { type: "section" as const, ordinal: 3, title: "Ignored" },
        {
          type: "speech" as const,
          ordinal: 4,
          voiceId: "fallback-voice",
          speed: 1,
          chunks: [{ text: "test" }],
        },
      ],
    };

    const calibration: EstimationCalibration = {
      millisecondsPerNormalizedCharacterByVoice: {
        "calibrated-voice": 100,
      },
      defaultMillisecondsPerNormalizedCharacter: 50,
    };

    expect(estimatePlanDurationMs(renderPlanShapedValue, calibration)).toBe(
      783,
    );
  });

  it("uses the bundled fallback when calibration is absent and rounds only the final total", () => {
    expect(
      estimatePlanDurationMs({
        entries: [
          {
            type: "speech",
            voiceId: "voice-a",
            speed: 1,
            chunks: [{ text: "1234567890" }],
          },
        ],
      }),
    ).toBe(800);

    const twoFractionalEntries: EstimablePlan = {
      entries: ["voice-a", "voice-b"].map((voiceId) => ({
        type: "speech" as const,
        voiceId,
        speed: 1,
        chunks: [{ text: "x" }],
      })),
    };
    expect(
      estimatePlanDurationMs(twoFractionalEntries, {
        defaultMillisecondsPerNormalizedCharacter: 0.6,
      }),
    ).toBe(1);
  });

  it("stays within 15% of a representative fixture's known segment durations", () => {
    const entries: EstimablePlanEntry[] = [
      {
        type: "speech",
        voiceId: "narrator",
        speed: 1,
        chunks: [{ text: "Neural pathways strengthen through active recall." }],
      },
      { type: "pause", durationMs: 750 },
      {
        type: "speech",
        voiceId: "narrator",
        speed: 1.1,
        chunks: [{ text: "Review difficult ideas again after a short delay." }],
      },
    ];
    const plan: EstimablePlan = { entries };
    const actualSegmentDurationsMs = [4_100, 750, 3_800];
    const actualDurationMs = actualSegmentDurationsMs.reduce(
      (total, durationMs) => total + durationMs,
      0,
    );
    const estimatedDurationMs = estimatePlanDurationMs(plan);

    expect(
      Math.abs(estimatedDurationMs - actualDurationMs),
    ).toBeLessThanOrEqual(actualDurationMs * 0.15);
  });

  it.each([
    () => estimateSpeechMs(-1, 80, 1),
    () => estimateSpeechMs(Number.NaN, 80, 1),
    () => estimateSpeechMs(Number.POSITIVE_INFINITY, 80, 1),
    () => estimateSpeechMs(1, 0, 1),
    () => estimateSpeechMs(1, Number.POSITIVE_INFINITY, 1),
    () => estimateSpeechMs(1, 80, 0),
    () => estimateSpeechMs(1, 80, Number.NaN),
    () => estimateSpeechMs(Number.MAX_VALUE, 80, 1),
  ])("rejects invalid or unsupported speech inputs %#", (estimate) => {
    expect(estimate).toThrow(RangeError);
  });

  it("rejects invalid plan timing and calibration values", () => {
    expect(() =>
      estimatePlanDurationMs({
        entries: [{ type: "pause", durationMs: -1 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      estimatePlanDurationMs({
        entries: [
          {
            type: "speech",
            voiceId: "voice-a",
            speed: 0,
            chunks: [{ text: "text" }],
          },
        ],
      }),
    ).toThrow(RangeError);
    expect(() =>
      estimatePlanDurationMs(
        { entries: [] },
        { defaultMillisecondsPerNormalizedCharacter: 0 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      estimatePlanDurationMs(
        { entries: [] },
        {
          millisecondsPerNormalizedCharacterByVoice: {
            "voice-a": Number.NaN,
          },
        },
      ),
    ).toThrow(RangeError);
  });
});

describe("render size estimation", () => {
  it("uses the exact decimal-kbps MP3 formula and ceiling rounding", () => {
    expect(estimateMp3Bytes(90_000, 192)).toBe(2_160_000);
    expect(estimateMp3Bytes(1, 1)).toBe(1);
    expect(estimateMp3Bytes(0, 128)).toBe(0);
  });

  it("estimates 48,000 cache bytes per second for 24 kHz 16-bit mono PCM", () => {
    expect(estimateCacheBytes(1_000, 24_000, 2, 1)).toBe(48_000);
    expect(estimateCacheBytes(1_500, 24_000, 2, 1)).toBe(72_000);
    expect(estimateCacheBytes(0, 24_000, 2, 1)).toBe(0);
  });

  it("sums named cache, intermediate PCM, and final MP3 peak components", () => {
    const speechCacheBytes = 96_000;
    const intermediatePcmBytes = estimateCacheBytes(2_500, 24_000, 2, 1);
    const finalMp3Bytes = estimateMp3Bytes(2_500, 128);

    expect(intermediatePcmBytes).toBe(120_000);
    expect(finalMp3Bytes).toBe(40_000);
    const input: PeakDiskEstimateInput = {
      speechCacheBytes,
      totalDurationMs: 2_500,
      bitrateKbps: 128,
      sampleRate: 24_000,
      bytesPerSample: 2,
      channels: 1,
    };

    expect(estimatePeakDiskBytes(input)).toBe(
      speechCacheBytes + intermediatePcmBytes + finalMp3Bytes,
    );
  });

  it("returns zero peak bytes for an empty render", () => {
    expect(
      estimatePeakDiskBytes({
        speechCacheBytes: 0,
        totalDurationMs: 0,
        bitrateKbps: 128,
        sampleRate: 24_000,
        bytesPerSample: 2,
        channels: 1,
      }),
    ).toBe(0);
  });

  it.each([
    () => estimateMp3Bytes(-1, 128),
    () => estimateMp3Bytes(Number.NaN, 128),
    () => estimateMp3Bytes(1_000, 0),
    () => estimateMp3Bytes(1_000, Number.POSITIVE_INFINITY),
    () => estimateMp3Bytes(Number.MAX_VALUE, 128),
    () => estimateCacheBytes(-1, 24_000, 2, 1),
    () => estimateCacheBytes(1_000, 0, 2, 1),
    () => estimateCacheBytes(1_000, 24_000.5, 2, 1),
    () => estimateCacheBytes(1_000, 24_000, 0, 1),
    () => estimateCacheBytes(1_000, 24_000, 2, 1.5),
    () =>
      estimatePeakDiskBytes({
        speechCacheBytes: -1,
        totalDurationMs: 1_000,
        bitrateKbps: 128,
        sampleRate: 24_000,
        bytesPerSample: 2,
        channels: 1,
      }),
  ])("rejects invalid or unsupported size inputs %#", (estimate) => {
    expect(estimate).toThrow(RangeError);
  });
});
