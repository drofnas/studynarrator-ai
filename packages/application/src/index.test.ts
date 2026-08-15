import { describe, expect, it, vi } from "vitest";
import { APPLICATION_SERVICE_MANIFEST, createSystemService, type DiagnosticsContext } from "./index.js";

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
  sourceRevision: "test-revision"
};

const storagePass = {
  status: "pass",
  driver: "better-sqlite3",
  sqliteVersion: "3.50.0",
  migrationVersion: 12,
  databasePath: "/tmp/studynarrator/studynarrator.sqlite",
  latestBackupPath: null,
  markerKey: "runtime.storage-self-test",
  markerValue: "study-narrator-storage-ok",
  createdAt: "2026-08-11T12:00:00.000Z"
} as const;

describe("createSystemService", () => {
  it("returns matching health, runtime, and all-pass diagnostics", async () => {
    const close = vi.fn();
    const service = createSystemService({
      repository: { runMarker: () => storagePass, close },
      ffmpegProbe: { run: async () => ({ status: "pass", executable: "ffmpeg", version: "ffmpeg 8" }) }
    });
    expect(Object.keys(service).map((key) => `system.${key}`).sort()).toEqual(
      APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("system.")).sort()
    );

    expect(service.health()).toEqual({ status: "ok", applicationVersion: "0.1.0" });
    expect(service.runtime(context).runtimeName).toBe("node");
    await expect(service.diagnostics(context)).resolves.toMatchObject({
      overall: "pass",
      client: "web",
      transport: "rest",
      runtime: { distribution: "development-web", sourceRevision: "test-revision" },
      checks: { storage: { status: "pass" }, ffmpeg: { status: "pass" } }
    });
    service.close();
    expect(close).toHaveBeenCalledOnce();
    expect(APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("system."))).toEqual([
      "system.health", "system.runtime", "system.diagnostics", "system.close"
    ]);
  });

  it("maps a thrown storage error to a stable failure", async () => {
    const service = createSystemService({
      repository: { runMarker: () => { throw new Error("private database detail"); }, close: vi.fn() },
      ffmpegProbe: { run: async () => ({ status: "pass", executable: "ffmpeg", version: "ffmpeg 8" }) }
    });

    const result = await service.diagnostics(context);
    expect(result.overall).toBe("fail");
    expect(result.checks.storage).toEqual({
      status: "fail",
      code: "STORAGE_UNAVAILABLE",
      message: "StudyNarrator could not write and read its diagnostic database."
    });
    expect(JSON.stringify(result)).not.toContain("private database detail");
  });

  it("preserves FFmpeg failure and mixed-check failure", async () => {
    const service = createSystemService({
      repository: { runMarker: () => storagePass, close: vi.fn() },
      ffmpegProbe: {
        run: async () => ({
          status: "fail",
          executable: "/missing/ffmpeg",
          code: "FFMPEG_NOT_FOUND",
          message: "FFmpeg was not found."
        })
      }
    });

    const result = await service.diagnostics(context);
    expect(result.overall).toBe("fail");
    expect(result.checks.storage.status).toBe("pass");
    expect(result.checks.ffmpeg.status).toBe("fail");
  });

  it("reports timeout and simultaneous component failures without losing shared-core health", async () => {
    const service = createSystemService({
      repository: { runMarker: () => { throw new Error("database offline"); }, close: vi.fn() },
      ffmpegProbe: {
        run: async () => ({
          status: "fail",
          executable: "ffmpeg",
          code: "FFMPEG_TIMEOUT",
          message: "FFmpeg did not respond before the diagnostic timeout."
        })
      }
    });

    const result = await service.diagnostics(context);
    expect(result.overall).toBe("fail");
    expect(result.checks.sharedCore.status).toBe("pass");
    expect(result.checks.storage.status).toBe("fail");
    expect(result.checks.ffmpeg).toMatchObject({ status: "fail", code: "FFMPEG_TIMEOUT" });
  });
});
