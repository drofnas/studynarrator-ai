import { describe, expect, it } from "vitest";
import {
  RenderEstimateContextInputSchema,
  RenderEstimateContextResultSchema,
} from "./render.js";

const timestamp = "2026-08-21T12:00:00.000Z";
const calibration = {
  modelId: "model",
  voiceId: "voice",
  millisecondsPerNormalizedCharacter: 72,
  sampleCount: 3,
  updatedAt: timestamp,
};

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
