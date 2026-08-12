import { describe, expect, it, vi } from "vitest";
import { PERSISTENCE_CHANNELS, SYSTEM_DIAGNOSTICS_CHANNEL } from "@studynarrator/shared-types";
import { createPreloadBridge } from "./bridge.js";
import { registerDiagnosticsHandler, registerPersistenceHandlers } from "./ipc.js";
import { SECURE_WEB_PREFERENCES } from "./security.js";

const diagnostics = {
  schemaVersion: 2,
  overall: "fail",
  client: "electron",
  transport: "ipc",
  runtime: {
    schemaVersion: 2,
    applicationVersion: "0.1.0",
    runtimeName: "electron",
    runtimeVersion: "24.0.0",
    electronVersion: "43.3.0",
    platform: "darwin",
    architecture: "arm64",
    dataDirectory: "/tmp/g01"
  },
  checks: {
    sharedCore: { status: "pass", marker: "study-narrator-g01" },
    storage: { status: "fail", code: "STORAGE_UNAVAILABLE", message: "Storage unavailable." },
    ffmpeg: { status: "fail", executable: "ffmpeg", code: "FFMPEG_NOT_FOUND", message: "FFmpeg not found." }
  }
} as const;

const persistenceStatus = {
  contractVersion: 3 as const,
  state: "ready" as const,
  databaseSchemaVersion: 3 as const,
  targetDatabaseSchemaVersion: 3 as const,
  databasePath: "/tmp/studynarrator.sqlite",
  latestBackupPath: null
};

const persistence = {
  status: vi.fn(async () => persistenceStatus),
  projects: { list: vi.fn(async () => []), create: vi.fn(), get: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), delete: vi.fn() },
  settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
  preferences: { getIgnoredDiagnostics: vi.fn(async () => []), replaceIgnoredDiagnostics: vi.fn() },
  globalLexicon: { list: vi.fn(async () => []), replace: vi.fn() },
  connectionProfiles: { list: vi.fn(async () => []), create: vi.fn(), replace: vi.fn(), delete: vi.fn() }
};

describe("Electron boundary", () => {
  it("exposes only the validated diagnostics and persistence operations", async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === SYSTEM_DIAGNOSTICS_CHANNEL) return diagnostics;
      if (channel === PERSISTENCE_CHANNELS.projectsList) return [];
      return persistenceStatus;
    });
    const bridge = createPreloadBridge(invoke);
    expect(Object.keys(bridge)).toEqual(["system", "persistence"]);
    expect(Object.keys(bridge.system)).toEqual(["diagnostics"]);
    await expect(bridge.system.diagnostics()).resolves.toEqual(diagnostics);
    expect(invoke).toHaveBeenCalledWith(SYSTEM_DIAGNOSTICS_CHANNEL);
    await expect(bridge.persistence.projects.list()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith(PERSISTENCE_CHANNELS.projectsList);
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
    expect([...handlers.keys()]).toEqual([SYSTEM_DIAGNOSTICS_CHANNEL, ...Object.values(PERSISTENCE_CHANNELS)]);
    expect([...handlers.keys()]).not.toContain("persistence.execute");
    await expect(handlers.get(SYSTEM_DIAGNOSTICS_CHANNEL)?.()).resolves.toEqual(diagnostics);
    await expect(handlers.get(PERSISTENCE_CHANNELS.projectsList)?.()).resolves.toEqual([]);
    await expect(handlers.get(PERSISTENCE_CHANNELS.projectsCreate)?.(undefined, { name: "", secret: "must-not-leak" }))
      .rejects.toThrow("The request does not match the persistence contract.");
  });

  it("keeps the renderer sandboxed without Node integration", () => {
    expect(SECURE_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    });
  });
});
