import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConnectionsService,
  createPersistenceService,
  createRoutedCredentialStore,
  createScriptGenerationService,
  createSystemService,
  createUnavailablePersistenceService,
  createVoiceCatalogService,
  type DiagnosticsContext
} from "@studynarrator/application";
import { openStudyNarratorRepository, type DatabaseConstructor } from "@studynarrator/persistence";
import {
  BoundaryErrorSchema,
  HealthSchema,
  ProjectDetailSchema,
  ProjectPreviewResultSchema,
  ProjectSummaryCollectionSchema,
  RenderPlanSchema,
  RenderPlanSummaryCollectionSchema,
  RuntimeSchema,
  SpeechCacheCleanupResultSchema,
  SpeechCacheStatusSchema,
  SpeechCatalogSchema,
  SystemDiagnosticsSchema
} from "@studynarrator/shared-types";
import { createExpressApp } from "./app.js";
import { REST_API_MANIFEST } from "./apiManifest.js";

const context: DiagnosticsContext = {
  client: "web",
  transport: "rest",
  runtimeName: "node",
  runtimeVersion: "26.7.0",
  electronVersion: null,
  platform: "darwin",
  architecture: "arm64",
  dataDirectory: "/tmp/studynarrator"
};

const openServers = new Set<Server>();
const openServices = new Set<{ close(): void }>();

async function listen(app: ReturnType<typeof createExpressApp>): Promise<Server> {
  const server = createServer(app);
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => rejectListen(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolveListen();
    });
  });
  openServers.add(server);
  return server;
}

afterEach(async () => {
  await Promise.all([...openServers].map(async (server) => await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => { if (error) rejectClose(error); else resolveClose(); });
  })));
  openServers.clear();
  for (const service of openServices) service.close();
  openServices.clear();
});

