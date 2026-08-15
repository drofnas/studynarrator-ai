import { describe, expect, it } from "vitest";
import {
  ConnectionTestSummarySchema,
  SpeachesConnectionAuthoringSchema,
  SpeachesConnectionSchema,
  SpeechCatalogSchema,
  VoiceCatalogSchema
} from "./connections.js";

const stages = ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"].map((stage) => ({
  stage,
  status: "pass",
  code: `${stage.toUpperCase()}_OK`,
  message: `${stage} passed.`,
  durationMs: 1
}));

describe("connection contracts", () => {
  it("accepts one address-managed connection and rejects credential-shaped authoring", () => {
    const connection = SpeachesConnectionSchema.parse({
      baseUrl: "http://speaches.lan:8000",
      suppliedUrlForm: "v1",
      configured: true,
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
    expect(connection.baseUrl).toBe("http://speaches.lan:8000");
    expect(() => SpeachesConnectionAuthoringSchema.parse({
      baseUrl: "http://speaches.lan:8000", defaultModelId: "model", defaultVoiceId: "voice", apiKey: "unsafe"
    })).toThrow();
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
    }).entries[0]).toMatchObject({ voiceId: "af_heart", favorite: false, language: null });
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

  it("bounds strict model-scoped speech catalogs", () => {
    expect(SpeechCatalogSchema.parse({
      schemaVersion: 1,
      models: [{ modelId: "model", voices: [{ voiceId: "voice", name: "Voice", language: "English", gender: null }] }]
    }).models[0]?.voices[0]).toMatchObject({ voiceId: "voice" });
    expect(() => SpeechCatalogSchema.parse({
      schemaVersion: 1,
      models: [{ modelId: "model", voices: [{ voiceId: "same", name: null, language: null, gender: null }, { voiceId: "same", name: null, language: null, gender: null }] }]
    })).toThrow(/Duplicate voice ID/u);
    expect(() => SpeechCatalogSchema.parse({
      schemaVersion: 1,
      models: [{ modelId: "model", voices: [], endpoint: "private" }]
    })).toThrow();
  });
});
