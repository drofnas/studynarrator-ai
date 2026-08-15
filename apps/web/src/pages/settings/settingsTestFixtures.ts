import { vi } from "vitest";
import type { ConnectionTestOverall, ScratchpadClient, SpeachesConnection, SpeachesConnectionClient, SpeechCacheClient, VoiceCatalogClient } from "@studynarrator/shared-types";

export const cacheClient: SpeechCacheClient = {
  status: vi.fn(() => Promise.resolve({ contractVersion: 1 as const, entryCount: 0, totalBytes: 0, lastUsedAt: null, sessionHits: 0, sessionMisses: 0, sessionWrites: 0, sessionCorruptMisses: 0, inFlight: 0 })),
  clearAll: vi.fn(() => Promise.resolve({ contractVersion: 1 as const, entriesRemoved: 0, bytesFreed: 0 })),
  clearProject: vi.fn(), clearEntry: vi.fn()
};

export const timestamp = "2026-08-12T12:00:00.000Z";
export const scratchpadResult = {
  schemaVersion: 3 as const, id: "b3b58e96-e98f-4dbf-897b-e2fb4b3a7c5c", createdAt: timestamp,
  modelId: "model-b", voiceId: "voice-b2", voiceLabel: "Second", speed: 1,
  originalText: "sample", readableText: "sample", transformedText: "sample", lexiconApplied: false, warnings: [],
  cache: { status: "miss" as const, key: "a".repeat(64), byteLength: 3, createdAt: timestamp, lastUsedAt: timestamp }, audio: { mimeType: "audio/wav" as const, base64: "AQID", byteLength: 3 }
};
export const scratchpadClient = { preview: vi.fn(() => Promise.resolve(scratchpadResult)) } satisfies ScratchpadClient;

export const savedConnection = {
  baseUrl: "https://speech.example.test", suppliedUrlForm: "root" as const, configured: true,
  defaultModelId: "model-b", defaultVoiceId: "voice-b2", timeoutSeconds: 120, retryCount: 2,
  responseFormat: "wav" as const, lastTestedAt: null, lastSuccessfulTestAt: null, lastTestSummary: null,
  createdAt: timestamp, updatedAt: timestamp
};

export function connectionWithTest(overall: ConnectionTestOverall, configured = true): SpeachesConnection {
  const stages = ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"] as const;
  return {
    ...savedConnection,
    baseUrl: configured ? savedConnection.baseUrl : null,
    suppliedUrlForm: configured ? "root" : "unconfigured",
    configured,
    defaultModelId: configured ? savedConnection.defaultModelId : null,
    defaultVoiceId: configured ? savedConnection.defaultVoiceId : null,
    lastTestedAt: timestamp,
    lastSuccessfulTestAt: overall === "connected" ? timestamp : null,
    lastTestSummary: {
      schemaVersion: 1,
      overall,
      testedAt: timestamp,
      httpStatus: overall === "connected" ? 200 : null,
      stages: stages.map((stage) => ({ stage, status: overall === "connected" ? "pass" as const : "fail" as const, code: `TEST_${stage.toUpperCase()}`, message: `${stage} result`, durationMs: 1 })),
      availableModelIds: configured ? [savedConnection.defaultModelId] : [],
      availableVoiceIds: configured ? [savedConnection.defaultVoiceId] : null
    }
  };
}

export function connectionClient(overrides: Partial<SpeachesConnectionClient> = {}): SpeachesConnectionClient {
  return {
    get: vi.fn(() => Promise.resolve(savedConnection)),
    update: vi.fn<SpeachesConnectionClient["update"]>((input) => Promise.resolve({
      ...savedConnection,
      ...input,
      timeoutSeconds: input.timeoutSeconds ?? savedConnection.timeoutSeconds,
      retryCount: input.retryCount ?? savedConnection.retryCount,
      responseFormat: input.responseFormat ?? savedConnection.responseFormat
    })),
    test: vi.fn(), exportDiagnostics: vi.fn(),
    discoverSpeechCatalog: vi.fn(() => Promise.resolve({ schemaVersion: 1 as const, models: [
      { modelId: "model-b", voices: [
        { voiceId: "voice-b2", name: "Second", language: null, gender: null },
        { voiceId: "voice-b1", name: "First", language: null, gender: null }
      ] },
      { modelId: "model-a", voices: [{ voiceId: "voice-a1", name: null, language: null, gender: null }] }
    ] })),
    getSetupState: vi.fn(() => Promise.resolve({ onboardingCompletedAt: timestamp, client: "web" as const })),
    completeOnboarding: vi.fn(),
    ...overrides
  };
}

export const voiceCatalog: VoiceCatalogClient = { get: vi.fn((modelId: string) => Promise.resolve({ schemaVersion: 1 as const, modelId, entries: [] })), replace: vi.fn() };
