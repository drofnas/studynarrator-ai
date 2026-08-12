import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createPersistenceService, createSystemService, createUnavailablePersistenceService, type DiagnosticsContext } from "@studynarrator/application";
import { openStudyNarratorRepository, type DatabaseConstructor } from "@studynarrator/persistence";
import { BoundaryErrorSchema, HealthSchema, ProjectDetailSchema, ProjectSummaryCollectionSchema, RuntimeSchema, SystemDiagnosticsSchema } from "@studynarrator/shared-types";
import { createExpressApp } from "./app.js";

const context: DiagnosticsContext = {
  client: "web",
  transport: "rest",
  runtimeName: "node",
  runtimeVersion: "26.7.0",
  electronVersion: null,
  platform: "darwin",
  architecture: "arm64",
  dataDirectory: "/tmp/g01"
};

async function fixture() {
  const databasePath = join(mkdtempSync(join(tmpdir(), "studynarrator-server-")), "app.sqlite");
  const repository = await openStudyNarratorRepository({ Database: Database as unknown as DatabaseConstructor, databasePath });
  const service = createSystemService({
    repository,
    ffmpegProbe: { run: async () => ({ status: "pass", executable: "ffmpeg", version: "ffmpeg version test" }) }
  });
  const persistence = createPersistenceService(repository);
  return { service, persistence, app: createExpressApp({ service, persistence, context }) };
}

describe("Express diagnostics API", () => {
  it("serves side-effect-free health and runtime contracts", async () => {
    const { app, service } = await fixture();
    HealthSchema.parse((await request(app).get("/api/health").expect(200)).body);
    RuntimeSchema.parse((await request(app).get("/api/runtime").expect(200)).body);
    service.close();
  });

  it("serves the shared diagnostics contract", async () => {
    const { app, service } = await fixture();
    const response = await request(app).get("/api/diagnostics").expect(200);
    const diagnostics = SystemDiagnosticsSchema.parse(response.body);
    expect(diagnostics.client).toBe("web");
    expect(diagnostics.transport).toBe("rest");
    service.close();
  });

  it("sanitizes an invalid boundary result", async () => {
    const service = {
      health: () => ({ status: "ok", applicationVersion: "0.1.0" } as const),
      runtime: () => ({ ...context, schemaVersion: 2, applicationVersion: "0.1.0" } as never),
      diagnostics: async () => ({ secret: "must-not-leak" } as never),
      close: () => undefined
    };
    const response = await request(createExpressApp({ service, context })).get("/api/diagnostics").expect(500);
    expect(response.body).toEqual({
      error: {
        code: "DIAGNOSTICS_BOUNDARY_ERROR",
        message: "StudyNarrator could not validate the diagnostics response."
      }
    });
    expect(JSON.stringify(response.body)).not.toContain("must-not-leak");
  });
});

describe("Express persistence API", () => {
  it("creates, replaces, reads, lists, and deletes complete project aggregates", async () => {
    const { app, service } = await fixture();
    const created = ProjectDetailSchema.parse((await request(app).post("/api/projects").send({ name: "REST study" }).expect(201)).body as unknown);
    expect(created).toMatchObject({ name: "REST study", paragraphPause: { pauseId: "pause_medium", durationMs: 750 } });

    const source = "Résumé\r\n\r\nSQL 🧠";
    const replaced = ProjectDetailSchema.parse((await request(app).put(`/api/projects/${created.id}`).send({
      name: "REST study",
      description: "Restart-safe",
      scriptSource: source,
      connectionProfileId: null,
      speakerMappings: [],
      pausePresets: created.pausePresets,
      paragraphPause: created.paragraphPause,
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
    service.close();
  });

  it("returns path-specific validation errors and sanitized conflicts", async () => {
    const { app, service } = await fixture();
    const invalidResponse = await request(app).post("/api/projects").send({ name: "", password: "must-not-leak" }).expect(400);
    const invalid = BoundaryErrorSchema.parse(invalidResponse.body as unknown);
    expect(invalid.error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(invalid.error.issues?.some((issue) => issue.path.startsWith("$.") && issue.message.length > 0)).toBe(true);
    expect(JSON.stringify(invalid)).not.toContain("must-not-leak");

    const profile = { id: "safe-profile", name: "Local placeholder", baseUrl: "http://127.0.0.1:8000", defaultModelId: null, defaultVoiceId: null };
    await request(app).post("/api/connection-profiles").send(profile).expect(201);
    const conflict = BoundaryErrorSchema.parse((await request(app).post("/api/connection-profiles").send(profile).expect(409)).body as unknown);
    expect(conflict).toEqual({ error: { code: "CONFLICT", message: "The persistence operation conflicts with existing data." } });
    service.close();
  });

  it("keeps diagnostics status available while degraded writes return 503", async () => {
    const { service } = await fixture();
    const persistence = createUnavailablePersistenceService({
      contractVersion: 2,
      state: "unavailable",
      databaseSchemaVersion: 1,
      targetDatabaseSchemaVersion: 2,
      databasePath: "/tmp/studynarrator.sqlite",
      latestBackupPath: "/tmp/backups/recovery.sqlite",
      code: "MIGRATION_FAILED",
      message: "Migration failed; restore the recovery backup."
    });
    const app = createExpressApp({ service, persistence, context });
    await request(app).get("/api/persistence/status").expect(200);
    const response = BoundaryErrorSchema.parse((await request(app).post("/api/projects").send({ name: "Unavailable" }).expect(503)).body as unknown);
    expect(response).toEqual({ error: { code: "PERSISTENCE_UNAVAILABLE", message: "Persistence is unavailable until the database migration is repaired." } });
    service.close();
  });
});