async function fixture() {
  const databasePath = join(mkdtempSync(join(tmpdir(), "studynarrator-server-")), "app.sqlite");
  const repository = await openStudyNarratorRepository({ Database: Database as unknown as DatabaseConstructor, databasePath });
  const service = createSystemService({
    repository,
    ffmpegProbe: { run: async () => ({ status: "pass", executable: "ffmpeg", version: "ffmpeg version test" }) }
  });
  const persistence = createPersistenceService(repository);
  const connections = createConnectionsService({
    repository,
    credentials: createRoutedCredentialStore({ environmentApiKey: null }),
    context: { client: "web", nodeVersion: "26.7.0", electronVersion: null, activeProfileLocked: false },
    discoverCatalog: async ({ profileId }) => ({ schemaVersion: 1, profileId, models: [{ modelId: "model", voices: [{ voiceId: "voice", name: "Voice", language: null, gender: null }] }] })
  });
  const voiceCatalog = createVoiceCatalogService({ repository, bundledCatalogs: new Map() });
  const scriptGeneration = createScriptGenerationService({ repository });
  const scratchpad = {
    preview: async (input: { connectionProfileId: string; modelId: string; voiceId: string; speed: number; text: string; applyGlobalLexicon: boolean }) => ({
      schemaVersion: 2 as const,
      id: "00000000-0000-4000-8000-000000000099",
      createdAt: "2026-08-12T12:00:00.000Z",
      connectionProfileId: input.connectionProfileId,
      connectionProfileName: "Manifest",
      modelId: input.modelId,
      voiceId: input.voiceId,
      voiceLabel: "Voice",
      speed: input.speed,
      originalText: input.text,
      readableText: input.text,
      transformedText: input.text,
      lexiconApplied: input.applyGlobalLexicon,
      warnings: [],
      cache: {
        key: "a".repeat(64), status: "hit" as const, byteLength: 3,
        createdAt: "2026-08-12T12:00:00.000Z", lastUsedAt: "2026-08-12T12:00:00.000Z"
      },
      audio: { mimeType: "audio/wav" as const, base64: "AQID", byteLength: 3 }
    })
  };
  const projectPreview = {
    preview: async (requestedProjectId: string, input: { mode: "segment" | "pronunciation" }) => ({
      schemaVersion: 1 as const,
      id: "00000000-0000-4000-8000-000000000098",
      createdAt: "2026-08-12T12:00:00.000Z",
      projectId: requestedProjectId,
      mode: input.mode,
      nodeOrdinal: input.mode === "segment" ? 1 : null,
      sourceRange: input.mode === "segment"
        ? { start: { line: 1, column: 1 }, end: { line: 1, column: 17 } }
        : null,
      connectionProfileId: "manifest-profile",
      connectionProfileName: "Manifest",
      modelId: "model",
      speakerId: "narrator" as const,
      voiceId: "voice",
      voiceLabel: "Voice",
      speed: 1,
      originalText: "Manifest speech.",
      readableText: "Manifest speech.",
      transformedText: "Manifest speech.",
      cache: {
        key: "a".repeat(64), status: "hit" as const, byteLength: 3,
        createdAt: "2026-08-12T12:00:00.000Z", lastUsedAt: "2026-08-12T12:00:00.000Z"
      },
      audio: { mimeType: "audio/wav" as const, base64: "AQID", byteLength: 3 }
    })
  };
  const speechCache = {
    status: async () => ({
      contractVersion: 1 as const, entryCount: 1, totalBytes: 3,
      lastUsedAt: "2026-08-12T12:00:00.000Z", sessionHits: 1, sessionMisses: 0,
      sessionWrites: 0, sessionCorruptMisses: 0, inFlight: 0
    }),
    clearAll: async () => ({ contractVersion: 1 as const, entriesRemoved: 1, bytesFreed: 3 }),
    clearProject: async (_projectId: string) => ({ contractVersion: 1 as const, entriesRemoved: 1, bytesFreed: 3 }),
    clearEntry: async (_cacheKey: string) => ({ contractVersion: 1 as const, entriesRemoved: 1, bytesFreed: 3 })
  };
  const renderPlanId = "00000000-0000-4000-8000-000000000002";
  const renderPlanFor = (projectId: string) => ({
    schemaVersion: 1 as const,
    id: renderPlanId,
    projectId,
    createdAt: "2026-08-12T12:00:00.000Z",
    snapshotHash: "b".repeat(64),
    planHash: "c".repeat(64),
    scriptHash: "a".repeat(64),
    entries: [],
    summary: { sectionCount: 0, speechCount: 0, pauseCount: 0, cacheHits: 0, cacheMisses: 0, silenceDurationMs: 0 }
  });
  let lastRenderPlan = renderPlanFor("00000000-0000-4000-8000-000000000001");
  const renderPlans = {
    create: async (projectId: string) => { lastRenderPlan = renderPlanFor(projectId); return lastRenderPlan; },
    list: async (projectId: string) => lastRenderPlan.projectId === projectId ? [{
      id: lastRenderPlan.id,
      projectId: lastRenderPlan.projectId,
      createdAt: lastRenderPlan.createdAt,
      snapshotHash: lastRenderPlan.snapshotHash,
      planHash: lastRenderPlan.planHash,
      scriptHash: lastRenderPlan.scriptHash,
      summary: lastRenderPlan.summary
    }] : [],
    get: async () => lastRenderPlan
  };
  const renderId = "00000000-0000-4000-8000-000000000003";
  const artifactId = "00000000-0000-4000-8000-000000000004";
  const renderJob = () => ({
    contractVersion: 1 as const, id: renderId, projectId: lastRenderPlan.projectId, planId: lastRenderPlan.id,
    retryOfRenderId: null, state: "complete" as const,
    progress: { phase: "complete" as const, sectionTitle: null, sectionOrdinal: 0, sectionCount: 0, entryOrdinal: null, speechOrdinal: 0, speechCount: 0, chunkOrdinal: null, completedChunks: 0, totalChunks: 0, cacheHits: 0, cacheMisses: 0, ttsRequests: 0, speakerId: null, voiceId: null, excerpt: null, elapsedMs: 1 },
    error: null, createdAt: lastRenderPlan.createdAt, startedAt: lastRenderPlan.createdAt, finishedAt: lastRenderPlan.createdAt
  });
  const artifact = {
    contractVersion: 1 as const, id: artifactId, renderId, type: "manifest" as const, fileName: "package.json",
    sizeBytes: 1, checksum: "d".repeat(64), durationMs: null, createdAt: lastRenderPlan.createdAt
  };
  const renders = {
    start: async () => renderJob(), list: async () => [renderJob()], get: async () => renderJob(),
    cancel: async () => renderJob(), retry: async () => renderJob(), listArtifacts: async () => [artifact],
    exportArtifact: async () => ({ disposition: "download" as const, fileName: artifact.fileName }),
    resolveArtifact: async () => ({ artifact, path: join(import.meta.dirname, "../../../package.json") }),
    resolveRenderAudio: async () => ({ path: join(import.meta.dirname, "../../../package.json"), fileName: "fixture.mp3", mimeType: "audio/mpeg" as const, sizeBytes: 1 }),
    resolveSegmentAudio: async () => ({ path: join(import.meta.dirname, "../../../package.json"), fileName: "000001.wav", mimeType: "audio/wav" as const, sizeBytes: 1 }),
    listSegments: async () => [],
    getWaveform: async () => ({ status: "unavailable" as const, renderId, reason: "audioMissing" as const }),
    exportSegment: async () => ({ disposition: "download" as const, fileName: "000001.wav" }),
    close: async () => undefined
  };
  openServices.add(service);
  return {
    service, persistence, connections, voiceCatalog, scratchpad, projectPreview, speechCache, renderPlans, renders, scriptGeneration,
    app: await listen(createExpressApp({ service, persistence, connections, voiceCatalog, scratchpad, projectPreview, speechCache, renderPlans, renders, scriptGeneration, context }))
  };
}

