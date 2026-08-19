import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConnectionService,
  createPersistenceService,
  createScriptGenerationService,
  createSystemService,
  createUnavailablePersistenceService,
  createVoiceCatalogService,
  type DiagnosticsContext,
} from "@studynarrator/application";
import {
  BackupRestoreError,
  openStudyNarratorRepository,
  type DatabaseConstructor,
} from "@studynarrator/persistence";
import {
  BoundaryErrorSchema,
  DEFAULT_SYSTEM_TIMING,
  GlobalLexiconEntryCollectionSchema,
  HealthSchema,
  PersistenceBackupCollectionSchema,
  PersistenceBackupRestoreResultSchema,
  ProjectDetailSchema,
  ProjectPreviewResultSchema,
  ProjectSummaryCollectionSchema,
  RuntimeSchema,
  SpeechCacheCleanupResultSchema,
  SpeechCacheStatusSchema,
  SpeechCatalogSchema,
  SystemDiagnosticsSchema,
} from "@studynarrator/shared-types";
import { attachStaticWebApplication, createExpressApp } from "./app.js";
import { REST_API_MANIFEST } from "./apiManifest.js";

const context: DiagnosticsContext = {
  client: "web",
  distribution: "development-web",
  transport: "rest",
  runtimeName: "node",
  runtimeVersion: "26.7.0",
  electronVersion: null,
  platform: "darwin",
  architecture: "arm64",
  dataDirectory: "/tmp/studynarrator",
  sourceRevision: "test-revision",
};

const openServers = new Set<Server>();
const openServices = new Set<{ close(): void }>();

async function listen(
  app: ReturnType<typeof createExpressApp>,
): Promise<Server> {
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
  await Promise.all(
    [...openServers].map(
      async (server) =>
        await new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) rejectClose(error);
            else resolveClose();
          });
        }),
    ),
  );
  openServers.clear();
  for (const service of openServices) service.close();
  openServices.clear();
});

