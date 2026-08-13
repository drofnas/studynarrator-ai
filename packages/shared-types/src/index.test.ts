import { describe, expect, it } from "vitest";
import { SystemDiagnosticsSchema } from "./index.js";

const validDiagnostics = {
  schemaVersion: 3,
  overall: "pass",
  client: "web",
  transport: "rest",
  runtime: {
    schemaVersion: 3,
    applicationVersion: "0.1.0",
    runtimeName: "node",
    runtimeVersion: "26.7.0",
    electronVersion: null,
    platform: "darwin",
    architecture: "arm64",
    dataDirectory: "/tmp/studynarrator"
  },
  checks: {
    sharedCore: { status: "pass", marker: "study-narrator-core" },
    storage: {
      status: "pass",
      driver: "better-sqlite3",
      sqliteVersion: "3.50.0",
      migrationVersion: 4,
      databasePath: "/tmp/studynarrator/studynarrator.sqlite",
      latestBackupPath: null,
      markerKey: "runtime.storage-self-test",
      markerValue: "study-narrator-storage-ok",
      createdAt: "2026-08-11T12:00:00.000Z"
    },
    ffmpeg: { status: "pass", executable: "ffmpeg", version: "ffmpeg version 8.1.2" }
  }
} as const;

describe("SystemDiagnosticsSchema", () => {
  it("accepts the shared diagnostics contract", () => {
    expect(SystemDiagnosticsSchema.parse(validDiagnostics)).toEqual(validDiagnostics);
  });

  it("rejects malformed or expanded boundary output", () => {
    expect(() => SystemDiagnosticsSchema.parse({ ...validDiagnostics, secret: "leak" })).toThrow();
    expect(() => SystemDiagnosticsSchema.parse({ ...validDiagnostics, overall: "unknown" })).toThrow();
  });

  it("accepts the same diagnostics shape across REST and IPC", () => {
    const rest = SystemDiagnosticsSchema.parse(validDiagnostics);
    const ipc = SystemDiagnosticsSchema.parse({
      ...validDiagnostics,
      client: "electron",
      transport: "ipc",
      runtime: {
        ...validDiagnostics.runtime,
        runtimeName: "electron",
        runtimeVersion: "24.18.1",
        electronVersion: "43.3.0",
        dataDirectory: "/tmp/studynarrator-desktop"
      },
      checks: {
        ...validDiagnostics.checks,
        storage: {
          ...validDiagnostics.checks.storage,
          databasePath: "/tmp/studynarrator-desktop/studynarrator.sqlite"
        },
        ffmpeg: { ...validDiagnostics.checks.ffmpeg, executable: "/opt/homebrew/bin/ffmpeg" }
      }
    });

    expect(Object.keys(ipc)).toEqual(Object.keys(rest));
    expect(Object.keys(ipc.runtime)).toEqual(Object.keys(rest.runtime));
    expect(Object.keys(ipc.checks)).toEqual(Object.keys(rest.checks));
  });
});
