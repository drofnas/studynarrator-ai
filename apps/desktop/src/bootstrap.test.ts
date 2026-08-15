import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopServices, resolveDesktopDataDirectory } from "./bootstrap.js";

describe("desktop data directory", () => {
  it("resolves a relative configured directory from the initiating workspace", () => {
    expect(resolveDesktopDataDirectory("/default/data", {
      INIT_CWD: "/workspace/studynarrator",
      STUDYNARRATOR_DATA_DIR: ".tmp/dev/manual"
    })).toBe(resolve("/workspace/studynarrator/.tmp/dev/manual"));
  });
});

describe("desktop connection bootstrap", () => {
  it("ignores Speaches environment settings", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "studynarrator-desktop-"));
    const runtime = await createDesktopServices({
      defaultDataDirectory: dataDirectory,
      environment: { SPEACHES_BASE_URL: "http://private-environment.invalid" }
    });
    try {
      if (!runtime.connection) throw new Error("Expected the desktop connection service.");
      expect(await runtime.connection.get()).toMatchObject({ baseUrl: null, configured: false });
    } finally {
      await runtime.dispose();
    }
  });
});
