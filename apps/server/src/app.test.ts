import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSystemService, type DiagnosticsContext } from "@studynarrator/application";
import { createDiagnosticRepository } from "@studynarrator/persistence";
import { HealthSchema, RuntimeSchema, SystemDiagnosticsSchema } from "@studynarrator/shared-types";
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

function fixture() {
  const databasePath = join(mkdtempSync(join(tmpdir(), "studynarrator-server-")), "app.sqlite");
  const service = createSystemService({
    repository: createDiagnosticRepository({ Database, databasePath }),
    ffmpegProbe: { run: async () => ({ status: "pass", executable: "ffmpeg", version: "ffmpeg version test" }) }
  });
  return { service, app: createExpressApp({ service, context }) };
}

describe("Express diagnostics API", () => {
  it("serves side-effect-free health and runtime contracts", async () => {
    const { app, service } = fixture();
    HealthSchema.parse((await request(app).get("/api/health").expect(200)).body);
    RuntimeSchema.parse((await request(app).get("/api/runtime").expect(200)).body);
    service.close();
  });

  it("serves the shared diagnostics contract", async () => {
    const { app, service } = fixture();
    const response = await request(app).get("/api/diagnostics").expect(200);
    const diagnostics = SystemDiagnosticsSchema.parse(response.body);
    expect(diagnostics.client).toBe("web");
    expect(diagnostics.transport).toBe("rest");
    service.close();
  });

  it("sanitizes an invalid boundary result", async () => {
    const service = {
      health: () => ({ status: "ok", applicationVersion: "0.1.0" } as const),
      runtime: () => ({ ...context, schemaVersion: 1, applicationVersion: "0.1.0" } as never),
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
