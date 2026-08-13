import { vi } from "vitest";
import type { CachedSpeechResult } from "@studynarrator/rendering";
import { createProjectPreviewService, type ProjectPreviewRepository } from "./projectPreview.js";
import { createSpeechCacheService } from "./cachedSpeech.js";
import { APPLICATION_SERVICE_MANIFEST } from "./serviceManifest.js";

const timestamp = "2026-08-13T12:00:00.000Z";
const projectId = "00000000-0000-4000-8000-000000000001";
const profile = {
  id: "local", name: "Local Speaches", baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root" as const,
  source: "saved" as const, editable: true, credentialEntryAllowed: false, configured: true, apiKeyConfigured: false,
  defaultModelId: "model", defaultVoiceId: "voice-default", timeoutSeconds: 12, retryCount: 0, responseFormat: "wav" as const,
  lastTestedAt: null, lastSuccessfulTestAt: null, lastTestSummary: null, createdAt: timestamp, updatedAt: timestamp
};
const project = {
  contractVersion: 3 as const,
  id: projectId,
  name: "Preview project",
  description: "",
  scriptSource: "[speaker_teacher] SQL indexes.\n\n[pause_short]\n\nSecond line.",
  scriptHash: "a".repeat(64),
  connectionProfileId: profile.id,
  modelId: "model",
  speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: "voice-teacher", speed: 1.2, gainDb: 3, roleDescription: "", sampleText: "" }],
  pausePresets: [{ pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }, { pauseId: "pause_short", durationMs: 300, description: "Short" }],
  paragraphPause: { enabled: true, pauseId: "pause_medium" as const, durationMs: 750 },
  lexiconEntries: [{
    id: "project-sql", scope: "project" as const, entryType: "exactTerm" as const, displayText: "SQL", spokenText: "sequel",
    caseSensitive: true, wholeWord: true, priority: 10, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp
  }],
  createdAt: timestamp,
  updatedAt: timestamp
};

function repository(): ProjectPreviewRepository {
  return {
    getProject: vi.fn(() => project),
    listGlobalLexicon: vi.fn(() => []),
    getConnectionProfile: vi.fn(() => profile),
    getConnectionCredentialReference: vi.fn(() => null),
    getVoiceCatalogOverrides: vi.fn(() => ({
      schemaVersion: 1, modelId: "model", entries: [{
        voiceId: "voice-teacher", label: "Teacher Voice", enabled: true, language: null, locale: null,
        accent: null, category: null, style: null, sampleText: null
      }]
    }))
  } as unknown as ProjectPreviewRepository;
}

function cached(bytes = Uint8Array.from([1, 2, 3])): CachedSpeechResult {
  return {
    key: "a".repeat(64), status: "miss", bytes,
    metadata: {
      schemaVersion: 1, normalizationVersion: 1, chunkingVersion: 1, adapterId: "adapter", adapterVersion: 1,
      serverIdentityHash: "b".repeat(64), profileId: profile.id, modelId: "model", voiceId: "voice-teacher", speed: 1.2,
      textHash: "c".repeat(64), responseFormat: "wav", key: "a".repeat(64), audioChecksum: "d".repeat(64),
      byteLength: bytes.byteLength, createdAt: timestamp, lastUsedAt: timestamp, projectIds: [projectId], scratchpadUsed: false
    }
  };
}

