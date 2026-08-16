import { describe, expect, it, vi } from "vitest";
import {
  CONNECTION_CHANNELS,
  DEFAULT_SYSTEM_TIMING,
  PERSISTENCE_CHANNELS,
  PROJECT_PREVIEW_CHANNELS,
  RENDER_PLAN_CHANNELS,
  RENDER_CHANNELS,
  SCRATCHPAD_CHANNELS,
  SCRIPT_GENERATION_CHANNELS,
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
  registerScriptGenerationHandlers,
  registerSpeechCacheHandlers
} from "./ipc.js";
import { isApprovedExternalUrl, SECURE_WEB_PREFERENCES } from "./security.js";

const diagnostics = {
  schemaVersion: 1,
  overall: "fail",
  client: "electron",
  transport: "ipc",
  runtime: {
    schemaVersion: 1,
    applicationVersion: "0.1.0",
    runtimeName: "electron",
    runtimeVersion: "24.0.0",
    electronVersion: "43.3.0",
    platform: "darwin",
    architecture: "arm64",
    dataDirectory: "/tmp/studynarrator",
    distribution: "electron",
    sourceRevision: "test-revision"
  },
  checks: {
    sharedCore: { status: "pass", marker: "study-narrator-core" },
    storage: { status: "fail", code: "STORAGE_UNAVAILABLE", message: "Storage unavailable." },
    ffmpeg: { status: "fail", executable: "ffmpeg", code: "FFMPEG_NOT_FOUND", message: "FFmpeg not found." }
  }
} as const;

const persistenceStatus = {
  contractVersion: 1 as const,
  state: "ready" as const,
  databaseSchemaVersion: 2 as const,
  targetDatabaseSchemaVersion: 2 as const,
  databasePath: "/tmp/studynarrator.sqlite",
  latestBackupPath: null
};

const persistence = {
  status: vi.fn(async () => persistenceStatus),
  projects: { list: vi.fn(async () => []), create: vi.fn(), get: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), delete: vi.fn() },
  settings: { getPacing: vi.fn(async () => DEFAULT_SYSTEM_TIMING), updatePacing: vi.fn() },
  preferences: { getIgnoredDiagnostics: vi.fn(async () => []), replaceIgnoredDiagnostics: vi.fn() },
  globalLexicon: { list: vi.fn(async () => []), replace: vi.fn() }
};

const connection = {
  get: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  discoverSpeechCatalog: vi.fn(),
  exportDiagnostics: vi.fn(),
  getSetupState: vi.fn(async () => ({ onboardingCompletedAt: null, client: "electron" as const })),
  completeOnboarding: vi.fn()
};
const voiceCatalog = { get: vi.fn(), replace: vi.fn() };
const scratchpadResult = {
  schemaVersion: 1 as const,
  id: "00000000-0000-4000-8000-000000000099",
  createdAt: "2026-08-12T12:00:00.000Z",
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
  start: vi.fn(async () => renderJob), startProject: vi.fn(async () => renderJob), list: vi.fn(async () => [renderJob]), get: vi.fn(async () => renderJob),
  cancel: vi.fn(async () => renderJob), retry: vi.fn(async () => renderJob), listArtifacts: vi.fn(async () => []),
  exportArtifact: vi.fn(async () => ({ disposition: "download" as const, fileName: "audio.mp3" })),
  resolveArtifact: vi.fn(async () => ({ artifact: renderArtifact, path: "/tmp/audio.mp3" })),
  resolveRenderAudio: vi.fn(async () => ({ path: "/tmp/audio.mp3", fileName: "audio.mp3", mimeType: "audio/mpeg" as const, sizeBytes: 3 })),
  resolveDetailsArchive: vi.fn(async () => ({ bytes: Uint8Array.from([1]), fileName: "details.zip", mimeType: "application/zip" as const })),
  resolveSegmentAudio: vi.fn(async () => ({ path: "/tmp/000001.wav", fileName: "000001.wav", mimeType: "audio/wav" as const, sizeBytes: 3 })),
  listSegments: vi.fn(async () => []),
  getWaveform: vi.fn(async () => ({ status: "unavailable" as const, renderId: renderJob.id, reason: "audioMissing" as const })),
  exportSegment: vi.fn(async () => ({ disposition: "download" as const, fileName: "000001.wav" })),
  close: vi.fn()
};
const saveDialog = { showSaveDialog: vi.fn(async () => ({ canceled: true })) };
const promptDocument = { kind: "creation" as const, fileName: "prompt.md", mimeType: "text/markdown; charset=utf-8" as const, content: "Prompt", checksum: "a".repeat(64) };
const scriptGeneration = {
  previewPrompt: vi.fn(async () => promptDocument),
  resolvePromptExport: vi.fn(async () => ({ fileName: "prompt.md", mimeType: "text/markdown; charset=utf-8" as const, bytes: Uint8Array.from([1]), checksum: "a".repeat(64) })),
  resolveSkillPackage: vi.fn(async () => ({ fileName: "skill.zip", mimeType: "application/zip" as const, bytes: Uint8Array.from([1]), checksum: "b".repeat(64) }))
};

