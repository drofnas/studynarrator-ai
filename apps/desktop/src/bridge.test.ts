import { describe, expect, it, vi } from "vitest";
import { SYSTEM_DIAGNOSTICS_CHANNEL } from "@studynarrator/shared-types";
import { createPreloadBridge } from "./bridge.js";
import { registerDiagnosticsHandler } from "./ipc.js";
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

describe("Electron boundary", () => {
  it("exposes only the validated diagnostics operation", async () => {
    const invoke = vi.fn(async () => diagnostics);
    const bridge = createPreloadBridge(invoke);
    expect(Object.keys(bridge)).toEqual(["system"]);
    expect(Object.keys(bridge.system)).toEqual(["diagnostics"]);
    await expect(bridge.system.diagnostics()).resolves.toEqual(diagnostics);
    expect(invoke).toHaveBeenCalledWith(SYSTEM_DIAGNOSTICS_CHANNEL);
  });

  it("rejects malformed IPC output", async () => {
    const bridge = createPreloadBridge(async () => ({ ...diagnostics, secret: "leak" }));
    await expect(bridge.system.diagnostics()).rejects.toThrow();
  });

  it("registers one fixed IPC channel", async () => {
    const handlers = new Map<string, () => Promise<unknown>>();
    const ipcMain = {
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
      handle: vi.fn((channel: string, handler: () => Promise<unknown>) => handlers.set(channel, handler))
    };
    const service = {
      health: vi.fn(),
      runtime: vi.fn(),
      diagnostics: vi.fn(async () => diagnostics),
      close: vi.fn()
    };
    registerDiagnosticsHandler(ipcMain, service as never, {} as never);
    expect([...handlers.keys()]).toEqual([SYSTEM_DIAGNOSTICS_CHANNEL]);
    await expect(handlers.get(SYSTEM_DIAGNOSTICS_CHANNEL)?.()).resolves.toEqual(diagnostics);
  });

  it("keeps the renderer sandboxed without Node integration", () => {
    expect(SECURE_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    });
  });
});
