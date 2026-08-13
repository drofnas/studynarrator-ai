import { describe, expect, it, vi } from "vitest";
import {
  CONNECTION_CHANNELS,
  PERSISTENCE_CHANNELS,
  PROJECT_PREVIEW_CHANNELS,
  RENDER_PLAN_CHANNELS,
  RENDER_CHANNELS,
  SCRATCHPAD_CHANNELS,
  SPEECH_CACHE_CHANNELS,
  SYSTEM_DIAGNOSTICS_CHANNEL
} from "@studynarrator/shared-types";
import { createPreloadBridge } from "./bridge.js";
import {
  PUBLIC_IPC_CHANNEL_MANIFEST,
  registerConnectionHandlers,
  registerDiagnosticsHandler,
  registerPersistenceHandlers,
  registerProjectPreviewHandlers,
  registerRenderPlanHandlers,
  registerRenderHandlers,
  registerScratchpadHandlers,
  registerSpeechCacheHandlers
} from "./ipc.js";
import { isApprovedExternalUrl, SECURE_WEB_PREFERENCES } from "./security.js";

const diagnostics = {
  schemaVersion: 3,
  overall: "fail",
  client: "electron",
  transport: "ipc",
  runtime: {
    schemaVersion: 3,
    applicationVersion: "0.1.0",
    runtimeName: "electron",
    runtimeVersion: "24.0.0",
    electronVersion: "43.3.0",
    platform: "darwin",
    architecture: "arm64",
    dataDirectory: "/tmp/studynarrator"
  },
  checks: {
    sharedCore: { status: "pass", marker: "study-narrator-core" },
    storage: { status: "fail", code: "STORAGE_UNAVAILABLE", message: "Storage unavailable." },
    ffmpeg: { status: "fail", executable: "ffmpeg", code: "FFMPEG_NOT_FOUND", message: "FFmpeg not found." }
  }
} as const;

const persistenceStatus = {
  contractVersion: 4 as const,
  state: "ready" as const,
  databaseSchemaVersion: 6 as const,
  targetDatabaseSchemaVersion: 6 as const,
  databasePath: "/tmp/studynarrator.sqlite",
  latestBackupPath: null
};

const persistence = {
  status: vi.fn(async () => persistenceStatus),
  projects: { list: vi.fn(async () => []), create: vi.fn(), get: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), delete: vi.fn() },
  settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
  preferences: { getIgnoredDiagnostics: vi.fn(async () => []), replaceIgnoredDiagnostics: vi.fn() },
  globalLexicon: { list: vi.fn(async () => []), replace: vi.fn() }
};

