import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CredentialEncryptionUnavailableError, ElectronCredentialVault } from "./credentialVault.js";

function encryptedStorage() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "keychain",
    encryptString: (value: string) => Buffer.from([...value].reverse().join(""), "utf8"),
    decryptString: (value: Buffer) => [...value.toString("utf8")].reverse().join("")
  };
}

describe("ElectronCredentialVault", () => {
  it("stores only encrypted profile-specific values with owner-only permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studynarrator-g06-vault-"));
    const vault = new ElectronCredentialVault(encryptedStorage(), directory);
    const reference = await vault.write("profile-one", "g06-secret-must-not-appear");
    expect(reference).toBe("safe-storage:profile-one");
    expect(await vault.read(reference)).toBe("g06-secret-must-not-appear");
    expect(await readFile(vault.filePath, "utf8")).not.toContain("g06-secret-must-not-appear");
    expect((await stat(vault.filePath)).mode & 0o777).toBe(0o600);
  });

  it.each([false, true])("refuses unavailable or plaintext encryption (basic=%s)", async (basic) => {
    const directory = await mkdtemp(join(tmpdir(), "studynarrator-g06-vault-"));
    const safeStorage = {
      ...encryptedStorage(),
      isEncryptionAvailable: () => basic,
      getSelectedStorageBackend: () => basic ? "basic_text" : "keychain"
    };
    const vault = new ElectronCredentialVault(safeStorage, directory);
    await expect(vault.write("profile", "g06-secret-must-not-appear")).rejects.toBeInstanceOf(CredentialEncryptionUnavailableError);
  });

  it("supports replace, clear, and orphan cleanup without reviving values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studynarrator-g06-vault-"));
    const vault = new ElectronCredentialVault(encryptedStorage(), directory);
    const first = await vault.write("first", "old-key");
    await vault.write("first", "new-key");
    const orphan = await vault.write("orphan", "orphan-key");
    expect(await vault.read(first)).toBe("new-key");
    await vault.cleanup(new Set([first]));
    expect(await vault.read(orphan)).toBeNull();
    await vault.delete(first);
    expect(await vault.read(first)).toBeNull();
  });

  it("does not write when encryption fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studynarrator-g06-vault-"));
    const safeStorage = encryptedStorage();
    safeStorage.encryptString = vi.fn(() => { throw new Error("keychain failed"); });
    const vault = new ElectronCredentialVault(safeStorage, directory);
    await expect(vault.write("profile", "g06-secret-must-not-appear")).rejects.toThrow("keychain failed");
  });
});
