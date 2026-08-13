import { describe, expect, it, vi } from "vitest";
import {
  ConnectionProfileSchema,
  type ConnectionProfile,
  type ConnectionProfileAuthoring,
  type ConnectionTestSummary,
  type VoiceCatalogAuthoring
} from "@studynarrator/shared-types";
import {
  ConnectionPolicyError,
  classifyEndpoint,
  createConnectionsService,
  createRoutedCredentialStore,
  createVoiceCatalogService,
  reconcileEnvironmentConnectionProfile,
  type ConnectionRepository,
  type CredentialStore
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
  profiles = new Map<string, ConnectionProfile>();
  references = new Map<string, string>();
  setup = { activeProfileId: null as string | null, onboardingCompletedAt: null as string | null };
  failDelete = false;

  private materialize(profile: ConnectionProfile): ConnectionProfile {
    return ConnectionProfileSchema.parse({ ...profile, apiKeyConfigured: this.references.has(profile.id) });
  }

  listConnectionProfiles() { return [...this.profiles.values()].map((profile) => this.materialize(profile)); }
  getConnectionProfile(profileId: string) {
    const profile = this.profiles.get(profileId);
    if (!profile) throw Object.assign(new Error("missing"), { code: "PERSISTENCE_NOT_FOUND" });
    return this.materialize(profile);
  }
  createConnectionProfile(input: ConnectionProfileAuthoring) {
    const id = input.id ?? `profile-${this.profiles.size + 1}`;
    const profile = this.makeProfile(id, input, "saved");
    this.profiles.set(id, profile);
    return profile;
  }
  replaceConnectionProfile(profileId: string, input: ConnectionProfileAuthoring) {
    const previous = this.getConnectionProfile(profileId);
    const next = this.makeProfile(profileId, input, previous.source, previous);
    this.profiles.set(profileId, next);
    return next;
  }
  deleteConnectionProfile(profileId: string) {
    if (this.failDelete) { this.failDelete = false; throw new Error("database delete failed"); }
    this.profiles.delete(profileId);
    this.references.delete(profileId);
    if (this.setup.activeProfileId === profileId) this.setup.activeProfileId = null;
  }
  getConnectionCredentialReference(profileId: string) { this.getConnectionProfile(profileId); return this.references.get(profileId) ?? null; }
  setConnectionCredentialReference(profileId: string, reference: string | null) {
    this.getConnectionProfile(profileId);
    if (reference) this.references.set(profileId, reference); else this.references.delete(profileId);
    return this.getConnectionProfile(profileId);
  }
  setConnectionSuppliedUrlForm(profileId: string, suppliedUrlForm: "root" | "v1" | "unconfigured") {
    const profile = this.getConnectionProfile(profileId);
    this.profiles.set(profileId, ConnectionProfileSchema.parse({ ...profile, suppliedUrlForm }));
    return this.getConnectionProfile(profileId);
  }
  upsertEnvironmentConnectionProfile(input: ConnectionProfileAuthoring, reference: string | null) {
    const id = input.id ?? "environment-speaches";
    const profile = this.makeProfile(id, input, "environment", this.profiles.get(id));
    this.profiles.set(id, profile);
    if (reference) this.references.set(id, reference); else this.references.delete(id);
    return this.getConnectionProfile(id);
  }
  recordConnectionTest(profileId: string, summary: ConnectionTestSummary) {
    const profile = this.getConnectionProfile(profileId);
    this.profiles.set(profileId, ConnectionProfileSchema.parse({
      ...profile,
      lastTestedAt: summary.testedAt,
      lastSuccessfulTestAt: summary.overall === "connected" ? summary.testedAt : profile.lastSuccessfulTestAt,
      lastTestSummary: summary
    }));
    return this.getConnectionProfile(profileId);
  }
  getConnectionSetup() { return { ...this.setup }; }
  setActiveConnectionProfile(profileId: string | null) { this.setup.activeProfileId = profileId; return this.getConnectionSetup(); }
  completeConnectionOnboarding() { this.setup.onboardingCompletedAt = timestamp; return this.getConnectionSetup(); }
  getVoiceCatalogOverrides(modelId: string) { return { schemaVersion: 1 as const, modelId, entries: [] }; }
  replaceVoiceCatalogOverrides(input: VoiceCatalogAuthoring) { return { schemaVersion: 1 as const, modelId: input.modelId, entries: [] }; }

  private makeProfile(id: string, input: ConnectionProfileAuthoring, source: "saved" | "environment", previous?: ConnectionProfile): ConnectionProfile {
    return ConnectionProfileSchema.parse({
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      suppliedUrlForm: previous?.suppliedUrlForm ?? (input.baseUrl ? "root" : "unconfigured"),
      source,
      editable: source === "saved",
      credentialEntryAllowed: false,
      configured: input.baseUrl !== null && input.defaultModelId !== null && input.defaultVoiceId !== null,
      apiKeyConfigured: this.references.has(id),
      defaultModelId: input.defaultModelId,
      defaultVoiceId: input.defaultVoiceId,
      timeoutSeconds: input.timeoutSeconds ?? 120,
      retryCount: input.retryCount ?? 2,
      responseFormat: "wav",
      lastTestedAt: previous?.lastTestedAt ?? null,
      lastSuccessfulTestAt: previous?.lastSuccessfulTestAt ?? null,
      lastTestSummary: previous?.lastTestSummary ?? null,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }
}

class MemoryVault implements CredentialStore {
  readonly replacementAllowed = true;
  entries = new Map<string, string>();
  failNextWrite = false;
  failNextDelete = false;
  async read(reference: string) { return this.entries.get(reference) ?? null; }
  async write(profileId: string, apiKey: string) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error("vault write failed"); }
    const reference = `safe-storage:${profileId}`;
    this.entries.set(reference, apiKey);
    return reference;
  }
  async delete(reference: string) {
    if (this.failNextDelete) { this.failNextDelete = false; throw new Error("vault delete failed"); }
    this.entries.delete(reference);
  }
}