const connections = {
  list: vi.fn(async () => []),
  create: vi.fn(),
  replace: vi.fn(),
  delete: vi.fn(),
  test: vi.fn(),
  discoverSpeechCatalog: vi.fn(),
  exportDiagnostics: vi.fn(),
  getSetupState: vi.fn(async () => ({ activeProfileId: null, activeProfileLocked: false, onboardingCompletedAt: null, client: "electron" as const })),
  setActiveProfile: vi.fn(),
  completeOnboarding: vi.fn()
};
const voiceCatalog = { get: vi.fn(), replace: vi.fn() };
const scratchpadResult = {
  schemaVersion: 2 as const,
  id: "00000000-0000-4000-8000-000000000099",
  createdAt: "2026-08-12T12:00:00.000Z",
  connectionProfileId: "profile",
  connectionProfileName: "IPC profile",
  modelId: "model",
  voiceId: "voice",
  voiceLabel: "Voice",
  speed: 1,
  originalText: "Speech.",
  readableText: "Speech.",
  transformedText: "Speech.",
  lexiconApplied: false,
  warnings: [],
  cache: {
    key: "a".repeat(64), status: "hit" as const, byteLength: 3,
    createdAt: "2026-08-12T12:00:00.000Z", lastUsedAt: "2026-08-12T12:00:00.000Z"
  },
  audio: { mimeType: "audio/wav" as const, base64: "AQID", byteLength: 3 }
};
const scratchpad = { preview: vi.fn(async () => scratchpadResult) };
const projectPreviewResult = {
  schemaVersion: 1 as const,
  id: "00000000-0000-4000-8000-000000000098",
  createdAt: "2026-08-12T12:00:00.000Z",
  projectId: "00000000-0000-4000-8000-000000000001",
  mode: "segment" as const,
  nodeOrdinal: 1,
  sourceRange: { start: { line: 1, column: 1 }, end: { line: 1, column: 8 } },
  connectionProfileId: "profile",
  connectionProfileName: "IPC profile",
  modelId: "model",
  speakerId: "narrator" as const,
  voiceId: "voice",
  voiceLabel: "Voice",
  speed: 1,
  originalText: "Speech.",
  readableText: "Speech.",
  transformedText: "Speech.",
  cache: scratchpadResult.cache,
  audio: scratchpadResult.audio
};
const projectPreview = { preview: vi.fn(async () => projectPreviewResult) };
const cacheStatus = {
  contractVersion: 1 as const, entryCount: 1, totalBytes: 3,
  lastUsedAt: "2026-08-12T12:00:00.000Z", sessionHits: 1, sessionMisses: 0,
  sessionWrites: 0, sessionCorruptMisses: 0, inFlight: 0
};
const cleanupResult = { contractVersion: 1 as const, entriesRemoved: 1, bytesFreed: 3 };
const speechCache = {
  status: vi.fn(async () => cacheStatus),
  clearAll: vi.fn(async () => cleanupResult),
  clearProject: vi.fn(async () => cleanupResult),
  clearEntry: vi.fn(async () => cleanupResult)
};
const renderPlan = {
  schemaVersion: 1 as const,
  id: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-08-12T12:00:00.000Z",
  snapshotHash: "b".repeat(64),
  planHash: "c".repeat(64),
  scriptHash: "a".repeat(64),
  entries: [],
  summary: { sectionCount: 0, speechCount: 0, pauseCount: 0, cacheHits: 0, cacheMisses: 0, silenceDurationMs: 0 }
};
const renderPlanSummary = {
  id: renderPlan.id,
  projectId: renderPlan.projectId,
  createdAt: renderPlan.createdAt,
  snapshotHash: renderPlan.snapshotHash,
  planHash: renderPlan.planHash,
  scriptHash: renderPlan.scriptHash,
  summary: renderPlan.summary
};
const renderPlans = {
  create: vi.fn(async () => renderPlan),
  list: vi.fn(async () => [renderPlanSummary]),
  get: vi.fn(async () => renderPlan)
};
const renderJob = {
  contractVersion: 1 as const,
  id: "00000000-0000-4000-8000-000000000003",
  projectId: renderPlan.projectId,
  planId: renderPlan.id,
  retryOfRenderId: null,
  state: "complete" as const,
  progress: {
    phase: "complete" as const, sectionTitle: null, sectionOrdinal: 0, sectionCount: 0,
    entryOrdinal: null, speechOrdinal: 0, speechCount: 0, chunkOrdinal: null,
    completedChunks: 0, totalChunks: 0, cacheHits: 0, cacheMisses: 0, ttsRequests: 0,
    speakerId: null, voiceId: null, excerpt: null, elapsedMs: 1
  },
  error: null,
  createdAt: renderPlan.createdAt,
  startedAt: renderPlan.createdAt,
  finishedAt: renderPlan.createdAt
};
const renderArtifact = {
  contractVersion: 1 as const, id: "00000000-0000-4000-8000-000000000004", renderId: renderJob.id,
  type: "mp3" as const, fileName: "audio.mp3", sizeBytes: 3, checksum: "a".repeat(64),
  durationMs: 1, createdAt: renderPlan.createdAt
};
const renders = {
  start: vi.fn(async () => renderJob), list: vi.fn(async () => [renderJob]), get: vi.fn(async () => renderJob),
  cancel: vi.fn(async () => renderJob), retry: vi.fn(async () => renderJob), listArtifacts: vi.fn(async () => []),
  exportArtifact: vi.fn(async () => ({ disposition: "download" as const, fileName: "audio.mp3" })),
  resolveArtifact: vi.fn(async () => ({ artifact: renderArtifact, path: "/tmp/audio.mp3" })), close: vi.fn()
};
const saveDialog = { showSaveDialog: vi.fn(async () => ({ canceled: true })) };