async function fixture() {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), "studynarrator-server-")),
    "app.sqlite",
  );
  const repository = await openStudyNarratorRepository({
    Database: Database as unknown as DatabaseConstructor,
    databasePath,
  });
  const service = createSystemService({
    repository,
    ffmpegProbe: {
      run: async () => ({
        status: "pass",
        executable: "ffmpeg",
        version: "ffmpeg version test",
      }),
    },
  });
  const persistence = createPersistenceService(repository, {
    backups: {
      list: async () => [],
      restore: async (input) => ({
        restoredFrom: input.backupPath,
        safetyCopyPath:
          "/tmp/backups/pre-restore-2026-08-12T12-00-00-000Z.sqlite",
      }),
    },
  });
  const connection = createConnectionService({
    repository,
    context: { client: "web", nodeVersion: "26.7.0", electronVersion: null },
    diagnose: async () => ({
      normalizedUrl: null,
      summary: {
        schemaVersion: 1,
        overall: "connected",
        testedAt: "2026-08-12T12:00:00.000Z",
        httpStatus: 200,
        stages: [
          "url",
          "dns",
          "tcp",
          "http",
          "authentication",
          "model",
          "voice",
          "audio",
        ].map((stage) => ({
          stage: stage as "url",
          status: "pass" as const,
          code: `${stage}-pass`,
          message: "Passed.",
          durationMs: 1,
        })),
        availableModelIds: ["model"],
        availableVoiceIds: ["voice"],
      },
    }),
    discoverCatalog: async () => ({
      schemaVersion: 1,
      models: [
        {
          modelId: "model",
          voices: [
            { voiceId: "voice", name: "Voice", language: null, gender: null },
          ],
        },
      ],
    }),
  });
  const voiceCatalog = createVoiceCatalogService({
    repository,
    bundledCatalogs: new Map(),
  });
  const scriptGeneration = createScriptGenerationService({ repository });
  const scratchpad = {
    preview: async (input: {
      modelId: string;
      voiceId: string;
      speed: number;
      text: string;
      applyGlobalLexicon: boolean;
    }) => ({
      schemaVersion: 1 as const,
      id: "00000000-0000-4000-8000-000000000099",
      createdAt: "2026-08-12T12:00:00.000Z",
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
        key: "a".repeat(64),
        status: "hit" as const,
        byteLength: 3,
        createdAt: "2026-08-12T12:00:00.000Z",
        lastUsedAt: "2026-08-12T12:00:00.000Z",
      },
      audio: { mimeType: "audio/wav" as const, base64: "AQID", byteLength: 3 },
    }),
  };
  const projectPreview = {
    preview: async (
      requestedProjectId: string,
      input: { mode: "segment" | "pronunciation" },
    ) => ({
      schemaVersion: 1 as const,
      id: "00000000-0000-4000-8000-000000000098",
      createdAt: "2026-08-12T12:00:00.000Z",
      projectId: requestedProjectId,
      mode: input.mode,
      nodeOrdinal: input.mode === "segment" ? 1 : null,
      sourceRange:
        input.mode === "segment"
          ? { start: { line: 1, column: 1 }, end: { line: 1, column: 17 } }
          : null,
      modelId: "model",
      speakerId: "narrator" as const,
      voiceId: "voice",
      voiceLabel: "Voice",
      speed: 1,
      originalText: "Manifest speech.",
      readableText: "Manifest speech.",
      transformedText: "Manifest speech.",
      cache: {
        key: "a".repeat(64),
        status: "hit" as const,
        byteLength: 3,
        createdAt: "2026-08-12T12:00:00.000Z",
        lastUsedAt: "2026-08-12T12:00:00.000Z",
      },
      audio: { mimeType: "audio/wav" as const, base64: "AQID", byteLength: 3 },
    }),
  };
  const speechCache = {
    status: async () => ({
      contractVersion: 1 as const,
      entryCount: 1,
      totalBytes: 3,
      lastUsedAt: "2026-08-12T12:00:00.000Z",
      sessionHits: 1,
      sessionMisses: 0,
      sessionWrites: 0,
      sessionCorruptMisses: 0,
      inFlight: 0,
    }),
    clearAll: async () => ({
      contractVersion: 1 as const,
      entriesRemoved: 1,
      bytesFreed: 3,
    }),
    clearProject: async (_projectId: string) => ({
      contractVersion: 1 as const,
      entriesRemoved: 1,
      bytesFreed: 3,
    }),
    clearEntry: async (_cacheKey: string) => ({
      contractVersion: 1 as const,
      entriesRemoved: 1,
      bytesFreed: 3,
    }),
  };
  const renderPlanId = "00000000-0000-4000-8000-000000000002";
  const renderFixture = {
    projectId: "00000000-0000-4000-8000-000000000001",
    planId: renderPlanId,
    createdAt: "2026-08-12T12:00:00.000Z",
  };
  const renderId = "00000000-0000-4000-8000-000000000003";
  const artifactId = "00000000-0000-4000-8000-000000000004";
  const renderJob = () => ({
    contractVersion: 1 as const,
    id: renderId,
    projectId: renderFixture.projectId,
    planId: renderFixture.planId,
    retryOfRenderId: null,
    state: "complete" as const,
    progress: {
      phase: "complete" as const,
      sectionTitle: null,
      sectionOrdinal: 0,
      sectionCount: 0,
      entryOrdinal: null,
      speechOrdinal: 0,
      speechCount: 0,
      chunkOrdinal: null,
      completedChunks: 0,
      totalChunks: 0,
      cacheHits: 0,
      cacheMisses: 0,
      ttsRequests: 0,
      speakerId: null,
      voiceId: null,
      excerpt: null,
      elapsedMs: 1,
    },
    error: null,
    createdAt: renderFixture.createdAt,
    startedAt: renderFixture.createdAt,
    finishedAt: renderFixture.createdAt,
  });
  const artifact = {
    contractVersion: 1 as const,
    id: artifactId,
    renderId,
    type: "manifest" as const,
    fileName: "package.json",
    sizeBytes: 1,
    checksum: "d".repeat(64),
    durationMs: null,
    createdAt: renderFixture.createdAt,
  };
  const renders = {
    startProject: async () => renderJob(),
    list: async () => [renderJob()],
    get: async () => renderJob(),
    cancel: async () => renderJob(),
    retry: async () => renderJob(),
    listArtifacts: async () => [artifact],
    exportArtifact: async () => ({
      disposition: "download" as const,
      fileName: artifact.fileName,
    }),
    resolveArtifact: async () => ({
      artifact,
      path: join(import.meta.dirname, "../../../package.json"),
    }),
    resolveRenderAudio: async () => ({
      path: join(import.meta.dirname, "../../../package.json"),
      fileName: "fixture.mp3",
      mimeType: "audio/mpeg" as const,
      sizeBytes: 1,
    }),
    resolveDetailsArchive: async () => ({
      bytes: Uint8Array.from([1]),
      fileName: "fixture-render-details.zip",
      mimeType: "application/zip" as const,
    }),
    resolveSegmentAudio: async () => ({
      path: join(import.meta.dirname, "../../../package.json"),
      fileName: "000001.wav",
      mimeType: "audio/wav" as const,
      sizeBytes: 1,
    }),
    listSegments: async () => [],
    getWaveform: async () => ({
      status: "unavailable" as const,
      renderId,
      reason: "audioMissing" as const,
    }),
    exportSegment: async () => ({
      disposition: "download" as const,
      fileName: "000001.wav",
    }),
    close: async () => undefined,
  };
  openServices.add(service);
  return {
    service,
    persistence,
    connection,
    voiceCatalog,
    scratchpad,
    projectPreview,
    speechCache,
    renders,
    scriptGeneration,
    app: await listen(
      createExpressApp({
        service,
        persistence,
        connection,
        voiceCatalog,
        scratchpad,
        projectPreview,
        speechCache,
        renders,
        scriptGeneration,
        context,
      }),
    ),
  };
}

