import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopServices, resolveDesktopDataDirectory } from "./bootstrap.js";
import { ElectronCredentialVault } from "./credentialVault.js";

describe("desktop data directory", () => {
  it("resolves a relative configured directory from the initiating workspace", () => {
    expect(resolveDesktopDataDirectory("/default/data", {
      INIT_CWD: "/workspace/studynarrator",
      STUDYNARRATOR_DATA_DIR: ".tmp/dev/manual"
    })).toBe(resolve("/workspace/studynarrator/.tmp/dev/manual"));
  });
});

describe("desktop connection bootstrap", () => {
  it("removes orphaned legacy vault credentials and ignores Speaches environment settings", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "studynarrator-desktop-"));
    const safeStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "keychain",
      encryptString: (value: string) => Buffer.from([...value].reverse().join("")),
      decryptString: (value: Buffer) => [...value.toString()].reverse().join("")
    };
    const legacyVault = new ElectronCredentialVault(safeStorage, dataDirectory);
    await legacyVault.write("old-profile", "test-secret-must-not-appear");
    const runtime = await createDesktopServices({
      defaultDataDirectory: dataDirectory,
      environment: { SPEACHES_BASE_URL: "http://private-environment.invalid" },
      safeStorage
    });
    try {
      if (!runtime.connection) throw new Error("Expected the desktop connection service.");
      expect(await runtime.connection.get()).toMatchObject({ baseUrl: null, configured: false });
      expect((await readFile(join(dataDirectory, "studynarrator.sqlite"))).toString("latin1")).not.toContain("test-secret-must-not-appear");
      expect(await readFile(legacyVault.filePath, "utf8")).not.toContain("old-profile");
    } finally {
      runtime.service.close();
    }
  });
});