describe("Electron boundary", () => {
  it("exposes only the validated diagnostics and persistence operations", async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === SYSTEM_DIAGNOSTICS_CHANNEL) return diagnostics;
      if (channel === PERSISTENCE_CHANNELS.projectsList || channel === CONNECTION_CHANNELS.list) return [];
      return persistenceStatus;
    });
    const bridge = createPreloadBridge(invoke);
    expect(Object.keys(bridge)).toEqual(["system", "persistence", "connections", "voiceCatalog", "scratchpad", "projectPreview", "speechCache", "renderPlans", "renders"]);
    expect(Object.keys(bridge.system)).toEqual(["diagnostics"]);
    await expect(bridge.system.diagnostics()).resolves.toEqual(diagnostics);
    expect(invoke).toHaveBeenCalledWith(SYSTEM_DIAGNOSTICS_CHANNEL);
    await expect(bridge.persistence.projects.list()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith(PERSISTENCE_CHANNELS.projectsList);
    await expect(bridge.connections.list()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.list);
  });

  it("rejects malformed IPC output", async () => {
    const bridge = createPreloadBridge(async () => ({ ...diagnostics, secret: "leak" }));
    await expect(bridge.system.diagnostics()).rejects.toThrow();
  });

  it("registers the diagnostics and fixed persistence IPC channels without a generic primitive", async () => {
    const handlers = new Map<string, (event?: unknown, input?: unknown) => Promise<unknown>>();
    const ipcMain = {
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
      handle: vi.fn((channel: string, handler: (event?: unknown, input?: unknown) => Promise<unknown>) => handlers.set(channel, handler))
    };
    const service = {
      health: vi.fn(),
      runtime: vi.fn(),
      diagnostics: vi.fn(async () => diagnostics),
      close: vi.fn()
    };
    registerDiagnosticsHandler(ipcMain, service as never, {} as never);
    registerPersistenceHandlers(ipcMain, persistence as never);
    registerConnectionHandlers(ipcMain, connections, voiceCatalog as never);
    registerScratchpadHandlers(ipcMain, scratchpad);
    registerProjectPreviewHandlers(ipcMain, projectPreview);
    registerSpeechCacheHandlers(ipcMain, speechCache);
    registerRenderPlanHandlers(ipcMain, renderPlans);
    registerRenderHandlers(ipcMain, renders as never, saveDialog);
    expect([...handlers.keys()]).toEqual(PUBLIC_IPC_CHANNEL_MANIFEST);
    expect([...handlers.keys()]).not.toContain("persistence.execute");
    await expect(handlers.get(SYSTEM_DIAGNOSTICS_CHANNEL)?.()).resolves.toEqual(diagnostics);
    await expect(handlers.get(PERSISTENCE_CHANNELS.projectsList)?.()).resolves.toEqual([]);
    await expect(handlers.get(PERSISTENCE_CHANNELS.projectsCreate)?.(undefined, { name: "", secret: "must-not-leak" }))
      .rejects.toThrow("The request does not match the persistence contract.");
    await expect(handlers.get(CONNECTION_CHANNELS.create)?.(undefined, { profile: {}, credential: { action: "replace", apiKey: "test-secret-must-not-appear" } }))
      .rejects.toThrow("The request does not match the connection contract.");
  });

  it("invokes every public IPC contract with schema-valid input and output", async () => {
    const timestamp = "2026-08-12T12:00:00.000Z";
    const project = {
      contractVersion: 4 as const,
      id: "00000000-0000-4000-8000-000000000001",
      name: "IPC project",
      description: "",
      scriptSource: "",
      scriptHash: "a".repeat(64),
      connectionProfileId: null,
      modelId: null,
      speakerMappings: [],
      pausePresets: [{ pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }],
      transitionPauses: { paragraph: { mode: "preset" as const, pauseId: "pause_medium" as const }, speakerChange: { mode: "none" as const }, section: { mode: "none" as const } },
      lexiconEntries: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const summary = {
      schemaVersion: 1 as const,
      overall: "connected" as const,
      testedAt: timestamp,
      httpStatus: 200,
      stages: ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"].map((stage) => ({
        stage,
        status: "pass" as const,
        code: `${stage}-pass`,
        message: "Passed.",
        durationMs: 1
      })),
      availableModelIds: ["model"],
      availableVoiceIds: ["voice"]
    };
    const profile = {
      id: "profile",
      name: "IPC profile",
      baseUrl: "http://127.0.0.1:8000",
      suppliedUrlForm: "root" as const,
      source: "saved" as const,
      editable: true,
      credentialEntryAllowed: true,
      configured: true,
      apiKeyConfigured: false,
      defaultModelId: "model",
      defaultVoiceId: "voice",
      timeoutSeconds: 120,
      retryCount: 2,
      responseFormat: "wav" as const,
      lastTestedAt: timestamp,
      lastSuccessfulTestAt: timestamp,
      lastTestSummary: summary,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const setup = { activeProfileId: "profile", activeProfileLocked: false, onboardingCompletedAt: timestamp, client: "electron" as const };
    const catalog = { schemaVersion: 1 as const, modelId: "model", entries: [] };
    const speechCatalog = { schemaVersion: 1 as const, profileId: "profile", models: [{ modelId: "model", voices: [{ voiceId: "voice", name: "Voice", language: null, gender: null }] }] };
    persistence.projects.list.mockResolvedValue([{
      id: project.id,
      name: project.name,
      description: project.description,
      scriptHash: project.scriptHash,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    }] as never);
    persistence.projects.create.mockResolvedValue(project);
    persistence.projects.get.mockResolvedValue(project);
    persistence.projects.replace.mockResolvedValue(project);
    persistence.projects.duplicate.mockResolvedValue(project);
    persistence.projects.delete.mockResolvedValue(undefined);
    persistence.settings.updatePacing.mockResolvedValue({ enabled: false, durationMs: 900 });
    persistence.preferences.replaceIgnoredDiagnostics.mockResolvedValue([]);
    persistence.globalLexicon.replace.mockResolvedValue([]);
    connections.list.mockResolvedValue([profile] as never);
    connections.create.mockResolvedValue(profile);
    connections.replace.mockResolvedValue(profile);
    connections.delete.mockResolvedValue(undefined);
    connections.test.mockResolvedValue(summary as never);
    connections.discoverSpeechCatalog.mockResolvedValue(speechCatalog);
    connections.exportDiagnostics.mockResolvedValue({
      schemaVersion: 1, applicationVersion: "0.1.0", runtimeVersions: { node: "26.7.0", electron: "43.3.0" },
      profileId: "profile", profileSource: "saved", endpointClass: "loopback", suppliedUrlForm: "root",
      modelId: "model", voiceId: "voice", apiKeyConfigured: false,
      requestCounts: { health: 1, models: 1, voices: 1, speech: 1 }, result: summary
    } as never);
    connections.setActiveProfile.mockResolvedValue(setup);
    connections.completeOnboarding.mockResolvedValue(setup);
    voiceCatalog.get.mockResolvedValue(catalog);
    voiceCatalog.replace.mockResolvedValue(catalog);

    const handlers = new Map<string, (event?: unknown, input?: unknown) => Promise<unknown>>();
    const ipcMain = { removeHandler: (channel: string) => handlers.delete(channel), handle: (channel: string, handler: (event?: unknown, input?: unknown) => Promise<unknown>) => handlers.set(channel, handler) };
    const service = { health: vi.fn(), runtime: vi.fn(), diagnostics: vi.fn(async () => diagnostics), close: vi.fn() };
    registerDiagnosticsHandler(ipcMain, service as never, {} as never);
    registerPersistenceHandlers(ipcMain, persistence as never);
    registerConnectionHandlers(ipcMain, connections as never, voiceCatalog as never);
    registerScratchpadHandlers(ipcMain, scratchpad);
    registerProjectPreviewHandlers(ipcMain, projectPreview);
    registerSpeechCacheHandlers(ipcMain, speechCache);
    registerRenderPlanHandlers(ipcMain, renderPlans);
    registerRenderHandlers(ipcMain, renders as never, saveDialog);
    const projectReplace = { name: project.name, description: "", scriptSource: "", connectionProfileId: null, modelId: null, speakerMappings: [], pausePresets: project.pausePresets, transitionPauses: project.transitionPauses, lexiconEntries: [] };
    const mutation = { profile: { id: "profile", name: "IPC profile", baseUrl: "http://127.0.0.1:8000", defaultModelId: "model", defaultVoiceId: "voice" }, credential: { action: "keep" } };
    const inputs: Record<string, unknown> = {
      [PERSISTENCE_CHANNELS.projectsCreate]: { name: "IPC project" },
      [PERSISTENCE_CHANNELS.projectsGet]: { projectId: project.id },
      [PERSISTENCE_CHANNELS.projectsReplace]: { projectId: project.id, project: projectReplace },
      [PERSISTENCE_CHANNELS.projectsDuplicate]: { projectId: project.id, duplicate: { name: "IPC copy" } },
      [PERSISTENCE_CHANNELS.projectsDelete]: { projectId: project.id },
      [PERSISTENCE_CHANNELS.pacingUpdate]: { enabled: false, durationMs: 900 },
      [PERSISTENCE_CHANNELS.ignoredReplace]: [],
      [PERSISTENCE_CHANNELS.globalLexiconReplace]: [],
      [CONNECTION_CHANNELS.create]: mutation,
      [CONNECTION_CHANNELS.replace]: { profileId: "profile", mutation },
      [CONNECTION_CHANNELS.delete]: { profileId: "profile" },
      [CONNECTION_CHANNELS.test]: { profileId: "profile" },
      [CONNECTION_CHANNELS.speechCatalogDiscover]: { profileId: "profile" },
      [CONNECTION_CHANNELS.exportDiagnostics]: { profileId: "profile" },
      [CONNECTION_CHANNELS.setupSetActive]: { profileId: "profile" },
      [CONNECTION_CHANNELS.voiceCatalogGet]: { modelId: "model" },
      [CONNECTION_CHANNELS.voiceCatalogReplace]: catalog,
      [SCRATCHPAD_CHANNELS.preview]: { connectionProfileId: "profile", modelId: "model", voiceId: "voice", speed: 1, text: "Speech.", applyGlobalLexicon: false },
      [PROJECT_PREVIEW_CHANNELS.preview]: { projectId: project.id, preview: { mode: "segment", nodeOrdinal: 1 } },
      [SPEECH_CACHE_CHANNELS.clearProject]: { projectId: project.id },
      [SPEECH_CACHE_CHANNELS.clearEntry]: { cacheKey: "a".repeat(64) },
      [RENDER_PLAN_CHANNELS.create]: { projectId: project.id },
      [RENDER_PLAN_CHANNELS.list]: { projectId: project.id },
      [RENDER_PLAN_CHANNELS.get]: { planId: renderPlan.id },
      [RENDER_CHANNELS.start]: { planId: renderPlan.id },
      [RENDER_CHANNELS.list]: { projectId: project.id },
      [RENDER_CHANNELS.get]: { renderId: renderJob.id },
      [RENDER_CHANNELS.cancel]: { renderId: renderJob.id },
      [RENDER_CHANNELS.retry]: { renderId: renderJob.id },
      [RENDER_CHANNELS.artifacts]: { renderId: renderJob.id },
      [RENDER_CHANNELS.exportArtifact]: { artifactId: renderArtifact.id }
    };
    const invoked = new Set<string>();
    for (const channel of PUBLIC_IPC_CHANNEL_MANIFEST) {
      const handler = handlers.get(channel);
      expect(handler, channel).toBeDefined();
      try {
        expect(await handler?.(undefined, inputs[channel]), channel).toBeDefined();
      } catch (error) {
        throw new Error(`Public IPC contract failed for ${channel}.`, { cause: error });
      }
      invoked.add(channel);
    }
    expect(invoked).toEqual(new Set(PUBLIC_IPC_CHANNEL_MANIFEST));

    const secret = "test-secret-must-not-appear";
    for (const channel of Object.keys(inputs)) {
      await expect(handlers.get(channel)?.(undefined, { malformed: true, apiKey: secret })).rejects.toThrow();
    }
  });

  it("keeps the renderer sandboxed without Node integration", () => {
    expect(SECURE_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    });
    expect(isApprovedExternalUrl("https://speaches.ai/installation/")).toBe(true);
    expect(isApprovedExternalUrl("http://speaches.ai/installation/")).toBe(false);
    expect(isApprovedExternalUrl("https://speaches.ai.example.test/")).toBe(false);
  });
});