describe("Express diagnostics API", () => {
  it("serves side-effect-free health and runtime contracts", async () => {
    const { app } = await fixture();
    HealthSchema.parse(
      (await request(app).get("/api/health").expect(200)).body,
    );
    RuntimeSchema.parse(
      (await request(app).get("/api/runtime").expect(200)).body,
    );
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
      health: () => ({ status: "ok", applicationVersion: "0.1.0" }) as const,
      runtime: () =>
        ({
          ...context,
          schemaVersion: 1,
          applicationVersion: "0.1.0",
        }) as never,
      diagnostics: async () => ({ secret: "must-not-leak" }) as never,
      close: () => undefined,
    };
    const response = await request(
      await listen(createExpressApp({ service, context })),
    )
      .get("/api/diagnostics")
      .expect(500);
    expect(response.body).toEqual({
      error: {
        code: "DIAGNOSTICS_BOUNDARY_ERROR",
        message: "StudyNarrator could not validate the diagnostics response.",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("must-not-leak");
  });
});

describe("production Web application", () => {
  it("serves assets and SPA routes without turning unknown API routes into HTML", async () => {
    const { service } = await fixture();
    const distributionDirectory = mkdtempSync(
      join(tmpdir(), "studynarrator-web-dist-"),
    );
    writeFileSync(
      join(distributionDirectory, "index.html"),
      "<!doctype html><title>StudyNarrator production</title>",
    );
    writeFileSync(
      join(distributionDirectory, "application.js"),
      "export const ready = true;",
    );
    const application = createExpressApp({ service, context });
    attachStaticWebApplication(application, distributionDirectory);
    const server = await listen(application);

    const entry = await request(server).get("/projects/example").expect(200);
    expect(entry.text).toContain("StudyNarrator production");
    expect(entry.headers["cache-control"]).toBe("no-cache");
    expect(
      (await request(server).get("/application.js").expect(200)).headers[
        "cache-control"
      ],
    ).toBe("public, max-age=31536000, immutable");
    await request(server).get("/api/not-a-route").expect(404);
  });
});

describe("Express Scratchpad cancellation", () => {
  it("aborts privileged synthesis when the REST client disconnects", async () => {
    const { service } = await fixture();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted;
    });
    let markAborted: (() => void) | undefined;
    const aborted = new Promise<void>((resolveAborted) => {
      markAborted = resolveAborted;
    });
    const scratchpad = {
      preview: async (_input: unknown, signal?: AbortSignal) =>
        await new Promise<never>((_resolve, reject) => {
          markStarted?.();
          signal?.addEventListener(
            "abort",
            () => {
              markAborted?.();
              reject(
                Object.assign(new Error("cancelled"), {
                  code: "SCRATCHPAD_ABORTED",
                }),
              );
            },
            { once: true },
          );
        }),
    };
    const app = await listen(
      createExpressApp({ service, scratchpad, context }),
    );
    const address = app.address();
    if (!address || typeof address === "string")
      throw new Error("Expected a loopback address.");
    const controller = new AbortController();
    const pending = fetch(
      `http://127.0.0.1:${String(address.port)}/api/scratchpad/preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelId: "model",
          voiceId: "voice",
          speed: 1,
          text: "Speech.",
          applyGlobalLexicon: false,
        }),
        signal: controller.signal,
      },
    );
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(aborted).resolves.toBeUndefined();
  });
});

describe("Express persistence API", () => {
  it("creates, replaces, reads, lists, and deletes complete project aggregates", async () => {
    const { app } = await fixture();
    const created = ProjectDetailSchema.parse(
      (
        await request(app)
          .post("/api/projects")
          .send({ name: "REST study" })
          .expect(201)
      ).body as unknown,
    );
    expect(created).toMatchObject({ name: "REST study" });
    expect(created).not.toHaveProperty("transitionPauses");

    const source = "Résumé\r\n\r\nSQL 🧠";
    const replaced = ProjectDetailSchema.parse(
      (
        await request(app)
          .put(`/api/projects/${created.id}`)
          .send({
            name: "REST study",
            description: "Restart-safe",
            scriptSource: source,
            speakerMappings: [],
            lexiconEntries: [
              {
                scope: "project",
                entryType: "exactTerm",
                displayText: "SQL",
                spokenText: "sequel",
              },
            ],
          })
          .expect(200)
      ).body as unknown,
    );
    expect(replaced.scriptSource).toBe(source);
    expect(replaced.scriptHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      ProjectDetailSchema.parse(
        (await request(app).get(`/api/projects/${created.id}`).expect(200))
          .body as unknown,
      ),
    ).toEqual(replaced);
    expect(
      ProjectSummaryCollectionSchema.parse(
        (await request(app).get("/api/projects").expect(200)).body as unknown,
      ),
    ).toHaveLength(1);
    const duplicate = ProjectDetailSchema.parse(
      (
        await request(app)
          .post(`/api/projects/${created.id}/duplicate`)
          .send({ name: "REST study copy" })
          .expect(201)
      ).body as unknown,
    );
    expect(duplicate).toMatchObject({
      name: "REST study copy",
      scriptSource: source,
    });
    expect(duplicate.id).not.toBe(created.id);
    expect(duplicate.lexiconEntries[0]?.id).not.toBe(
      replaced.lexiconEntries[0]?.id,
    );
    await request(app).delete(`/api/projects/${created.id}`).expect(204);
    await request(app).get(`/api/projects/${created.id}`).expect(404);
  });

  it("returns path-specific validation errors and sanitized conflicts", async () => {
    const { app } = await fixture();
    const invalidResponse = await request(app)
      .post("/api/projects")
      .send({ name: "", password: "must-not-leak" })
      .expect(400);
    const invalid = BoundaryErrorSchema.parse(invalidResponse.body as unknown);
    expect(invalid.error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(
      invalid.error.issues?.some(
        (issue) => issue.path.startsWith("$.") && issue.message.length > 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(invalid)).not.toContain("must-not-leak");

    await request(app)
      .put("/api/connection")
      .send({
        baseUrl: "javascript:unsafe",
        defaultModelId: null,
        defaultVoiceId: null,
      })
      .expect(400);
  });

  it("keeps diagnostics status available while degraded writes return 503", async () => {
    const { service } = await fixture();
    const persistence = createUnavailablePersistenceService({
      contractVersion: 1,
      state: "unavailable",
      databaseSchemaVersion: 4,
      targetDatabaseSchemaVersion: 4,
      databasePath: "/tmp/studynarrator.sqlite",
      latestBackupPath: "/tmp/backups/recovery.sqlite",
      code: "MIGRATION_FAILED",
      message: "Migration failed; restore the recovery backup.",
      availableBackups: [],
    });
    const app = await listen(
      createExpressApp({ service, persistence, context }),
    );
    await request(app).get("/api/persistence/status").expect(200);
    const response = BoundaryErrorSchema.parse(
      (
        await request(app)
          .post("/api/projects")
          .send({ name: "Unavailable" })
          .expect(503)
      ).body as unknown,
    );
    expect(response).toEqual({
      error: {
        code: "PERSISTENCE_UNAVAILABLE",
        message:
          "Persistence is unavailable until the database migration is repaired.",
      },
    });

    const catalogResponse = BoundaryErrorSchema.parse(
      (
        await request(app)
          .post("/api/connection/speech-catalog")
          .send({ baseUrl: "http://127.0.0.1:8000" })
          .expect(503)
      ).body as unknown,
    );
    expect(catalogResponse).toEqual({
      error: {
        code: "PERSISTENCE_UNAVAILABLE",
        message:
          "Persistence is unavailable until the database migration is repaired.",
      },
    });
  });

  it("returns a specific 422 when a selected backup cannot be restored", async () => {
    const { service } = await fixture();
    const backupPath =
      "/tmp/backups/studynarrator-v3-to-v3-2026-08-12T12-00-00-000Z.sqlite";
    const persistence = createUnavailablePersistenceService(
      {
        contractVersion: 1,
        state: "unavailable",
        databaseSchemaVersion: 99,
        targetDatabaseSchemaVersion: 3,
        databasePath: "/tmp/studynarrator.sqlite",
        latestBackupPath: backupPath,
        code: "SCHEMA_TOO_NEW",
        message: "This data was created by a newer version.",
        availableBackups: [
          {
            path: backupPath,
            fromVersion: 3,
            createdAt: "2026-08-12T12:00:00.000Z",
            sizeBytes: 4096,
            kind: "migration",
          },
        ],
      },
      {
        backups: {
          list: async () => [],
          restore: () => {
            throw new BackupRestoreError(
              "The selected backup could not be verified and was not restored.",
            );
          },
        },
      },
    );
    const app = await listen(
      createExpressApp({ service, persistence, context }),
    );
    const response = BoundaryErrorSchema.parse(
      (
        await request(app)
          .post("/api/persistence/backups/restore")
          .send({ backupPath })
          .expect(422)
      ).body as unknown,
    );
    expect(response).toEqual({
      error: {
        code: "BACKUP_RESTORE_FAILED",
        message:
          "The selected backup could not be verified and was not restored.",
      },
    });
  });
});

describe("Express connection API", () => {
  it("uses singular managed connection routes and rejects credential-shaped input", async () => {
    const { app } = await fixture();
    const secret = "test-secret-must-not-appear";
    const rejected = BoundaryErrorSchema.parse(
      (
        await request(app)
          .put("/api/connection")
          .send({
            baseUrl: "http://127.0.0.1:8000",
            defaultModelId: "model",
            defaultVoiceId: "voice",
            apiKey: secret,
          })
          .expect(400)
      ).body as unknown,
    );
    expect(rejected.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(rejected)).not.toContain(secret);
    await request(app)
      .put("/api/connection")
      .send({
        baseUrl: "http://127.0.0.1:8000/v1",
        defaultModelId: "model",
        defaultVoiceId: "voice",
      })
      .expect(200);
    const connection = await request(app).get("/api/connection").expect(200);
    expect(connection.body).toEqual(
      expect.objectContaining({
        baseUrl: "http://127.0.0.1:8000",
        configured: true,
      }),
    );
    expect(connection.body).not.toHaveProperty("id");
    await request(app).get("/api/connections").expect(404);
  });
});

describe("Express render review media", () => {
  it("supports full, HEAD, and single-range playback without exposing a path", async () => {
    const { app } = await fixture();
    const renderId = "00000000-0000-4000-8000-000000000003";
    const full = await request(app)
      .get(`/api/renders/${renderId}/audio`)
      .expect(200);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["content-type"]).toMatch(/^audio\/mpeg/u);
    expect(JSON.stringify(full.headers)).not.toContain(import.meta.dirname);
    await request(app)
      .head(`/api/renders/${renderId}/audio`)
      .expect(200)
      .expect("content-length", "1");
    await request(app)
      .get(`/api/renders/${renderId}/segments/1/audio`)
      .set("range", "bytes=0-0")
      .expect(206)
      .expect("content-range", "bytes 0-0/1")
      .expect("content-length", "1");
    await request(app)
      .get(`/api/renders/${renderId}/audio`)
      .set("range", "bytes=2-3")
      .expect(416)
      .expect("content-range", "bytes */1");
    await request(app)
      .post(`/api/renders/${renderId}/segments/1/export`)
      .expect(200)
      .expect("content-disposition", 'attachment; filename="000001.wav"');
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
    const {
      service,
      persistence,
      connection,
      voiceCatalog,
      scratchpad,
      projectPreview,
      speechCache,
      renders,
      scriptGeneration,
    } = await fixture();
    const application = createExpressApp({
      service,
      persistence,
      connection,
      voiceCatalog,
      scratchpad,
      projectPreview,
      speechCache,
      renders,
      scriptGeneration,
      context,
    });
    const layers = (
      application as unknown as { router: { stack: ExpressRouteLayer[] } }
    ).router.stack;
    const registered = layers.flatMap((layer) =>
      layer.route
        ? Object.entries(layer.route.methods)
            .filter(([, enabled]) => enabled)
            .map(([method]) => `${method.toUpperCase()} ${layer.route!.path}`)
        : [],
    );
    const declared = REST_API_MANIFEST.map(
      ({ method, path }) => `${method} ${path}`,
    );
    expect(registered.sort()).toEqual([...declared].sort());
    expect(new Set(declared).size).toBe(53);
  });

  it("exercises a successful schema-valid response for all 53 operations", async () => {
    const { app } = await fixture();
    const covered = new Set<string>();
    const call = async (
      method: string,
      path: string,
      expected: number,
      body?: string | object,
    ) => {
      covered.add(
        `${method} ${path
          .replace(
            /^\/api\/render-artifacts\/[0-9a-f-]{36}$/u,
            "/api/render-artifacts/:artifactId",
          )
          .replace(
            /^\/api\/renders\/[0-9a-f-]{36}(?=\/|$)/u,
            "/api/renders/:renderId",
          )
          .replace(/\/segments\/\d+(?=\/|$)/u, "/segments/:ordinal")
          .replace(/\/[0-9a-f-]{36}(?=\/|$)/gu, "/:projectId")
          .replace(/\/[a-f0-9]{64}(?=\/|$)/gu, "/:cacheKey")}`,
      );
      const agent = request(app)[method.toLowerCase() as "get"](path);
      if (body !== undefined) agent.send(body);
      return await agent.expect(expected);
    };

    await call("GET", "/api/health", 200);
    await call("GET", "/api/runtime", 200);
    SystemDiagnosticsSchema.parse(
      (await call("GET", "/api/diagnostics", 200)).body as unknown,
    );
    await call("GET", "/api/persistence/status", 200);
    PersistenceBackupCollectionSchema.parse(
      (await call("GET", "/api/persistence/backups", 200)).body as unknown,
    );
    PersistenceBackupRestoreResultSchema.parse(
      (
        await call("POST", "/api/persistence/backups/restore", 201, {
          backupPath:
            "/tmp/backups/studynarrator-v0003-to-v0004-2026-08-12T12-00-00-000Z.sqlite",
        })
      ).body as unknown,
    );
    ProjectSummaryCollectionSchema.parse(
      (await call("GET", "/api/projects", 200)).body as unknown,
    );
    const created = ProjectDetailSchema.parse(
      (await call("POST", "/api/projects", 201, { name: "Manifest project" }))
        .body as unknown,
    );
    ProjectDetailSchema.parse(
      (await call("GET", `/api/projects/${created.id}`, 200)).body as unknown,
    );
    const replacement = {
      name: created.name,
      description: "manifest",
      scriptSource: "Manifest source",
      speakerMappings: [],
      lexiconEntries: [],
    };
    ProjectDetailSchema.parse(
      (await call("PUT", `/api/projects/${created.id}`, 200, replacement))
        .body as unknown,
    );
    ProjectDetailSchema.parse(
      (
        await call("POST", `/api/projects/${created.id}/duplicate`, 201, {
          name: "Manifest copy",
        })
      ).body as unknown,
    );
    await call("GET", "/api/settings/pacing", 200);
    await call("PUT", "/api/settings/pacing", 200, DEFAULT_SYSTEM_TIMING);
    await call("GET", "/api/preferences/ignored-diagnostics", 200);
    await call("PUT", "/api/preferences/ignored-diagnostics", 200, []);
    GlobalLexiconEntryCollectionSchema.parse(
      (await call("GET", "/api/lexicon/global", 200)).body as unknown,
    );
    const globalLexicon = GlobalLexiconEntryCollectionSchema.parse(
      (
        await call("PUT", "/api/lexicon/global", 200, [
          {
            scope: "global",
            entryType: "namedSense",
            displayText: "resume",
            senseId: "cv",
            spokenText: "rez oo may",
          },
        ])
      ).body as unknown,
    );
    expect(globalLexicon).toMatchObject([
      {
        scope: "global",
        entryType: "namedSense",
        displayText: "resume",
        senseId: "cv",
        spokenText: "rez oo may",
      },
    ]);
    await call("GET", "/api/connection", 200);
    await call("PUT", "/api/connection", 200, {
      baseUrl: "http://127.0.0.1:1/v1",
      defaultModelId: "model",
      defaultVoiceId: "voice",
    });
    SpeechCatalogSchema.parse(
      (
        await call("POST", "/api/connection/speech-catalog", 200, {
          baseUrl: "http://127.0.0.1:1/v1",
        })
      ).body as unknown,
    );
    await call("POST", "/api/connection/test", 200);
    await call("GET", "/api/connection/diagnostics", 200);
    await call("GET", "/api/setup", 200);
    await call("POST", "/api/setup/complete", 200);
    await call("GET", "/api/voice-catalog?modelId=model", 200);
    covered.delete("GET /api/voice-catalog?modelId=model");
    covered.add("GET /api/voice-catalog");
    await call("PUT", "/api/voice-catalog", 200, {
      schemaVersion: 1,
      modelId: "model",
      entries: [],
    });
    await call("POST", "/api/scratchpad/preview", 200, {
      modelId: "model",
      voiceId: "voice",
      speed: 1,
      text: "Manifest speech.",
      applyGlobalLexicon: false,
    });
    ProjectPreviewResultSchema.parse(
      (
        await call("POST", `/api/projects/${created.id}/preview`, 200, {
          mode: "segment",
          nodeOrdinal: 1,
        })
      ).body as unknown,
    );
    await call("POST", "/api/script-generation/prompt-preview", 200, {
      kind: "creation",
    });
    expect(
      (
        await call("POST", "/api/script-generation/prompt-export", 200, {
          kind: "update",
          content: "Edited default prompt",
        })
      ).text,
    ).toBe("Edited default prompt");
    await call("POST", "/api/script-generation/skill-export", 200, {});
    await call("POST", `/api/projects/${created.id}/prompt-preview`, 200, {
      kind: "creation",
    });
    expect(
      (
        await call("POST", `/api/projects/${created.id}/prompt-export`, 200, {
          kind: "update",
          content: "Edited project prompt",
        })
      ).text,
    ).toBe("Edited project prompt");
    await call("POST", `/api/projects/${created.id}/skill-export`, 200, {});
    const render = (
      await call("POST", `/api/projects/${created.id}/renders`, 202)
    ).body as { id: string };
    await call("GET", `/api/projects/${created.id}/renders`, 200);
    await call("GET", `/api/renders/${render.id}`, 200);
    await call("POST", `/api/renders/${render.id}/cancel`, 200);
    await call("POST", `/api/renders/${render.id}/retry`, 202);
    const artifacts = (
      await call("GET", `/api/renders/${render.id}/artifacts`, 200)
    ).body as Array<{ id: string }>;
    await call("GET", `/api/renders/${render.id}/audio`, 200);
    await call("GET", `/api/renders/${render.id}/download`, 200);
    await call("GET", `/api/renders/${render.id}/details`, 200);
    await call("GET", `/api/renders/${render.id}/waveform`, 200);
    await call("GET", `/api/renders/${render.id}/segments`, 200);
    await call("GET", `/api/renders/${render.id}/segments/1/audio`, 200);
    await call("POST", `/api/renders/${render.id}/segments/1/export`, 200);
    await call("GET", `/api/render-artifacts/${artifacts[0]!.id}`, 200);
    SpeechCacheStatusSchema.parse(
      (await call("GET", "/api/speech-cache", 200)).body as unknown,
    );
    SpeechCacheCleanupResultSchema.parse(
      (await call("DELETE", `/api/projects/${created.id}/speech-cache`, 200))
        .body as unknown,
    );
    SpeechCacheCleanupResultSchema.parse(
      (await call("DELETE", `/api/speech-cache/${"a".repeat(64)}`, 200))
        .body as unknown,
    );
    SpeechCacheCleanupResultSchema.parse(
      (await call("DELETE", "/api/speech-cache", 200)).body as unknown,
    );
    await call("DELETE", `/api/projects/${created.id}`, 204);

    expect([...covered].sort()).toEqual(
      REST_API_MANIFEST.map(({ method, path }) => `${method} ${path}`).sort(),
    );
  });

  it("rejects malformed path, query, body, policy, conflict, missing, and unavailable cases without credentials", async () => {
    const { app, service } = await fixture();
    const secret = "test-secret-must-not-appear";
    const invalidCases = [
      request(app)
        .post("/api/projects")
        .send({ name: "", password: secret })
        .expect(400),
      request(app).get("/api/projects/not-a-uuid").expect(400),
      request(app).put("/api/projects/not-a-uuid").send({}).expect(400),
      request(app)
        .post("/api/projects/not-a-uuid/duplicate")
        .send({})
        .expect(400),
      request(app).delete("/api/projects/not-a-uuid").expect(400),
      request(app)
        .put("/api/settings/pacing")
        .send({ durationMs: -1 })
        .expect(400),
      request(app)
        .put("/api/preferences/ignored-diagnostics")
        .send({})
        .expect(400),
      request(app).put("/api/lexicon/global").send({}).expect(400),
      request(app)
        .put("/api/connection")
        .send({ baseUrl: "http://127.0.0.1:8000", apiKey: secret })
        .expect(400),
      request(app)
        .post("/api/connection/speech-catalog")
        .send({ baseUrl: "file:///tmp/private" })
        .expect(400),
      request(app).get("/api/voice-catalog").expect(400),
      request(app)
        .put("/api/voice-catalog")
        .send({
          schemaVersion: 1,
          modelId: "model",
          entries: [{ voiceId: "same", label: secret, apiKey: secret }],
        })
        .expect(400),
      request(app)
        .post("/api/scratchpad/preview")
        .send({ text: secret })
        .expect(400),
      request(app)
        .post("/api/projects/not-a-uuid/preview")
        .send({ mode: "segment", nodeOrdinal: 1 })
        .expect(400),
      request(app)
        .post("/api/projects/00000000-0000-4000-8000-000000000001/preview")
        .send({ mode: "pronunciation", text: "" })
        .expect(400),
      request(app)
        .post("/api/script-generation/prompt-preview")
        .send({ kind: "invalid", apiKey: secret })
        .expect(400),
      request(app)
        .post("/api/script-generation/skill-export")
        .send({ sourceMaterial: secret })
        .expect(400),
      request(app)
        .post("/api/projects/not-a-uuid/prompt-preview")
        .send({})
        .expect(400),
      request(app)
        .post(
          "/api/projects/00000000-0000-4000-8000-000000000001/prompt-export",
        )
        .send({ kind: "invalid", sourceMaterial: secret })
        .expect(400),
      request(app)
        .post("/api/projects/00000000-0000-4000-8000-000000000001/skill-export")
        .send({ sourceMaterial: secret })
        .expect(400),
      request(app).get("/api/projects/not-a-uuid/renders").expect(400),
      request(app).get("/api/renders/not-a-uuid").expect(400),
      request(app).post("/api/renders/not-a-uuid/cancel").expect(400),
      request(app).post("/api/renders/not-a-uuid/retry").expect(400),
      request(app).get("/api/renders/not-a-uuid/artifacts").expect(400),
      request(app).get("/api/renders/not-a-uuid/audio").expect(400),
      request(app).get("/api/renders/not-a-uuid/waveform").expect(400),
      request(app).get("/api/renders/not-a-uuid/segments").expect(400),
      request(app)
        .get(
          "/api/renders/00000000-0000-4000-8000-000000000003/segments/zero/audio",
        )
        .expect(400),
      request(app)
        .post(
          "/api/renders/00000000-0000-4000-8000-000000000003/segments/0/export",
        )
        .expect(400),
      request(app).get("/api/render-artifacts/not-a-uuid").expect(400),
      request(app).delete("/api/projects/not-a-uuid/speech-cache").expect(400),
      request(app).delete("/api/speech-cache/not-a-key").expect(400),
    ];
    const responses = await Promise.all(invalidCases);
    expect(
      JSON.stringify(responses.map((response) => response.body as unknown)),
    ).not.toContain(secret);

    const unavailable = createUnavailablePersistenceService({
      contractVersion: 1,
      state: "unavailable",
      databaseSchemaVersion: 1,
      targetDatabaseSchemaVersion: 3,
      databasePath: "/redacted/data.sqlite",
      latestBackupPath: null,
      code: "MIGRATION_FAILED",
      message: "Unavailable.",
      availableBackups: [],
    });
    const degraded = await listen(
      createExpressApp({ service, persistence: unavailable, context }),
    );
    await request(degraded)
      .post("/api/projects")
      .send({ name: "Blocked" })
      .expect(503);
  });
});