describe("Express diagnostics API", () => {
  it("serves side-effect-free health and runtime contracts", async () => {
    const { app } = await fixture();
    HealthSchema.parse((await request(app).get("/api/health").expect(200)).body);
    RuntimeSchema.parse((await request(app).get("/api/runtime").expect(200)).body);
  });

  it("serves the shared diagnostics contract", async () => {
    const { app } = await fixture();
    const response = await request(app).get("/api/diagnostics").expect(200);
    const diagnostics = SystemDiagnosticsSchema.parse(response.body);
    expect(diagnostics.client).toBe("web");
    expect(diagnostics.transport).toBe("rest");
  });

  it("sanitizes an invalid boundary result", async () => {
    const service = {
      health: () => ({ status: "ok", applicationVersion: "0.1.0" } as const),
      runtime: () => ({ ...context, schemaVersion: 3, applicationVersion: "0.1.0" } as never),
      diagnostics: async () => ({ secret: "must-not-leak" } as never),
      close: () => undefined
    };
    const response = await request(await listen(createExpressApp({ service, context }))).get("/api/diagnostics").expect(500);
    expect(response.body).toEqual({
      error: {
        code: "DIAGNOSTICS_BOUNDARY_ERROR",
        message: "StudyNarrator could not validate the diagnostics response."
      }
    });
    expect(JSON.stringify(response.body)).not.toContain("must-not-leak");
  });
});

describe("Express Scratchpad cancellation", () => {
  it("aborts privileged synthesis when the REST client disconnects", async () => {
    const { service } = await fixture();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolveStarted) => { markStarted = resolveStarted; });
    let markAborted: (() => void) | undefined;
    const aborted = new Promise<void>((resolveAborted) => { markAborted = resolveAborted; });
    const scratchpad = {
      preview: async (_input: unknown, signal?: AbortSignal) => await new Promise<never>((_resolve, reject) => {
        markStarted?.();
        signal?.addEventListener("abort", () => {
          markAborted?.();
          reject(Object.assign(new Error("cancelled"), { code: "SCRATCHPAD_ABORTED" }));
        }, { once: true });
      })
    };
    const app = await listen(createExpressApp({ service, scratchpad, context }));
    const address = app.address();
    if (!address || typeof address === "string") throw new Error("Expected a loopback address.");
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${String(address.port)}/api/scratchpad/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionProfileId: "profile", modelId: "model", voiceId: "voice", speed: 1, text: "Speech.", applyGlobalLexicon: false }),
      signal: controller.signal
    });
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(aborted).resolves.toBeUndefined();
  });
});