describe("Electron boundary", () => {
  it("exposes only the validated diagnostics and persistence operations", async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === SYSTEM_DIAGNOSTICS_CHANNEL) return diagnostics;
      if (channel === PERSISTENCE_CHANNELS.projectsList) return [];
      if (channel === SCRIPT_GENERATION_CHANNELS.exportPrompt) return { disposition: "saved", fileName: "prompt.md" };
      if (channel === CONNECTION_CHANNELS.get) return {
        baseUrl: null, suppliedUrlForm: "unconfigured", configured: false, defaultModelId: null, defaultVoiceId: null,
        timeoutSeconds: 120, retryCount: 2, responseFormat: "wav", lastTestedAt: null, lastSuccessfulTestAt: null,
        lastTestSummary: null, createdAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z"
      };
      return persistenceStatus;
    });
    const bridge = createPreloadBridge(invoke);
    expect(Object.keys(bridge)).toEqual(["system", "persistence", "connection", "voiceCatalog", "scratchpad", "projectPreview", "speechCache", "renderPlans", "renders", "scriptGeneration"]);
    expect(Object.keys(bridge.system)).toEqual(["diagnostics"]);
    await expect(bridge.system.diagnostics()).resolves.toEqual(diagnostics);
    expect(invoke).toHaveBeenCalledWith(SYSTEM_DIAGNOSTICS_CHANNEL);
    await expect(bridge.persistence.projects.list()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith(PERSISTENCE_CHANNELS.projectsList);
    await expect(bridge.connection.get()).resolves.toMatchObject({ configured: false });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.get);
    expect(bridge.renders.renderAudioSource(renderJob.id)).toBe(`studynarrator-media://render/${renderJob.id}`);
    expect(bridge.renders.segmentAudioSource(renderJob.id, 3)).toBe(`studynarrator-media://segment/${renderJob.id}/3`);
    expect(() => bridge.renders.renderAudioSource("../outside")).toThrow();
    await expect(bridge.scriptGeneration.exportPrompt(null, "update", "Edited prompt")).resolves.toEqual({ disposition: "saved", fileName: "prompt.md" });
    expect(invoke).toHaveBeenCalledWith(SCRIPT_GENERATION_CHANNELS.exportPrompt, { projectId: null, kind: "update", content: "Edited prompt" });
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
    registerConnectionHandlers(ipcMain, connection as never, voiceCatalog as never);
    registerScratchpadHandlers(ipcMain, scratchpad);
    registerProjectPreviewHandlers(ipcMain, projectPreview);
    registerSpeechCacheHandlers(ipcMain, speechCache);
    registerRenderPlanHandlers(ipcMain, renderPlans);
    registerRenderHandlers(ipcMain, renders as never, saveDialog);
    registerScriptGenerationHandlers(ipcMain, scriptGeneration, saveDialog);
    expect([...handlers.keys()]).toEqual(PUBLIC_IPC_CHANNEL_MANIFEST);
    expect([...handlers.keys()]).not.toContain("persistence.execute");
    await expect(handlers.get(SYSTEM_DIAGNOSTICS_CHANNEL)?.()).resolves.toEqual(diagnostics);
    await expect(handlers.get(PERSISTENCE_CHANNELS.projectsList)?.()).resolves.toEqual([]);
    await expect(handlers.get(PERSISTENCE_CHANNELS.projectsCreate)?.(undefined, { name: "", secret: "must-not-leak" }))
      .rejects.toThrow("The request does not match the persistence contract.");
    await expect(handlers.get(CONNECTION_CHANNELS.update)?.(undefined, { baseUrl: "http://127.0.0.1:8000", apiKey: "test-secret-must-not-appear" }))
      .rejects.toThrow("The request does not match the connection contract.");
  });

  it("invokes every public IPC contract with schema-valid input and output", async () => {
    const timestamp = "2026-08-12T12:00:00.000Z";
    const project = {
      contractVersion: 1 as const,
      id: "00000000-0000-4000-8000-000000000001",
      name: "IPC project",
      description: "",
      scriptSource: "",
      scriptHash: "a".repeat(64),
      speakerMappings: [],
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
    const storedConnection = {
      baseUrl: "http://127.0.0.1:8000",
      suppliedUrlForm: "root" as const,
      configured: true,
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
    const setup = { onboardingCompletedAt: timestamp, client: "electron" as const };
    const catalog = { schemaVersion: 1 as const, modelId: "model", entries: [] };
    const speechCatalog = { schemaVersion: 1 as const, models: [{ modelId: "model", voices: [{ voiceId: "voice", name: "Voice", language: null, gender: null }] }] };
    persistence.projects.list.mockResolvedValue([{
      id: project.id,
      name: project.name,
      description: project.description,
      scriptHash: project.scriptHash,
      scriptLineCount: null,
      audioDurationMs: null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    }] as never);
    persistence.projects.create.mockResolvedValue(project);
    persistence.projects.get.mockResolvedValue(project);
    persistence.projects.replace.mockResolvedValue(project);
    persistence.projects.duplicate.mockResolvedValue(project);
    persistence.projects.delete.mockResolvedValue(undefined);
    persistence.settings.updatePacing.mockResolvedValue(DEFAULT_SYSTEM_TIMING);
    persistence.preferences.replaceIgnoredDiagnostics.mockResolvedValue([]);
    persistence.globalLexicon.replace.mockResolvedValue([]);
    connection.get.mockResolvedValue(storedConnection as never);
    connection.update.mockResolvedValue(storedConnection as never);
    connection.test.mockResolvedValue(summary as never);
    connection.discoverSpeechCatalog.mockResolvedValue(speechCatalog);
    connection.exportDiagnostics.mockResolvedValue({
      schemaVersion: 1, applicationVersion: "0.1.0", runtimeVersions: { node: "26.7.0", electron: "43.3.0" },
      endpointClass: "loopback", suppliedUrlForm: "root", modelId: "model", voiceId: "voice",
      requestCounts: { health: 1, models: 1, voices: 1, speech: 1 }, result: summary
    } as never);
    connection.getSetupState.mockResolvedValue(setup as never);
    connection.completeOnboarding.mockResolvedValue(setup);
    voiceCatalog.get.mockResolvedValue(catalog);
    voiceCatalog.replace.mockResolvedValue(catalog);

    const handlers = new Map<string, (event?: unknown, input?: unknown) => Promise<unknown>>();
    const ipcMain = { removeHandler: (channel: string) => handlers.delete(channel), handle: (channel: string, handler: (event?: unknown, input?: unknown) => Promise<unknown>) => handlers.set(channel, handler) };
    const service = { health: vi.fn(), runtime: vi.fn(), diagnostics: vi.fn(async () => diagnostics), close: vi.fn() };
    registerDiagnosticsHandler(ipcMain, service as never, {} as never);
    registerPersistenceHandlers(ipcMain, persistence as never);
    registerConnectionHandlers(ipcMain, connection as never, voiceCatalog as never);
    registerScratchpadHandlers(ipcMain, scratchpad);
    registerProjectPreviewHandlers(ipcMain, projectPreview);
    registerSpeechCacheHandlers(ipcMain, speechCache);
    registerRenderPlanHandlers(ipcMain, renderPlans);
    registerRenderHandlers(ipcMain, renders as never, saveDialog);
    registerScriptGenerationHandlers(ipcMain, scriptGeneration, saveDialog);
    const projectReplace = { name: project.name, description: "", scriptSource: "", speakerMappings: [], lexiconEntries: [] };
    const connectionInput = { baseUrl: "http://127.0.0.1:8000", defaultModelId: "model", defaultVoiceId: "voice" };
    const inputs: Record<string, unknown> = {
      [PERSISTENCE_CHANNELS.projectsCreate]: { name: "IPC project" },
      [PERSISTENCE_CHANNELS.projectsGet]: { projectId: project.id },
      [PERSISTENCE_CHANNELS.projectsReplace]: { projectId: project.id, project: projectReplace },
      [PERSISTENCE_CHANNELS.projectsDuplicate]: { projectId: project.id, duplicate: { name: "IPC copy" } },
      [PERSISTENCE_CHANNELS.projectsDelete]: { projectId: project.id },
      [PERSISTENCE_CHANNELS.pacingUpdate]: DEFAULT_SYSTEM_TIMING,
      [PERSISTENCE_CHANNELS.ignoredReplace]: [],
      [PERSISTENCE_CHANNELS.globalLexiconReplace]: [],
      [CONNECTION_CHANNELS.update]: connectionInput,
      [CONNECTION_CHANNELS.speechCatalogDiscover]: { baseUrl: "http://127.0.0.1:8000" },
      [CONNECTION_CHANNELS.voiceCatalogGet]: { modelId: "model" },
      [CONNECTION_CHANNELS.voiceCatalogReplace]: catalog,
      [SCRATCHPAD_CHANNELS.preview]: { modelId: "model", voiceId: "voice", speed: 1, text: "Speech.", applyGlobalLexicon: false },
      [PROJECT_PREVIEW_CHANNELS.preview]: { projectId: project.id, preview: { mode: "segment", nodeOrdinal: 1 } },
      [SPEECH_CACHE_CHANNELS.clearProject]: { projectId: project.id },
      [SPEECH_CACHE_CHANNELS.clearEntry]: { cacheKey: "a".repeat(64) },
      [RENDER_PLAN_CHANNELS.create]: { projectId: project.id },
      [RENDER_PLAN_CHANNELS.list]: { projectId: project.id },
      [RENDER_PLAN_CHANNELS.get]: { planId: renderPlan.id },
      [RENDER_CHANNELS.start]: { planId: renderPlan.id },
      [RENDER_CHANNELS.startProject]: { projectId: project.id },
      [RENDER_CHANNELS.list]: { projectId: project.id },
      [RENDER_CHANNELS.get]: { renderId: renderJob.id },
      [RENDER_CHANNELS.cancel]: { renderId: renderJob.id },
      [RENDER_CHANNELS.retry]: { renderId: renderJob.id },
      [RENDER_CHANNELS.artifacts]: { renderId: renderJob.id },
      [RENDER_CHANNELS.exportArtifact]: { artifactId: renderArtifact.id },
      [RENDER_CHANNELS.exportAudio]: { renderId: renderJob.id },
      [RENDER_CHANNELS.exportDetails]: { renderId: renderJob.id },
      [RENDER_CHANNELS.segments]: { renderId: renderJob.id },
      [RENDER_CHANNELS.waveform]: { renderId: renderJob.id },
      [RENDER_CHANNELS.exportSegment]: { renderId: renderJob.id, ordinal: 1 },
      [SCRIPT_GENERATION_CHANNELS.previewPrompt]: { projectId: null, kind: "creation" },
      [SCRIPT_GENERATION_CHANNELS.exportPrompt]: { projectId: null, kind: "update", content: "Edited prompt" },
      [SCRIPT_GENERATION_CHANNELS.exportSkillPackage]: { projectId: null }
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
    expect(scriptGeneration.resolvePromptExport).toHaveBeenCalledWith(null, "update", "Edited prompt");

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
