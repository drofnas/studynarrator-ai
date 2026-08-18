import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SYSTEM_TIMING,
  type IgnoredDiagnosticCollection,
  type SystemTimingConfiguration,
} from "@studynarrator/shared-types";
import { APPLICATION_SERVICE_MANIFEST } from "./serviceManifest.js";
import {
  createPersistenceService,
  createUnavailablePersistenceService,
  PersistenceUnavailableError,
} from "./persistence.js";

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
  updatedAt: "2026-08-12T12:00:00.000Z",
};

function backupsProvider(
  backup: {
    path: string;
    fromVersion: number;
    createdAt: string;
    sizeBytes: number;
  } | null = null,
) {
  return {
    list: vi.fn(async () => (backup ? [backup] : [])),
    restore: vi.fn(async (input: { backupPath: string }) => ({
      restoredFrom: input.backupPath,
      safetyCopyPath: "/tmp/backups/pre-restore.sqlite",
    })),
  };
}

function requireBackups(
  client: import("@studynarrator/shared-types").PersistenceClient,
) {
  if (client.backups === undefined)
    throw new Error("persistence.backups client is required");
  return client.backups;
}

function repository() {
  return {
    status: vi.fn(() => ({
      contractVersion: 1 as const,
      state: "ready" as const,
      databaseSchemaVersion: 3 as const,
      targetDatabaseSchemaVersion: 3 as const,
      databasePath: "/tmp/studynarrator.sqlite",
      latestBackupPath: null,
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
    replaceIgnoredDiagnostics: vi.fn(
      (input: IgnoredDiagnosticCollection) => input,
    ),
    listGlobalLexicon: vi.fn(() => []),
    replaceGlobalLexicon: vi.fn(() => []),
  };
}

describe("persistence application service", () => {
  it("enumerates and executes every persistence service method", async () => {
    const source = repository();
    const provider = backupsProvider({
      path: "/tmp/backups/studynarrator-v0003-to-v0004-2026-08-12T12-00-00-000Z.sqlite",
      fromVersion: 3,
      createdAt: "2026-08-12T12:00:00.000Z",
      sizeBytes: 4096,
    });
    const service = createPersistenceService(source, { backups: provider });
    const backups = requireBackups(service);
    const liveMethods = [
      ...Object.keys(service)
        .filter((key) => key === "status")
        .map((key) => `persistence.${key}`),
      ...Object.keys(backups).map((key) => `persistence.backups.${key}`),
      ...Object.keys(service.projects).map(
        (key) => `persistence.projects.${key}`,
      ),
      ...Object.keys(service.settings).map(
        (key) => `persistence.settings.${key}`,
      ),
      ...Object.keys(service.preferences).map(
        (key) => `persistence.preferences.${key}`,
      ),
      ...Object.keys(service.globalLexicon).map(
        (key) => `persistence.globalLexicon.${key}`,
      ),
    ];
    expect(liveMethods.sort()).toEqual(
      APPLICATION_SERVICE_MANIFEST.filter((path) =>
        path.startsWith("persistence."),
      ).sort(),
    );
    const replacement = {
      name: project.name,
      description: project.description,
      scriptSource: project.scriptSource,
      speakerMappings: [],
      lexiconEntries: [],
    };
    await service.status();
    await backups.list();
    await backups.restore({
      backupPath:
        "/tmp/backups/studynarrator-v0003-to-v0004-2026-08-12T12-00-00-000Z.sqlite",
    });
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
    await service.globalLexicon.replace([
      {
        scope: "global",
        entryType: "namedSense",
        displayText: "resume",
        senseId: "cv",
        spokenText: "rez oo may",
      },
    ]);

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
    expect(source.replaceGlobalLexicon).toHaveBeenCalledWith([
      {
        scope: "global",
        entryType: "namedSense",
        displayText: "resume",
        senseId: "cv",
        spokenText: "rez oo may",
        caseSensitive: false,
        wholeWord: true,
        priority: 0,
        enabled: true,
        notes: "",
      },
    ]);
    expect(liveMethods).toHaveLength(15);
    expect(provider.list).toHaveBeenCalledOnce();
    expect(provider.restore).toHaveBeenCalledWith({
      backupPath:
        "/tmp/backups/studynarrator-v0003-to-v0004-2026-08-12T12-00-00-000Z.sqlite",
    });
  });

  it("validates requests before invoking the repository", async () => {
    const source = repository();
    const service = createPersistenceService(source);

    await expect(service.projects.create({ name: "Study" })).resolves.toEqual(
      project,
    );
    expect(source.createProject).toHaveBeenCalledWith({
      name: "Study",
      description: "",
    });
    await expect(
      service.projects.create({ name: "Study", extra: "not allowed" } as never),
    ).rejects.toThrow();
    expect(source.createProject).toHaveBeenCalledTimes(1);
    await expect(
      service.projects.duplicate(project.id, { name: "Study copy" }),
    ).resolves.toEqual(project);
    expect(source.duplicateProject).toHaveBeenCalledWith(project.id, {
      name: "Study copy",
    });
  });

  it("validates repository responses at the application boundary", async () => {
    const source = repository();
    source.listProjects.mockReturnValue([
      { secret: "must-not-cross" },
    ] as never);
    await expect(
      createPersistenceService(source).projects.list(),
    ).rejects.toThrow();
  });

  it("keeps status available while rejecting degraded persistence operations", async () => {
    const provider = backupsProvider({
      path: "/tmp/backups/recovery.sqlite",
      fromVersion: 3,
      createdAt: "2026-08-12T12:00:00.000Z",
      sizeBytes: 4096,
    });
    const service = createUnavailablePersistenceService(
      {
        contractVersion: 1,
        state: "unavailable",
        databaseSchemaVersion: 2,
        targetDatabaseSchemaVersion: 3,
        databasePath: "/tmp/studynarrator.sqlite",
        latestBackupPath: "/tmp/backups/recovery.sqlite",
        code: "MIGRATION_FAILED",
        message: "Migration failed; restore the recovery backup.",
        availableBackups: [
          {
            path: "/tmp/backups/recovery.sqlite",
            fromVersion: 3,
            createdAt: "2026-08-12T12:00:00.000Z",
            sizeBytes: 4096,
          },
        ],
      },
      { backups: provider },
    );
    const backups = requireBackups(service);
    await expect(service.status()).resolves.toMatchObject({
      state: "unavailable",
    });
    await expect(backups.list()).resolves.toEqual([
      {
        path: "/tmp/backups/recovery.sqlite",
        fromVersion: 3,
        createdAt: "2026-08-12T12:00:00.000Z",
        sizeBytes: 4096,
      },
    ]);
    await expect(
      backups.restore({ backupPath: "/tmp/backups/recovery.sqlite" }),
    ).resolves.toEqual({
      restoredFrom: "/tmp/backups/recovery.sqlite",
      safetyCopyPath: "/tmp/backups/pre-restore.sqlite",
    });
    await expect(service.projects.list()).rejects.toBeInstanceOf(
      PersistenceUnavailableError,
    );
    await expect(
      service.settings.updatePacing(DEFAULT_SYSTEM_TIMING),
    ).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });
  });

  it("rejects backup restore when no provider exists", async () => {
    const service = createUnavailablePersistenceService({
      contractVersion: 1,
      state: "unavailable",
      databaseSchemaVersion: 2,
      targetDatabaseSchemaVersion: 3,
      databasePath: "/tmp/studynarrator.sqlite",
      latestBackupPath: null,
      code: "MIGRATION_FAILED",
      message: "Migration failed.",
      availableBackups: [],
    });
    const backups = requireBackups(service);
    await expect(backups.list()).resolves.toEqual([]);
    await expect(
      backups.restore({ backupPath: "/tmp/backups/recovery.sqlite" }),
    ).rejects.toBeInstanceOf(PersistenceUnavailableError);
  });
});
