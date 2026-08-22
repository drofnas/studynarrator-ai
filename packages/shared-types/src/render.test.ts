import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDER_START_OPTIONS,
  RENDER_DISK_HARD_RESERVE_PERCENT,
  RENDER_DISK_SOFT_RESERVE_PERCENT,
  RenderEstimateContextInputSchema,
  RenderEstimateContextResultSchema,
  RenderProjectStartInputSchema,
  RenderStartOptionsSchema,
  renderDiskSpaceBlockMessage,
  renderDiskSpaceUsableBytes,
  renderDiskSpaceWarningMessage,
} from "./render.js";

const timestamp = "2026-08-21T12:00:00.000Z";
const projectId = "00000000-0000-4000-8000-000000000001";
const calibration = {
  modelId: "model",
  voiceId: "voice",
  millisecondsPerNormalizedCharacter: 72,
  sampleCount: 3,
  updatedAt: timestamp,
};

describe("render start contract", () => {
  it("defaults the strict disk-space check to enabled", () => {
    expect(RenderStartOptionsSchema.parse(undefined)).toEqual(
      DEFAULT_RENDER_START_OPTIONS,
    );
    expect(RenderStartOptionsSchema.parse({})).toEqual(
      DEFAULT_RENDER_START_OPTIONS,
    );
    expect(RenderProjectStartInputSchema.parse({ projectId })).toEqual({
      projectId,
      options: { diskSpaceCheckEnabled: true },
    });
    expect(
      RenderStartOptionsSchema.parse({ diskSpaceCheckEnabled: false }),
    ).toEqual({ diskSpaceCheckEnabled: false });
    expect(() =>
      RenderStartOptionsSchema.parse({
        diskSpaceCheckEnabled: true,
        scriptLengthLimit: 10,
      }),
    ).toThrow();
  });

  it("uses exact integer reserve thresholds and safe byte-only messages", () => {
    expect(RENDER_DISK_HARD_RESERVE_PERCENT).toBe(10);
    expect(RENDER_DISK_SOFT_RESERVE_PERCENT).toBe(25);
    expect(
      renderDiskSpaceUsableBytes(106_667, RENDER_DISK_HARD_RESERVE_PERCENT),
    ).toBe(96_000);
    expect(
      renderDiskSpaceUsableBytes(120_000, RENDER_DISK_SOFT_RESERVE_PERCENT),
    ).toBe(90_000);
    expect(renderDiskSpaceBlockMessage(96_001, 106_667, 96_000)).toBe(
      "Render blocked: estimated peak disk use is 96001 bytes, but the data volume has 106667 free bytes and 96000 usable bytes after the required 10% reserve.",
    );
    expect(renderDiskSpaceWarningMessage(96_000, 120_000, 90_000)).toBe(
      "Disk space warning: estimated peak disk use is 96000 bytes; the data volume has 120000 free bytes and 90000 usable bytes after the recommended 25% reserve. Rendering will continue.",
    );
  });
});

describe("render estimate context contract", () => {
  it("accepts a nullable model and a bounded unique voice selection", () => {
    expect(
      RenderEstimateContextInputSchema.parse({
        modelId: null,
        voiceIds: ["voice-a", "voice-b"],
      }),
    ).toEqual({ modelId: null, voiceIds: ["voice-a", "voice-b"] });
    expect(() =>
      RenderEstimateContextInputSchema.parse({
        modelId: "model",
        voiceIds: ["voice", "voice"],
      }),
    ).toThrow("Estimate voice IDs must be unique");
    expect(() =>
      RenderEstimateContextInputSchema.parse({
        modelId: "model",
        voiceIds: [],
        projectName: "must not cross the boundary",
      }),
    ).toThrow();
  });

  it("accepts only safe free-space bytes and unique strict calibrations", () => {
    expect(
      RenderEstimateContextResultSchema.parse({
        freeSpaceBytes: 10_000,
        calibrations: [calibration],
      }),
    ).toEqual({ freeSpaceBytes: 10_000, calibrations: [calibration] });
    expect(() =>
      RenderEstimateContextResultSchema.parse({
        freeSpaceBytes: Number.MAX_SAFE_INTEGER + 1,
        calibrations: [],
      }),
    ).toThrow();
    expect(() =>
      RenderEstimateContextResultSchema.parse({
        freeSpaceBytes: 10_000,
        calibrations: [calibration, calibration],
      }),
    ).toThrow("Estimate calibrations must be unique");
    expect(() =>
      RenderEstimateContextResultSchema.parse({
        freeSpaceBytes: 10_000,
        calibrations: [{ ...calibration, secret: "must not cross" }],
      }),
    ).toThrow();
  });
});
