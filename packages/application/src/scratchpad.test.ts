import { describe, expect, it, vi } from "vitest";
import { SpeachesSynthesisError } from "@studynarrator/speaches-adapter";
import { createScratchpadService, type ScratchpadRepository } from "./scratchpad.js";
import { APPLICATION_SERVICE_MANIFEST } from "./serviceManifest.js";

const timestamp = "2026-08-12T12:00:00.000Z";
const profile = {
  id: "local",
  name: "Local Speaches",
  baseUrl: "http://127.0.0.1:8000",
  suppliedUrlForm: "root" as const,
  source: "saved" as const,
  editable: true,
  credentialEntryAllowed: false,
  configured: true,
  apiKeyConfigured: true,
  defaultModelId: "model",
  defaultVoiceId: "voice",
  timeoutSeconds: 12,
  retryCount: 2,
  responseFormat: "wav" as const,
  lastTestedAt: null,
  lastSuccessfulTestAt: null,
  lastTestSummary: null,
  createdAt: timestamp,
  updatedAt: timestamp
};

function repository(): ScratchpadRepository {
  return {
    getConnectionProfile: vi.fn(() => profile),
    getConnectionCredentialReference: vi.fn(() => "safe-storage:local"),
    listGlobalLexicon: vi.fn(() => [{
      id: "sql", scope: "global" as const, entryType: "exactTerm" as const, displayText: "SQL", spokenText: "sequel",
      caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp
    }]),
    listConnectionProfiles: vi.fn(), createConnectionProfile: vi.fn(), replaceConnectionProfile: vi.fn(), deleteConnectionProfile: vi.fn(),
    setConnectionCredentialReference: vi.fn(), setConnectionSuppliedUrlForm: vi.fn(), upsertEnvironmentConnectionProfile: vi.fn(),
    recordConnectionTest: vi.fn(), getConnectionSetup: vi.fn(), setActiveConnectionProfile: vi.fn(), completeConnectionOnboarding: vi.fn(),
    getVoiceCatalogOverrides: vi.fn(), replaceVoiceCatalogOverrides: vi.fn()
  } as unknown as ScratchpadRepository;
}

describe("scratchpad service", () => {
  it("matches the public application-service manifest", () => {
    const service = createScratchpadService({
      repository: repository(),
      credentials: { replacementAllowed: false, read: vi.fn(async () => null), write: vi.fn(), delete: vi.fn() }
    });
    expect(Object.keys(service).map((key) => `scratchpad.${key}`)).toEqual(
      APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("scratchpad."))
    );
  });

  it("reads privileged configuration, transforms text, and creates a portable validated result", async () => {
    const store = repository();
    const synthesize = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" as const, attempts: 1 }));
    const service = createScratchpadService({
      repository: store,
      credentials: { replacementAllowed: false, read: vi.fn(async () => "test-secret-must-not-appear"), write: vi.fn(), delete: vi.fn() },
      synthesize,
      createId: () => "00000000-0000-4000-8000-000000000001",
      now: () => new Date(timestamp)
    });
    const result = await service.preview({ connectionProfileId: "local", modelId: "model", voiceId: "voice", speed: 1.1, text: "SQL indexes.", applyGlobalLexicon: true });
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: profile.baseUrl,
      modelId: "model",
      voiceId: "voice",
      speed: 1.1,
      text: "sequel indexes.",
      apiKey: "test-secret-must-not-appear",
      timeoutSeconds: 12,
      retryCount: 2
    }));
    expect(result).toMatchObject({ originalText: "SQL indexes.", transformedText: "sequel indexes.", audio: { base64: "AQID", byteLength: 3 } });
    expect(JSON.stringify(result)).not.toContain("test-secret-must-not-appear");
    expect((store.recordConnectionTest as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect((store.replaceConnectionProfile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("maps adapter failures to stable sanitized application errors and creates no result", async () => {
    const service = createScratchpadService({
      repository: repository(),
      credentials: { replacementAllowed: false, read: vi.fn(async () => null), write: vi.fn(), delete: vi.fn() },
      synthesize: vi.fn(async () => { throw new SpeachesSynthesisError("selectionRejected", "upstream-private-body", false, 422); }),
      createId: vi.fn(() => "00000000-0000-4000-8000-000000000001")
    });
    try {
      await service.preview({ connectionProfileId: "local", modelId: "bad", voiceId: "bad", speed: 1, text: "Keep me.", applyGlobalLexicon: false });
      throw new Error("Expected synthesis to fail.");
    } catch (error) {
      expect(error).toMatchObject({ code: "SCRATCHPAD_SELECTION_REJECTED" });
      expect(error instanceof Error ? error.message : "").not.toContain("upstream-private-body");
    }
  });

  it("passes cancellation through and never calls synthesis for invalid control text", async () => {
    const synthesize = vi.fn();
    const service = createScratchpadService({
      repository: repository(),
      credentials: { replacementAllowed: false, read: vi.fn(async () => null), write: vi.fn(), delete: vi.fn() },
      synthesize
    });
    await expect(service.preview({ connectionProfileId: "local", modelId: "model", voiceId: "voice", speed: 1, text: "[pause_short]", applyGlobalLexicon: false }))
      .rejects.toMatchObject({ code: "SCRATCHPAD_CONFIGURATION" });
    expect(synthesize).not.toHaveBeenCalled();
  });
});