function mutation(name = "Local") {
  return {
    profile: { id: "local", name, baseUrl: "http://127.0.0.1:8000/v1", defaultModelId: "model", defaultVoiceId: "voice" },
    credential: { action: "replace" as const, apiKey: "test-secret-must-not-appear" }
  };
}

function desktopService(repository: MemoryRepository, vault: MemoryVault) {
  return createConnectionsService({
    repository,
    credentials: createRoutedCredentialStore({ environmentApiKey: null, vault }),
    context: { client: "electron", nodeVersion: "26.0.0", electronVersion: "43.3.0", activeProfileLocked: false },
    diagnose: vi.fn(async () => ({ normalizedUrl: null, summary: connected }))
  });
}

describe("connections service", () => {
  it("executes every connection, setup, and voice-catalog service method", async () => {
    const repository = new MemoryRepository();
    const vault = new MemoryVault();
    const service = desktopService(repository, vault);
    expect(Object.keys(service).map((key) => `connections.${key}`).sort()).toEqual(
      APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("connections.")).sort()
    );
    await service.create(mutation());
    await expect(service.list()).resolves.toHaveLength(1);
    await service.replace("local", { ...mutation("Updated"), credential: { action: "keep" } });
    await service.test("local");
    await service.exportDiagnostics("local");
    await expect(service.getSetupState()).resolves.toMatchObject({ client: "electron" });
    await service.setActiveProfile("local");
    await expect(service.completeOnboarding()).resolves.toMatchObject({ activeProfileId: "local", onboardingCompletedAt: timestamp });

    const catalog = createVoiceCatalogService({
      repository,
      bundledCatalogs: new Map([["model", { schemaVersion: 1, modelId: "model", entries: [{ voiceId: "voice", label: "Bundled", enabled: true, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }] }]])
    });
    expect(Object.keys(catalog).map((key) => `voiceCatalog.${key}`).sort()).toEqual(
      APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("voiceCatalog.")).sort()
    );
    await expect(catalog.get("model")).resolves.toMatchObject({ entries: [expect.objectContaining({ voiceId: "voice" })] });
    await expect(catalog.replace({ schemaVersion: 1, modelId: "model", entries: [{ voiceId: "voice", label: "Renamed", enabled: false, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }] })).resolves.toMatchObject({ entries: [expect.objectContaining({ label: "Bundled" })] });
    await service.delete("local");
    await expect(service.list()).resolves.toEqual([]);
  });

  it("normalizes profiles, stores only an opaque reference, and never returns the key", async () => {
    const repository = new MemoryRepository();
    const vault = new MemoryVault();
    const service = desktopService(repository, vault);
    const created = await service.create(mutation());
    expect(created.baseUrl).toBe("http://127.0.0.1:8000");
    expect(created).toMatchObject({ apiKeyConfigured: true, credentialEntryAllowed: true });
    expect(repository.references.get("local")).toBe("safe-storage:local");
    expect(JSON.stringify(created)).not.toContain("test-secret-must-not-appear");
  });

  it("rejects Web credential replacement before persisting anything", async () => {
    const repository = new MemoryRepository();
    const service = createConnectionsService({
      repository,
      credentials: createRoutedCredentialStore({ environmentApiKey: null }),
      context: { client: "web", nodeVersion: "26.0.0", electronVersion: null, activeProfileLocked: false }
    });
    await expect(service.create(mutation())).rejects.toBeInstanceOf(ConnectionPolicyError);
    expect(repository.profiles.size).toBe(0);
  });

  it("compensates failed vault writes and failed database deletes", async () => {
    const repository = new MemoryRepository();
    const vault = new MemoryVault();
    const service = desktopService(repository, vault);
    vault.failNextWrite = true;
    await expect(service.create(mutation())).rejects.toThrow("vault write failed");
    expect(repository.profiles.size).toBe(0);

    await service.create(mutation());
    repository.failDelete = true;
    await expect(service.delete("local")).rejects.toThrow("database delete failed");
    expect(repository.profiles.has("local")).toBe(true);
    expect(vault.entries.get("safe-storage:local")).toBe("test-secret-must-not-appear");
  });

  it("records diagnostics without touching project state and emits a redacted export", async () => {
    const repository = new MemoryRepository();
    const vault = new MemoryVault();
    const service = desktopService(repository, vault);
    await service.create(mutation());
    const profileCount = repository.profiles.size;
    await expect(service.test("local")).resolves.toEqual(connected);
    expect(repository.profiles.size).toBe(profileCount);
    const exported = await service.exportDiagnostics("local");
    expect(exported).toMatchObject({ endpointClass: "loopback", apiKeyConfigured: true, requestCounts: { health: 1, models: 1, voices: 1, speech: 1 } });
    expect(JSON.stringify(exported)).not.toContain("127.0.0.1");
    expect(JSON.stringify(exported)).not.toContain("test-secret-must-not-appear");
  });

  it("reconciles and locks the stable environment profile without storing its key", () => {
    const repository = new MemoryRepository();
    const result = reconcileEnvironmentConnectionProfile(repository, {
      SPEACHES_BASE_URL: "https://speech.example.test/v1",
      SPEACHES_API_KEY: "test-secret-must-not-appear",
      STUDYNARRATOR_LOCK_SPEACHES_SETTINGS: "true"
    });
    expect(result).toEqual({ activeProfileLocked: true, apiKey: "test-secret-must-not-appear" });
    expect(repository.getConnectionProfile("environment-speaches")).toMatchObject({ baseUrl: "https://speech.example.test", source: "environment", editable: false });
    expect(repository.getConnectionCredentialReference("environment-speaches")).toBe("environment:SPEACHES_API_KEY");
    expect(repository.setup.activeProfileId).toBe("environment-speaches");
  });

  it("retains an unconfigured environment profile when variables disappear", () => {
    const repository = new MemoryRepository();
    reconcileEnvironmentConnectionProfile(repository, { SPEACHES_BASE_URL: "http://127.0.0.1:8000" });
    reconcileEnvironmentConnectionProfile(repository, {});
    expect(repository.getConnectionProfile("environment-speaches")).toMatchObject({ baseUrl: null, configured: false, apiKeyConfigured: false });
  });

  it("rejects active-profile changes when environment locking is enabled", async () => {
    const repository = new MemoryRepository();
    reconcileEnvironmentConnectionProfile(repository, { STUDYNARRATOR_LOCK_SPEACHES_SETTINGS: "true" });
    const service = createConnectionsService({
      repository,
      credentials: createRoutedCredentialStore({ environmentApiKey: null }),
      context: { client: "web", nodeVersion: "26.0.0", electronVersion: null, activeProfileLocked: true }
    });
    await expect(service.setActiveProfile(null)).rejects.toBeInstanceOf(ConnectionPolicyError);
    expect((await service.getSetupState()).activeProfileId).toBe("environment-speaches");
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
