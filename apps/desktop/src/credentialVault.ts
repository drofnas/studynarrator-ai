import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CredentialStore } from "@studynarrator/application";

const VAULT_VERSION = 1;
const REFERENCE_PREFIX = "safe-storage:";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

interface VaultDocument {
  version: 1;
  entries: Record<string, string>;
}

export class CredentialEncryptionUnavailableError extends Error {
  readonly code = "CREDENTIAL_ENCRYPTION_UNAVAILABLE";
}

function referenceFor(profileId: string): string {
  return `${REFERENCE_PREFIX}${profileId}`;
}

function profileIdFromReference(reference: string): string {
  if (!reference.startsWith(REFERENCE_PREFIX) || reference.length === REFERENCE_PREFIX.length) {
    throw new Error("The credential reference is invalid.");
  }
  return reference.slice(REFERENCE_PREFIX.length);
}

function emptyVault(): VaultDocument {
  return { version: VAULT_VERSION, entries: {} };
}

export class ElectronCredentialVault implements CredentialStore {
  readonly replacementAllowed = true;
  readonly filePath: string;

  constructor(
    private readonly safeStorage: SafeStorageLike,
    dataDirectory: string
  ) {
    this.filePath = resolve(dataDirectory, "credentials.safe-storage.json");
  }

  private assertEncryption(): void {
    if (!this.safeStorage.isEncryptionAvailable() || this.safeStorage.getSelectedStorageBackend?.() === "basic_text") {
      throw new CredentialEncryptionUnavailableError("Encrypted credential storage is unavailable; the API key was not stored.");
    }
  }

  private async load(): Promise<VaultDocument> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Invalid vault document.");
      const record = parsed as Record<string, unknown>;
      if (record.version !== VAULT_VERSION || typeof record.entries !== "object" || record.entries === null || Array.isArray(record.entries)) {
        throw new Error("Invalid vault document.");
      }
      const entries: Record<string, string> = {};
      for (const [key, value] of Object.entries(record.entries)) {
        if (typeof value !== "string" || !key) throw new Error("Invalid vault entry.");
        entries[key] = value;
      }
      return { version: VAULT_VERSION, entries };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT") return emptyVault();
      throw error;
    }
  }

  private async save(document: VaultDocument): Promise<void> {
    this.assertEncryption();
    const directory = dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const temporaryPath = `${this.filePath}.new`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(document)}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
    await fs.chmod(temporaryPath, 0o600);
    await fs.rename(temporaryPath, this.filePath);
    await fs.chmod(this.filePath, 0o600);
  }

  async read(reference: string): Promise<string | null> {
    this.assertEncryption();
    const profileId = profileIdFromReference(reference);
    const encoded = (await this.load()).entries[profileId];
    return encoded ? this.safeStorage.decryptString(Buffer.from(encoded, "base64")) : null;
  }

  async write(profileId: string, apiKey: string): Promise<string> {
    this.assertEncryption();
    const document = await this.load();
    document.entries[profileId] = this.safeStorage.encryptString(apiKey).toString("base64");
    await this.save(document);
    return referenceFor(profileId);
  }

  async delete(reference: string): Promise<void> {
    this.assertEncryption();
    const document = await this.load();
    delete document.entries[profileIdFromReference(reference)];
    await this.save(document);
  }

  async cleanup(validReferences: ReadonlySet<string>): Promise<void> {
    this.assertEncryption();
    const document = await this.load();
    let changed = false;
    for (const profileId of Object.keys(document.entries)) {
      if (!validReferences.has(referenceFor(profileId))) {
        delete document.entries[profileId];
        changed = true;
      }
    }
    if (changed) await this.save(document);
  }
}
