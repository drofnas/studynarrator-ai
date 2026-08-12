import { describe, expect, it, vi } from "vitest";
import type { IgnoredDiagnosticCollection, SystemPacingDefaults } from "@studynarrator/shared-types";
import { createPersistenceService, createUnavailablePersistenceService, PersistenceUnavailableError } from "./persistence.js";

const project = {
  contractVersion: 1 as const,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Persisted study",
  description: "",
  scriptSource: "Résumé\r\nSQL",
  scriptHash: "a".repeat(64),
  connectionProfileId: null,
  speakerMappings: [],
  pausePresets: [{ pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }],
  paragraphPause: { enabled: true, pauseId: "pause_medium" as const, durationMs: 750 },
  lexiconEntries: [],
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z"
};

function repository() {
  return {
    status: vi.fn(() => ({
      contractVersion: 1 as const,
      state: "ready" as const,
      databaseSchemaVersion: 2 as const,
      targetDatabaseSchemaVersion: 2 as const,
      databasePath: "/tmp/studynarrator.sqlite",
      latestBackupPath: null
    })),
    listProjects: vi.fn(() => []),
    createProject: vi.fn(() => project),
    getProject: vi.fn(() => project),
    replaceProject: vi.fn(() => project),
    deleteProject: vi.fn(),
    getSystemPacing: vi.fn(() => ({ enabled: true, durationMs: 750 })),
    updateSystemPacing: vi.fn((input: SystemPacingDefaults) => input),
    getIgnoredDiagnostics: vi.fn(() => []),
    replaceIgnoredDiagnostics: vi.fn((input: IgnoredDiagnosticCollection) => input),
    listGlobalLexicon: vi.fn(() => []),
    replaceGlobalLexicon: vi.fn(() => []),
    listConnectionProfiles: vi.fn(() => []),
    createConnectionProfile: vi.fn(),
    replaceConnectionProfile: vi.fn(),
    deleteConnectionProfile: vi.fn()
  };
}

describe("persistence application service", () => {
  it("validates requests before invoking the repository", async () => {
    const source = repository();
    const service = createPersistenceService(source);

    await expect(service.projects.create({ name: "Study" })).resolves.toEqual(project);
    expect(source.createProject).toHaveBeenCalledWith({ name: "Study", description: "" });
    await expect(service.projects.create({ name: "Study", extra: "not allowed" } as never)).rejects.toThrow();
    expect(source.createProject).toHaveBeenCalledTimes(1);
  });

  it("validates repository responses at the application boundary", async () => {
    const source = repository();
    source.listProjects.mockReturnValue([{ secret: "must-not-cross" }] as never);
    await expect(createPersistenceService(source).projects.list()).rejects.toThrow();
  });

  it("keeps status available while rejecting degraded persistence operations", async () => {
    const service = createUnavailablePersistenceService({
      contractVersion: 1,
      state: "unavailable",
      databaseSchemaVersion: 1,
      targetDatabaseSchemaVersion: 2,
      databasePath: "/tmp/studynarrator.sqlite",
      latestBackupPath: "/tmp/backups/recovery.sqlite",
      code: "MIGRATION_FAILED",
      message: "Migration failed; restore the recovery backup."
    });
    await expect(service.status()).resolves.toMatchObject({ state: "unavailable" });
    await expect(service.projects.list()).rejects.toBeInstanceOf(PersistenceUnavailableError);
    await expect(service.settings.updatePacing({ enabled: false, durationMs: 1000 })).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });
  });
});