describe("Express persistence API", () => {
  it("creates, replaces, reads, lists, and deletes complete project aggregates", async () => {
    const { app } = await fixture();
    const created = ProjectDetailSchema.parse((await request(app).post("/api/projects").send({ name: "REST study" }).expect(201)).body as unknown);
    expect(created).toMatchObject({ name: "REST study", transitionPauses: { paragraph: { mode: "preset", pauseId: "pause_medium" } } });

    const source = "Résumé\r\n\r\nSQL 🧠";
    const replaced = ProjectDetailSchema.parse((await request(app).put(`/api/projects/${created.id}`).send({
      name: "REST study",
      description: "Restart-safe",
      scriptSource: source,
      connectionProfileId: null,
      speakerMappings: [],
      pausePresets: created.pausePresets,
      transitionPauses: created.transitionPauses,
      lexiconEntries: [{ scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }]
    }).expect(200)).body as unknown);
    expect(replaced.scriptSource).toBe(source);
    expect(replaced.scriptHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(ProjectDetailSchema.parse((await request(app).get(`/api/projects/${created.id}`).expect(200)).body as unknown)).toEqual(replaced);
    expect(ProjectSummaryCollectionSchema.parse((await request(app).get("/api/projects").expect(200)).body as unknown)).toHaveLength(1);
    const duplicate = ProjectDetailSchema.parse((await request(app).post(`/api/projects/${created.id}/duplicate`).send({ name: "REST study copy" }).expect(201)).body as unknown);
    expect(duplicate).toMatchObject({ name: "REST study copy", scriptSource: source });
    expect(duplicate.id).not.toBe(created.id);
    expect(duplicate.lexiconEntries[0]?.id).not.toBe(replaced.lexiconEntries[0]?.id);
    await request(app).delete(`/api/projects/${created.id}`).expect(204);
    await request(app).get(`/api/projects/${created.id}`).expect(404);
  });

  it("returns path-specific validation errors and sanitized conflicts", async () => {
    const { app } = await fixture();
    const invalidResponse = await request(app).post("/api/projects").send({ name: "", password: "must-not-leak" }).expect(400);
    const invalid = BoundaryErrorSchema.parse(invalidResponse.body as unknown);
    expect(invalid.error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(invalid.error.issues?.some((issue) => issue.path.startsWith("$.") && issue.message.length > 0)).toBe(true);
    expect(JSON.stringify(invalid)).not.toContain("must-not-leak");

    const profile = { profile: { id: "safe-profile", name: "Local placeholder", baseUrl: "http://127.0.0.1:8000", defaultModelId: null, defaultVoiceId: null }, credential: { action: "keep" } };
    await request(app).post("/api/connections").send(profile).expect(201);
    const conflict = BoundaryErrorSchema.parse((await request(app).post("/api/connections").send(profile).expect(409)).body as unknown);
    expect(conflict).toEqual({ error: { code: "CONFLICT", message: "The persistence operation conflicts with existing data." } });
  });

  it("keeps diagnostics status available while degraded writes return 503", async () => {
    const { service } = await fixture();
    const persistence = createUnavailablePersistenceService({
      contractVersion: 4,
      state: "unavailable",
      databaseSchemaVersion: 1,
      targetDatabaseSchemaVersion: 6,
      databasePath: "/tmp/studynarrator.sqlite",
      latestBackupPath: "/tmp/backups/recovery.sqlite",
      code: "MIGRATION_FAILED",
      message: "Migration failed; restore the recovery backup."
    });
    const app = await listen(createExpressApp({ service, persistence, context }));
    await request(app).get("/api/persistence/status").expect(200);
    const response = BoundaryErrorSchema.parse((await request(app).post("/api/projects").send({ name: "Unavailable" }).expect(503)).body as unknown);
    expect(response).toEqual({ error: { code: "PERSISTENCE_UNAVAILABLE", message: "Persistence is unavailable until the database migration is repaired." } });
  });
});

describe("Express connection API", () => {
  it("uses managed connection routes and rejects Web credential entry without echoing it", async () => {
    const { app } = await fixture();
    const secret = "test-secret-must-not-appear";
    const rejected = BoundaryErrorSchema.parse((await request(app).post("/api/connections").send({
      profile: { id: "web-profile", name: "Web", baseUrl: "http://127.0.0.1:8000", defaultModelId: "model", defaultVoiceId: "voice" },
      credential: { action: "replace", apiKey: secret }
    }).expect(409)).body as unknown);
    expect(rejected.error.code).toBe("CONNECTION_POLICY");
    expect(JSON.stringify(rejected)).not.toContain(secret);
    await request(app).get("/api/connection-profiles").expect(404);

    await request(app).post("/api/connections").send({
      profile: { id: "web-profile", name: "Web", baseUrl: "http://127.0.0.1:8000/v1", defaultModelId: "model", defaultVoiceId: "voice" },
      credential: { action: "keep" }
    }).expect(201);
    const profiles = await request(app).get("/api/connections").expect(200);
    expect(profiles.body).toEqual([expect.objectContaining({ id: "web-profile", baseUrl: "http://127.0.0.1:8000", credentialEntryAllowed: false })]);
  });
});

describe("Express render review media", () => {
  it("supports full, HEAD, and single-range playback without exposing a path", async () => {
    const { app } = await fixture();
    const renderId = "00000000-0000-4000-8000-000000000003";
    const full = await request(app).get(`/api/renders/${renderId}/audio`).expect(200);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["content-type"]).toMatch(/^audio\/mpeg/u);
    expect(JSON.stringify(full.headers)).not.toContain(import.meta.dirname);
    await request(app).head(`/api/renders/${renderId}/audio`).expect(200).expect("content-length", "1");
    await request(app).get(`/api/renders/${renderId}/segments/1/audio`).set("range", "bytes=0-0")
      .expect(206).expect("content-range", "bytes 0-0/1").expect("content-length", "1");
    await request(app).get(`/api/renders/${renderId}/audio`).set("range", "bytes=2-3")
      .expect(416).expect("content-range", "bytes */1");
    await request(app).post(`/api/renders/${renderId}/segments/1/export`).expect(200)
      .expect("content-disposition", "attachment; filename=\"000001.wav\"");
  });
});

interface ExpressRouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

describe("REST API operation manifest", () => {
  it("matches every registered method and path exactly", async () => {
    const { service, persistence, connections, voiceCatalog, scratchpad, projectPreview, speechCache, renderPlans, renders, scriptGeneration } = await fixture();
    const application = createExpressApp({ service, persistence, connections, voiceCatalog, scratchpad, projectPreview, speechCache, renderPlans, renders, scriptGeneration, context });
    const layers = (application as unknown as { router: { stack: ExpressRouteLayer[] } }).router.stack;
    const registered = layers.flatMap((layer) => layer.route
      ? Object.entries(layer.route.methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => `${method.toUpperCase()} ${layer.route!.path}`)
      : []);
    const declared = REST_API_MANIFEST.map(({ method, path }) => `${method} ${path}`);
    expect(registered.sort()).toEqual([...declared].sort());
    expect(new Set(declared).size).toBe(55);
  });

  it("exercises a successful schema-valid response for all 55 operations", async () => {
    const { app } = await fixture();
    const covered = new Set<string>();
    const call = async (method: string, path: string, expected: number, body?: string | object) => {
      covered.add(`${method} ${path
        .replace(/^\/api\/render-plans\/[0-9a-f-]{36}\/renders$/u, "/api/render-plans/:planId/renders")
        .replace(/^\/api\/render-plans\/[0-9a-f-]{36}$/u, "/api/render-plans/:planId")
        .replace(/^\/api\/render-artifacts\/[0-9a-f-]{36}$/u, "/api/render-artifacts/:artifactId")
        .replace(/^\/api\/renders\/[0-9a-f-]{36}(?=\/|$)/u, "/api/renders/:renderId")
        .replace(/\/segments\/\d+(?=\/|$)/u, "/segments/:ordinal")
        .replace(/\/[0-9a-f-]{36}(?=\/|$)/gu, "/:projectId")
        .replace(/\/manifest-profile(?=\/|$)/gu, "/:profileId")
        .replace(/\/[a-f0-9]{64}(?=\/|$)/gu, "/:cacheKey")}`);
      const agent = request(app)[method.toLowerCase() as "get"](path);
      if (body !== undefined) agent.send(body);
      return await agent.expect(expected);
    };

    await call("GET", "/api/health", 200);
    await call("GET", "/api/runtime", 200);
    SystemDiagnosticsSchema.parse((await call("GET", "/api/diagnostics", 200)).body as unknown);
    await call("GET", "/api/persistence/status", 200);
    ProjectSummaryCollectionSchema.parse((await call("GET", "/api/projects", 200)).body as unknown);
    const created = ProjectDetailSchema.parse((await call("POST", "/api/projects", 201, { name: "Manifest project" })).body as unknown);
    ProjectDetailSchema.parse((await call("GET", `/api/projects/${created.id}`, 200)).body as unknown);
    const replacement = {
      name: created.name,
      description: "manifest",
      scriptSource: "Manifest source",
      connectionProfileId: null,
      modelId: null,
      speakerMappings: [],
      pausePresets: created.pausePresets,
      transitionPauses: created.transitionPauses,
      lexiconEntries: []
    };
    ProjectDetailSchema.parse((await call("PUT", `/api/projects/${created.id}`, 200, replacement)).body as unknown);
    ProjectDetailSchema.parse((await call("POST", `/api/projects/${created.id}/duplicate`, 201, { name: "Manifest copy" })).body as unknown);
    await call("GET", "/api/settings/pacing", 200);
    await call("PUT", "/api/settings/pacing", 200, { enabled: false, durationMs: 900 });
    await call("GET", "/api/preferences/ignored-diagnostics", 200);
    await call("PUT", "/api/preferences/ignored-diagnostics", 200, []);
    await call("GET", "/api/lexicon/global", 200);
    await call("PUT", "/api/lexicon/global", 200, []);
    await call("GET", "/api/connections", 200);
    const profileMutation = {
      profile: { id: "manifest-profile", name: "Manifest", baseUrl: "http://127.0.0.1:1/v1", defaultModelId: "model", defaultVoiceId: "voice" },
      credential: { action: "keep" }
    };
    await call("POST", "/api/connections", 201, profileMutation);
    await call("PUT", "/api/connections/manifest-profile", 200, { ...profileMutation, profile: { ...profileMutation.profile, name: "Updated manifest" } });
    await call("POST", "/api/connections/manifest-profile/test", 200);
    SpeechCatalogSchema.parse((await call("GET", "/api/connections/manifest-profile/speech-catalog", 200)).body as unknown);
    await call("GET", "/api/connections/manifest-profile/diagnostics", 200);
    await call("GET", "/api/setup", 200);
    await call("PUT", "/api/setup/active-profile", 200, { profileId: "manifest-profile" });
    await call("POST", "/api/setup/complete", 200);
    await call("GET", "/api/voice-catalog?modelId=model", 200);
    covered.delete("GET /api/voice-catalog?modelId=model");
    covered.add("GET /api/voice-catalog");
    await call("PUT", "/api/voice-catalog", 200, { schemaVersion: 1, modelId: "model", entries: [] });
    await call("POST", "/api/scratchpad/preview", 200, {
      connectionProfileId: "manifest-profile", modelId: "model", voiceId: "voice", speed: 1,
      text: "Manifest speech.", applyGlobalLexicon: false
    });
    ProjectPreviewResultSchema.parse((await call("POST", `/api/projects/${created.id}/preview`, 200, {
      mode: "segment", nodeOrdinal: 1
    })).body as unknown);
    await call("POST", "/api/script-generation/prompt-preview", 200, { kind: "creation" });
    await call("POST", "/api/script-generation/prompt-export", 200, { kind: "update" });
    await call("POST", "/api/script-generation/skill-export", 200, {});
    await call("POST", `/api/projects/${created.id}/prompt-preview`, 200, { kind: "creation" });
    await call("POST", `/api/projects/${created.id}/prompt-export`, 200, { kind: "update" });
    await call("POST", `/api/projects/${created.id}/skill-export`, 200, {});
    const renderPlan = RenderPlanSchema.parse((await call("POST", `/api/projects/${created.id}/render-plans`, 201)).body as unknown);
    RenderPlanSummaryCollectionSchema.parse((await call("GET", `/api/projects/${created.id}/render-plans`, 200)).body as unknown);
    RenderPlanSchema.parse((await call("GET", `/api/render-plans/${renderPlan.id}`, 200)).body as unknown);
    const render = (await call("POST", `/api/render-plans/${renderPlan.id}/renders`, 202)).body as { id: string };
    await call("GET", `/api/projects/${created.id}/renders`, 200);
    await call("GET", `/api/renders/${render.id}`, 200);
    await call("POST", `/api/renders/${render.id}/cancel`, 200);
    await call("POST", `/api/renders/${render.id}/retry`, 202);
    const artifacts = (await call("GET", `/api/renders/${render.id}/artifacts`, 200)).body as Array<{ id: string }>;
    await call("GET", `/api/renders/${render.id}/audio`, 200);
    await call("GET", `/api/renders/${render.id}/waveform`, 200);
    await call("GET", `/api/renders/${render.id}/segments`, 200);
    await call("GET", `/api/renders/${render.id}/segments/1/audio`, 200);
    await call("POST", `/api/renders/${render.id}/segments/1/export`, 200);
    await call("GET", `/api/render-artifacts/${artifacts[0]!.id}`, 200);
    SpeechCacheStatusSchema.parse((await call("GET", "/api/speech-cache", 200)).body as unknown);
    SpeechCacheCleanupResultSchema.parse((await call("DELETE", `/api/projects/${created.id}/speech-cache`, 200)).body as unknown);
    SpeechCacheCleanupResultSchema.parse((await call("DELETE", `/api/speech-cache/${"a".repeat(64)}`, 200)).body as unknown);
    SpeechCacheCleanupResultSchema.parse((await call("DELETE", "/api/speech-cache", 200)).body as unknown);
    await call("DELETE", "/api/connections/manifest-profile", 204);
    await call("DELETE", `/api/projects/${created.id}`, 204);

    expect([...covered].sort()).toEqual(REST_API_MANIFEST.map(({ method, path }) => `${method} ${path}`).sort());
  });

  it("rejects malformed path, query, body, policy, conflict, missing, and unavailable cases without credentials", async () => {
    const { app, service } = await fixture();
    const secret = "test-secret-must-not-appear";
    const invalidCases = [
      request(app).post("/api/projects").send({ name: "", password: secret }).expect(400),
      request(app).get("/api/projects/not-a-uuid").expect(400),
      request(app).put("/api/projects/not-a-uuid").send({}).expect(400),
      request(app).post("/api/projects/not-a-uuid/duplicate").send({}).expect(400),
      request(app).delete("/api/projects/not-a-uuid").expect(400),
      request(app).put("/api/settings/pacing").send({ durationMs: -1 }).expect(400),
      request(app).put("/api/preferences/ignored-diagnostics").send({}).expect(400),
      request(app).put("/api/lexicon/global").send({}).expect(400),
      request(app).post("/api/connections").send({ profile: {}, credential: { action: "replace", apiKey: secret } }).expect(400),
      request(app).put("/api/connections/not-found").send({}).expect(400),
      request(app).delete("/api/connections/not-found").expect(404),
      request(app).post("/api/connections/not-found/test").expect(404),
      request(app).get("/api/connections/not-found/diagnostics").expect(404),
      request(app).put("/api/setup/active-profile").send({ profileId: 12 }).expect(400),
      request(app).get("/api/voice-catalog").expect(400),
      request(app).put("/api/voice-catalog").send({ schemaVersion: 1, modelId: "model", entries: [{ voiceId: "same", label: secret, apiKey: secret }] }).expect(400),
      request(app).post("/api/scratchpad/preview").send({ connectionProfileId: "x", text: secret }).expect(400),
      request(app).post("/api/projects/not-a-uuid/preview").send({ mode: "segment", nodeOrdinal: 1 }).expect(400),
      request(app).post("/api/projects/00000000-0000-4000-8000-000000000001/preview").send({ mode: "pronunciation", text: "" }).expect(400),
      request(app).post("/api/script-generation/prompt-preview").send({ kind: "invalid", apiKey: secret }).expect(400),
      request(app).post("/api/script-generation/skill-export").send({ sourceMaterial: secret }).expect(400),
      request(app).post("/api/projects/not-a-uuid/prompt-preview").send({}).expect(400),
      request(app).post("/api/projects/00000000-0000-4000-8000-000000000001/prompt-export").send({ kind: "invalid", sourceMaterial: secret }).expect(400),
      request(app).post("/api/projects/00000000-0000-4000-8000-000000000001/skill-export").send({ sourceMaterial: secret }).expect(400),
      request(app).post("/api/projects/not-a-uuid/render-plans").expect(400),
      request(app).get("/api/projects/not-a-uuid/render-plans").expect(400),
      request(app).get("/api/render-plans/not-a-uuid").expect(400),
      request(app).post("/api/render-plans/not-a-uuid/renders").expect(400),
      request(app).get("/api/projects/not-a-uuid/renders").expect(400),
      request(app).get("/api/renders/not-a-uuid").expect(400),
      request(app).post("/api/renders/not-a-uuid/cancel").expect(400),
      request(app).post("/api/renders/not-a-uuid/retry").expect(400),
      request(app).get("/api/renders/not-a-uuid/artifacts").expect(400),
      request(app).get("/api/renders/not-a-uuid/audio").expect(400),
      request(app).get("/api/renders/not-a-uuid/waveform").expect(400),
      request(app).get("/api/renders/not-a-uuid/segments").expect(400),
      request(app).get("/api/renders/00000000-0000-4000-8000-000000000003/segments/zero/audio").expect(400),
      request(app).post("/api/renders/00000000-0000-4000-8000-000000000003/segments/0/export").expect(400),
      request(app).get("/api/render-artifacts/not-a-uuid").expect(400),
      request(app).delete("/api/projects/not-a-uuid/speech-cache").expect(400),
      request(app).delete("/api/speech-cache/not-a-key").expect(400)
    ];
    const responses = await Promise.all(invalidCases);
    expect(JSON.stringify(responses.map((response) => response.body as unknown))).not.toContain(secret);

    const unavailable = createUnavailablePersistenceService({
      contractVersion: 4, state: "unavailable", databaseSchemaVersion: 2, targetDatabaseSchemaVersion: 6,
      databasePath: "/redacted/data.sqlite", latestBackupPath: null, code: "MIGRATION_FAILED", message: "Unavailable."
    });
    const degraded = await listen(createExpressApp({ service, persistence: unavailable, context }));
    await request(degraded).post("/api/projects").send({ name: "Blocked" }).expect(503);
  });
});
