import { describe, expect, it, vi } from "vitest";
import {
  SpeachesConnectionSchema,
  type ConnectionTestSummary,
  type SpeachesConnectionAuthoring,
  type SpeechCatalog,
  type VoiceCatalog,
  type VoiceCatalogAuthoring
} from "@studynarrator/shared-types";
import {
  ConnectionCatalogError,
  classifyEndpoint,
  createConnectionService,
  createVoiceCatalogService,
  type ConnectionCatalogRunner,
  type ConnectionRepository
} from "./connections.js";
import { APPLICATION_SERVICE_MANIFEST } from "./serviceManifest.js";

const timestamp = "2026-08-12T12:00:00.000Z";
const connected: ConnectionTestSummary = {
  schemaVersion: 1,
  overall: "connected",
  testedAt: timestamp,
  httpStatus: 200,
  stages: ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"].map((stage) => ({
    stage: stage as ConnectionTestSummary["stages"][number]["stage"],
    status: "pass" as const,
    code: `${stage}-pass`,
    message: "Passed.",
    durationMs: 1
  })),
  availableModelIds: ["model"],
  availableVoiceIds: ["voice"]
};

class MemoryRepository implements ConnectionRepository {
  setup = { onboardingCompletedAt: null as string | null };
  connection = SpeachesConnectionSchema.parse({
      baseUrl: null,
      suppliedUrlForm: "unconfigured",
      configured: false,
      defaultModelId: null,
      defaultVoiceId: null,
      timeoutSeconds: 120,
      retryCount: 2,
      responseFormat: "wav",
      lastTestedAt: null,
      lastSuccessfulTestAt: null,
      lastTestSummary: null,
      createdAt: timestamp,
      updatedAt: timestamp
  });
  overrides = new Map<string, VoiceCatalog>();

  getSpeachesConnection() { return this.connection; }
  replaceSpeachesConnection(input: SpeachesConnectionAuthoring, suppliedUrlForm: "root" | "v1" | "unconfigured") {
    this.connection = {
      ...this.connection,
      ...input,
      suppliedUrlForm,
      configured: input.baseUrl !== null && input.defaultModelId !== null && input.defaultVoiceId !== null,
      timeoutSeconds: input.timeoutSeconds ?? 120,
      retryCount: input.retryCount ?? 2,
      responseFormat: "wav",
      updatedAt: timestamp
    };
    return this.connection;
  }
  recordConnectionTest(summary: ConnectionTestSummary) {
    this.connection = {
      ...this.connection,
      lastTestedAt: summary.testedAt,
      lastSuccessfulTestAt: summary.overall === "connected" ? summary.testedAt : this.connection.lastSuccessfulTestAt,
      lastTestSummary: summary
    };
    return this.connection;
  }
  getConnectionSetup() { return { ...this.setup }; }
  completeConnectionOnboarding() { this.setup.onboardingCompletedAt = timestamp; return this.getConnectionSetup(); }
  getVoiceCatalogOverrides(modelId: string): VoiceCatalog {
    return this.overrides.get(modelId) ?? { schemaVersion: 1 as const, modelId, entries: [] };
  }
  replaceVoiceCatalogOverrides(input: VoiceCatalogAuthoring): VoiceCatalog {
    const catalog: VoiceCatalog = { schemaVersion: 1, modelId: input.modelId, entries: input.entries.map((entry) => ({
      voiceId: entry.voiceId,
      label: entry.label,
      enabled: entry.enabled ?? true,
      favorite: entry.favorite ?? false,
      language: entry.language ?? null,
      locale: entry.locale ?? null,
      accent: entry.accent ?? null,
      category: entry.category ?? null,
      style: entry.style ?? null,
      sampleText: entry.sampleText ?? null
    })) };
    this.overrides.set(input.modelId, catalog);
    return catalog;
  }
}

function service(repository: MemoryRepository, discoverCatalog: (input: Parameters<ConnectionCatalogRunner>[0]) => Promise<SpeechCatalog> = vi.fn(async () => ({
  schemaVersion: 1 as const,
  models: [{ modelId: "model", voices: [{ voiceId: "voice", name: "Voice", language: null, gender: null }] }]
}))) {
  return createConnectionService({
    repository,
    context: { client: "electron", nodeVersion: "26.0.0", electronVersion: "43.3.0" },
    diagnose: vi.fn(async () => ({ normalizedUrl: null, summary: connected })),
    discoverCatalog
  });
}