describe("project preview service", () => {
  it("matches the project preview and speech cache application-service manifests", () => {
    const preview = createProjectPreviewService({ repository: repository(), speech: { synthesize: vi.fn() } });
    const cache = createSpeechCacheService({
      status: vi.fn(async () => ({
        entryCount: 0, totalBytes: 0, lastUsedAt: null, sessionHits: 0, sessionMisses: 0,
        sessionWrites: 0, sessionCorruptMisses: 0, inFlight: 0
      })),
      clearAll: vi.fn(async () => ({ entriesRemoved: 0, bytesFreed: 0 })),
      clearProject: vi.fn(async () => ({ entriesRemoved: 0, bytesFreed: 0 })),
      clearEntry: vi.fn(async () => ({ entriesRemoved: 0, bytesFreed: 0 }))
    } as never);
    expect(Object.keys(preview).map((key) => `projectPreview.${key}`)).toEqual(
      APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("projectPreview."))
    );
    expect(Object.keys(cache).map((key) => `speechCache.${key}`)).toEqual(
      APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("speechCache."))
    );
  });

  it("recomputes and synthesizes the selected speech segment with cache metadata", async () => {
    const store = repository();
    const speech = { synthesize: vi.fn(async () => cached()) };
    const service = createProjectPreviewService({
      repository: store,
      speech,
      createId: () => "00000000-0000-4000-8000-000000000002",
      now: () => new Date(timestamp)
    });
    const result = await service.preview(projectId, { mode: "segment", nodeOrdinal: 1 });
    expect(speech.synthesize).toHaveBeenCalledWith(expect.objectContaining({
      connectionProfileId: profile.id, modelId: "model", voiceId: "voice-teacher", speed: 1.2,
      text: "sequel indexes.", usage: { projectId }
    }));
    expect(result).toMatchObject({
      projectId, mode: "segment", nodeOrdinal: 1, speakerId: "teacher", voiceLabel: "Teacher Voice",
      originalText: "SQL indexes.", transformedText: "sequel indexes.", cache: { status: "miss" },
      audio: { base64: "AQID", byteLength: 3 }
    });
    expect(store.getProject).toHaveBeenCalledTimes(1);
  });

  it("uses the profile default for a System narrator pronunciation sample", async () => {
    const speech = { synthesize: vi.fn(async () => ({
      ...cached(), metadata: { ...cached().metadata, voiceId: "voice-default", speed: 1 }
    })) };
    const service = createProjectPreviewService({ repository: repository(), speech });
    const result = await service.preview(projectId, { mode: "pronunciation", text: "SQL sample." });
    expect(speech.synthesize).toHaveBeenCalledWith(expect.objectContaining({ voiceId: "voice-default", speed: 1, text: "sequel sample." }));
    expect(result).toMatchObject({ mode: "pronunciation", nodeOrdinal: null, sourceRange: null, speakerId: "narrator", voiceId: "voice-default" });
  });

  it("uses a configured narrator voice at one-times speed", async () => {
    const store = repository();
    vi.mocked(store.getProject).mockReturnValue({
      ...project,
      speakerMappings: [{ speakerId: "narrator", displayName: "System narrator", voiceId: "voice-narrator", speed: 1.8, gainDb: 0, roleDescription: "", sampleText: "" }]
    });
    const speech = { synthesize: vi.fn(async () => ({
      ...cached(), metadata: { ...cached().metadata, voiceId: "voice-narrator", speed: 1 }
    })) };
    const service = createProjectPreviewService({ repository: store, speech });
    await service.preview(projectId, { mode: "pronunciation", text: "System sample.", speakerId: "narrator" });
    expect(speech.synthesize).toHaveBeenCalledWith(expect.objectContaining({ voiceId: "voice-narrator", speed: 1 }));
  });

  it("rejects pause rows and control-bearing pronunciation samples without synthesis", async () => {
    const speech = { synthesize: vi.fn() };
    const service = createProjectPreviewService({ repository: repository(), speech });
    await expect(service.preview(projectId, { mode: "segment", nodeOrdinal: 3 })).rejects.toMatchObject({ code: "PROJECT_PREVIEW_INVALID_SEGMENT" });
    await expect(service.preview(projectId, { mode: "pronunciation", text: "[pause_short]" })).rejects.toMatchObject({ code: "PROJECT_PREVIEW_INVALID_SEGMENT" });
    expect(speech.synthesize).not.toHaveBeenCalled();
  });
});
