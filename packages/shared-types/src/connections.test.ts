import { describe, expect, it } from "vitest";
import {
  ConnectionProfileMutationSchema,
  ConnectionProfileSchema,
  ConnectionTestSummarySchema,
  VoiceCatalogSchema
} from "./connections.js";

const stages = ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"].map((stage) => ({
  stage,
  status: "pass",
  code: `${stage.toUpperCase()}_OK`,
  message: `${stage} passed.`,
  durationMs: 1
}));

describe("G06 connection contracts", () => {
  it("accepts a one-shot credential mutation but excludes raw keys from profile output", () => {
    const secret = "g06-secret-must-not-appear";
    expect(ConnectionProfileMutationSchema.parse({
      profile: {
        name: "LAN Speaches",
        baseUrl: "http://speaches.lan:8000/v1",
        defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
        defaultVoiceId: "af_heart"
      },
      credential: { action: "replace", apiKey: secret }
    }).credential).toEqual({ action: "replace", apiKey: secret });

    const profile = ConnectionProfileSchema.parse({
      id: "lan-speaches",
      name: "LAN Speaches",
      baseUrl: "http://speaches.lan:8000",
      source: "saved",
      editable: true,
      credentialEntryAllowed: true,
      configured: true,
      apiKeyConfigured: true,
      defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      defaultVoiceId: "af_heart",
      timeoutSeconds: 120,
      retryCount: 2,
      responseFormat: "wav",
      lastTestedAt: null,
      lastSuccessfulTestAt: null,
      lastTestSummary: null,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z"
    });
    expect(JSON.stringify(profile)).not.toContain(secret);
    expect(Object.keys(profile)).not.toContain("apiKey");
  });

  it("requires one result for every progressive diagnostic stage", () => {
    expect(ConnectionTestSummarySchema.parse({
      schemaVersion: 1,
      overall: "connected",
      testedAt: "2026-08-12T12:00:00.000Z",
      httpStatus: 200,
      stages,
      availableModelIds: ["speaches-ai/Kokoro-82M-v1.0-ONNX"],
      availableVoiceIds: ["af_heart"]
    }).stages).toHaveLength(8);
    expect(() => ConnectionTestSummarySchema.parse({
      schemaVersion: 1,
      overall: "connected",
      testedAt: "2026-08-12T12:00:00.000Z",
      httpStatus: 200,
      stages: stages.slice(0, 7),
      availableModelIds: [],
      availableVoiceIds: null
    })).toThrow();
  });

  it("rejects duplicate or credential-shaped catalog content", () => {
    expect(VoiceCatalogSchema.parse({
      schemaVersion: 1,
      modelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      entries: [{ voiceId: "af_heart", label: "Heart", enabled: true }]
    }).entries[0]).toMatchObject({ voiceId: "af_heart", language: null });
    expect(() => VoiceCatalogSchema.parse({
      schemaVersion: 1,
      modelId: "model",
      entries: [{ voiceId: "same", label: "One" }, { voiceId: "same", label: "Two" }]
    })).toThrow(/Duplicate voice ID/u);
    expect(() => VoiceCatalogSchema.parse({
      schemaVersion: 1,
      modelId: "model",
      entries: [{ voiceId: "voice", label: "Voice", apiKey: "unsafe" }]
    })).toThrow();
  });
});