describe("connection service", () => {
  it("executes every singular connection and voice-catalog service method", async () => {
    const repository = new MemoryRepository();
    const connection = service(repository);
    expect(Object.keys(connection).map((key) => `connection.${key}`).sort()).toEqual(
      APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("connection.")).sort()
    );
    await connection.update({ baseUrl: "http://127.0.0.1:8000/v1", defaultModelId: "model", defaultVoiceId: "voice" });
    await expect(connection.get()).resolves.toMatchObject({ baseUrl: "http://127.0.0.1:8000", configured: true });
    await expect(connection.discoverSpeechCatalog({ baseUrl: "http://127.0.0.1:8000/v1" })).resolves.toMatchObject({ models: [{ modelId: "model" }] });
    await expect(connection.test()).resolves.toEqual(connected);
    await expect(connection.exportDiagnostics()).resolves.toMatchObject({ endpointClass: "loopback" });
    await expect(connection.completeOnboarding()).resolves.toMatchObject({ onboardingCompletedAt: timestamp, client: "electron" });

    const catalog = createVoiceCatalogService({ repository, bundledCatalogs: new Map() });
    await catalog.replace({ schemaVersion: 1, modelId: "model", entries: [{ voiceId: "voice", label: "Voice", enabled: false, favorite: true, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }] });
    await expect(catalog.get("model")).resolves.toMatchObject({ entries: [{ voiceId: "voice", enabled: false, favorite: true }] });
  });

  it("discovers a draft without persisting it and preserves response order", async () => {
    const repository = new MemoryRepository();
    const discover = vi.fn(async () => ({
      schemaVersion: 1 as const,
      models: [
        { modelId: "second-by-name", voices: [{ voiceId: "z-voice", name: null, language: null, gender: null }] },
        { modelId: "first-by-name", voices: [{ voiceId: "a-voice", name: null, language: null, gender: null }] }
      ]
    }));
    const connection = service(repository, discover);
    const before = JSON.stringify(repository.connection);
    const result = await connection.discoverSpeechCatalog({ baseUrl: "http://127.0.0.1:8000/v1", timeoutSeconds: 15, retryCount: 1 });
    expect(result.models.map(({ modelId }) => modelId)).toEqual(["second-by-name", "first-by-name"]);
    expect(result.models[0]?.voices[0]?.voiceId).toBe("z-voice");
    expect(JSON.stringify(repository.connection)).toBe(before);
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://127.0.0.1:8000" }));
  });

  it("reports empty catalogs and allows explicit offline onboarding", async () => {
    const repository = new MemoryRepository();
    const connection = service(repository, vi.fn(async () => ({ schemaVersion: 1 as const, models: [] })));
    await expect(connection.discoverSpeechCatalog({ baseUrl: "http://127.0.0.1:8000" })).rejects.toMatchObject({ code: "CONNECTION_CATALOG_EMPTY" });
    await expect(connection.completeOnboarding()).resolves.toMatchObject({ onboardingCompletedAt: timestamp });
    expect(ConnectionCatalogError).toBeDefined();
  });

  it("normalizes URLs and emits redacted diagnostics", async () => {
    const repository = new MemoryRepository();
    const connection = service(repository);
    const updated = await connection.update({ baseUrl: "http://127.0.0.1:8000/v1", defaultModelId: "model", defaultVoiceId: "voice" });
    expect(updated.baseUrl).toBe("http://127.0.0.1:8000");
    await connection.test();
    const exported = await connection.exportDiagnostics();
    expect(JSON.stringify(exported)).not.toContain("127.0.0.1");
  });
});

describe("endpoint redaction", () => {
  it.each([
    ["http://127.0.0.1:8000", "loopback"],
    ["http://localhost:8000", "loopback"],
    ["http://192.168.1.20:8000", "private"],
    ["http://speaches.home.arpa:8000", "private"],
    ["https://speech.example.test", "public"],
    [null, "unconfigured"]
  ] as const)("classifies %s without returning a hostname", (url, classification) => {
    expect(classifyEndpoint(url)).toBe(classification);
  });
});
