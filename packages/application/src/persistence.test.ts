import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SYSTEM_TIMING, type IgnoredDiagnosticCollection, type SystemTimingConfiguration } from "@studynarrator/shared-types";
import { APPLICATION_SERVICE_MANIFEST } from "./serviceManifest.js";
import { createPersistenceService, createUnavailablePersistenceService, PersistenceUnavailableError } from "./persistence.js";

const project = {
  contractVersion: 1 as const,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Persisted study",
  description: "",
  scriptSource: "Résumé\r\nSQL",
  scriptHash: "a".repeat(64),
  speakerMappings: [],
  lexiconEntries: [],
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z"
};

function repository() {
  return {
    status: vi.fn(() => ({
      contractVersion: 1 as const,
      state: "ready" as const,
      databaseSchemaVersion: 1 as const,
      targetDatabaseSchemaVersion: 1 as const,
      databasePath: "/tmp/studynarrator.sqlite",
      latestBackupPath: null
    })),
    listProjects: vi.fn(() => []),
    createProject: vi.fn(() => project),
    getProject: vi.fn(() => project),
    replaceProject: vi.fn(() => project),
    duplicateProject: vi.fn(() => project),
    deleteProject: vi.fn(),
    getSystemPacing: vi.fn(() => DEFAULT_SYSTEM_TIMING),
    updateSystemPacing: vi.fn((input: SystemTimingConfiguration) => input),
    getIgnoredDiagnostics: vi.fn(() => []),
    replaceIgnoredDiagnostics: vi.fn((input: IgnoredDiagnosticCollection) => input),
    listGlobalLexicon: vi.fn(() => []),
    replaceGlobalLexicon: vi.fn(() => []),
  };
}

describe("persistence application service", () => {
  it("enumerates and executes every persistence service method", async () => {
    const source = repository();
    const service = createPersistenceService(source);
    const liveMethods = [
      ...Object.keys(service).filter((key) => key === "status").map((key) => `persistence.${key}`),
      ...Object.keys(service.projects).map((key) => `persistence.projects.${key}`),
      ...Object.keys(service.settings).map((key) => `persistence.settings.${key}`),
      ...Object.keys(service.preferences).map((key) => `persistence.preferences.${key}`),
      ...Object.keys(service.globalLexicon).map((key) => `persistence.globalLexicon.${key}`)
    ];
    expect(liveMethods.sort()).toEqual(APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("persistence.")).sort());
    const replacement = {
      name: project.name,
      description: project.description,
      scriptSource: project.scriptSource,
      speakerMappings: [],
      lexiconEntries: []
    };
    await service.status();
    await service.projects.list();
    await service.projects.create({ name: "Study" });
    await service.projects.get(project.id);
    await service.projects.replace(project.id, replacement);
    await service.projects.duplicate(project.id, { name: "Copy" });
    await service.projects.delete(project.id);
    await service.settings.getPacing();
    await service.settings.updatePacing(DEFAULT_SYSTEM_TIMING);
    await service.preferences.getIgnoredDiagnostics();
    await service.preferences.replaceIgnoredDiagnostics([]);
    await service.globalLexicon.list();
    await service.globalLexicon.replace([]);

    expect(source.status).toHaveBeenCalledOnce();
    expect(source.listProjects).toHaveBeenCalledOnce();
    expect(source.createProject).toHaveBeenCalledOnce();
    expect(source.getProject).toHaveBeenCalledOnce();
    expect(source.replaceProject).toHaveBeenCalledOnce();
    expect(source.duplicateProject).toHaveBeenCalledOnce();
    expect(source.deleteProject).toHaveBeenCalledOnce();
    expect(source.getSystemPacing).toHaveBeenCalledOnce();
    expect(source.updateSystemPacing).toHaveBeenCalledOnce();
    expect(source.getIgnoredDiagnostics).toHaveBeenCalledOnce();
    expect(source.replaceIgnoredDiagnostics).toHaveBeenCalledOnce();
    expect(source.listGlobalLexicon).toHaveBeenCalledOnce();
    expect(source.replaceGlobalLexicon).toHaveBeenCalledOnce();
    expect(liveMethods).toHaveLength(13);
  });

  it("validates requests before invoking the repository", async () => {
    const source = repository();
    const service = createPersistenceService(source);

    await expect(service.projects.create({ name: "Study" })).resolves.toEqual(project);
    expect(source.createProject).toHaveBeenCalledWith({ name: "Study", description: "" });
    await expect(service.projects.create({ name: "Study", extra: "not allowed" } as never)).rejects.toThrow();
    expect(source.createProject).toHaveBeenCalledTimes(1);
    await expect(service.projects.duplicate(project.id, { name: "Study copy" })).resolves.toEqual(project);
    expect(source.duplicateProject).toHaveBeenCalledWith(project.id, { name: "Study copy" });
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
      targetDatabaseSchemaVersion: 1,
      databasePath: "/tmp/studynarrator.sqlite",
      latestBackupPath: "/tmp/backups/recovery.sqlite",
      code: "MIGRATION_FAILED",
      message: "Migration failed; restore the recovery backup."
    });
    await expect(service.status()).resolves.toMatchObject({ state: "unavailable" });
    await expect(service.projects.list()).rejects.toBeInstanceOf(PersistenceUnavailableError);
    await expect(service.settings.updatePacing(DEFAULT_SYSTEM_TIMING)).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });
  });
});
