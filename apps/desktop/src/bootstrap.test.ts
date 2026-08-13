import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopServices, resolveDesktopDataDirectory } from "./bootstrap.js";

describe("desktop data directory", () => {
  it("resolves a relative configured directory from the initiating workspace", () => {
    expect(resolveDesktopDataDirectory("/default/data", {
      INIT_CWD: "/workspace/studynarrator",
      STUDYNARRATOR_DATA_DIR: ".tmp/gates/G04/manual"
    })).toBe(resolve("/workspace/studynarrator/.tmp/gates/G04/manual"));
  });
});

describe("desktop connection credential bootstrap", () => {
  it("keeps the credential out of SQLite, responses, and encrypted vault text", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "studynarrator-g06-desktop-"));
    const safeStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "keychain",
      encryptString: (value: string) => Buffer.from([...value].reverse().join("")),
      decryptString: (value: Buffer) => [...value.toString()].reverse().join("")
    };
    const runtime = await createDesktopServices({ defaultDataDirectory: dataDirectory, environment: {}, safeStorage });
    try {
      if (!runtime.connections || !runtime.credentialVault) throw new Error("Expected desktop connection services.");
      const profile = await runtime.connections.create({
        profile: { id: "desktop-secret", name: "Desktop", baseUrl: "http://127.0.0.1:8000", defaultModelId: "model", defaultVoiceId: "voice" },
        credential: { action: "replace", apiKey: "g06-secret-must-not-appear" }
      });
      expect(JSON.stringify(profile)).not.toContain("g06-secret-must-not-appear");
      expect((await readFile(join(dataDirectory, "studynarrator.sqlite"))).toString("latin1")).not.toContain("g06-secret-must-not-appear");
      expect(await readFile(runtime.credentialVault.filePath, "utf8")).not.toContain("g06-secret-must-not-appear");
    } finally {
      runtime.service.close();
    }
  });
});
