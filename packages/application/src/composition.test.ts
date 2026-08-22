import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DATABASE_SCHEMA_VERSION } from "@studynarrator/shared-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATA_DIRECTORY_LAYOUT_VERSION,
  PersistenceConflictError,
  LayoutTooNewError,
  MigrationFailureError,
  SchemaTooNewError,
  listPersistenceBackups,
  openStudyNarratorRepository,
  readDataDirectoryManifest,
  restoreDatabaseFromBackup,
  runLayoutSteps,
  type DatabaseConstructor,
} from "@studynarrator/persistence";
import { createFfmpegProbe, type Logger } from "@studynarrator/runtime";
import {
  createStudyNarratorServices,
  type StudyNarratorRuntimeDescriptor,
  type StudyNarratorServices,
} from "./composition.js";
import { PersistenceUnavailableError, type StorageCheck } from "./index.js";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

const recorded = vi.hoisted(() => ({
  calls: [] as string[],
  restoreInputs: [] as {
    Database: unknown;
    databasePath: string;
    backupPath: string;
  }[],
}));

vi.mock("@studynarrator/persistence", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readDataDirectoryManifest: vi.fn(),
    runLayoutSteps: vi.fn(),
    openStudyNarratorRepository: vi.fn(),
    listPersistenceBackups: vi.fn(),
    restoreDatabaseFromBackup: vi.fn(),
  };
});

vi.mock("@studynarrator/runtime", () => ({
  createFfmpegProbe: vi.fn(() => ({
    run: async () => ({ status: "pass", executable: "ffmpeg", version: "7.1" }),
  })),
}));

vi.mock("./cachedSpeech.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createApplicationSpeechCache: vi.fn((dataDirectory: string) => {
      recorded.calls.push("speechCache");
      return { dataDirectory } as unknown;
    }),
    createSpeechCacheService: vi.fn(() => {
      recorded.calls.push("speechCacheService");
      return {};
    }),
    createCachedSpeechSynthesis: vi.fn(() => ({
      synthesize: async () => {
        throw new Error("not exercised by composition tests");
      },
    })),
    createProjectSpeechCacheKeyPlanner: vi.fn(() => () => undefined),
  };
});

/**
 * Minimal better-sqlite3 stand-in: composition never instantiates it in
 * these tests; the repository-opening and restore edges are stubbed.
 */
class FakeDatabase {
  constructor(
    readonly path: string,
    readonly options?: unknown,
  ) {}
  exec(): undefined {
    return undefined;
  }
  pragma(): undefined {
    return undefined;
  }
  prepare(): never {
    throw new Error("FakeDatabase does not prepare statements");
  }
  backup(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  close(): void {
    return undefined;
  }
}

const backupCreatedAt = "2026-09-20T09:00:00.000Z";

function makeBackup(databasePath: string): {
  path: string;
  fromVersion: number;
  createdAt: string;
  sizeBytes: number;
  kind: "migration" | "prerestore";
} {
  return {
    path: `${databasePath}.backup`,
    fromVersion: 3,
    createdAt: backupCreatedAt,
    sizeBytes: 4096,
    kind: "prerestore",
  };
}

function storagePass(databasePath: string): StorageCheck {
  return {
    status: "pass",
    driver: "better-sqlite3",
    sqliteVersion: "3.49.1",
    migrationVersion: DATABASE_SCHEMA_VERSION,
    databasePath,
    latestBackupPath: null,
    markerKey: "runtime.storage-self-test",
    markerValue: "study-narrator-storage-ok",
    createdAt: new Date().toISOString(),
  };
}

type OpenedRepository = Awaited<ReturnType<typeof openStudyNarratorRepository>>;

function fakeRepository(closeLog: string[]): OpenedRepository {
  return {
    listRecoverableRenderJobs: () => [],
    runMarker: () =>
      storagePass(resolve(process.cwd(), "studynarrator.sqlite")),
    close: () => {
      closeLog.push("close");
    },
  } as unknown as OpenedRepository;
}

function makeDescriptor(dataDirectory: string): StudyNarratorRuntimeDescriptor {
  return {
    client: "web",
    distribution: "development-web",
    transport: "rest",
    runtimeName: "node",
    runtimeVersion: "24.0.0",
    electronVersion: null,
    sourceRevision: "test-revision",
    dataDirectory,
    appVersion: "0.1.0",
  };
}

describe("createStudyNarratorServices", () => {
  let closeLog: string[];

  beforeEach(() => {
    recorded.calls.length = 0;
    recorded.restoreInputs.length = 0;
    closeLog = [];
    vi.resetAllMocks();
    vi.mocked(readDataDirectoryManifest).mockImplementation(async () => {
      recorded.calls.push("manifest");
      return undefined as never;
    });
    vi.mocked(runLayoutSteps).mockImplementation(async () => {
      recorded.calls.push("layout");
      return {
        completed: [] as string[],
        failed: [] as { id: string; error: unknown }[],
      };
    });
    vi.mocked(openStudyNarratorRepository).mockImplementation(async () => {
      recorded.calls.push("open");
      return fakeRepository(closeLog);
    });
    vi.mocked(listPersistenceBackups).mockImplementation(
      async (databasePath) => [makeBackup(databasePath)],
    );
    vi.mocked(restoreDatabaseFromBackup).mockImplementation(async (input) => {
      recorded.calls.push("restore");
      recorded.restoreInputs.push(input);
      return { restoredFrom: input.backupPath, safetyCopyPath: null };
    });
  });

  async function servicesIn(
    dataDirectory: string,
    ffmpegPath?: string,
  ): Promise<StudyNarratorServices> {
    return createStudyNarratorServices({
      Database: FakeDatabase as unknown as DatabaseConstructor,
      descriptor: makeDescriptor(dataDirectory),
      logger,
      ...(ffmpegPath === undefined ? {} : { ffmpegPath }),
    });
  }

  function withDataDirectory<T>(
    body: (dataDirectory: string) => Promise<T>,
  ): Promise<T> {
    return Promise.resolve().then(async () => {
      const dataDirectory = mkdtempSync(
        join(tmpdir(), "studynarrator-composition-"),
      );
      try {
        return await body(dataDirectory);
      } finally {
        rmSync(dataDirectory, { recursive: true, force: true });
      }
    });
  }

  it("builds the healthy service graph with the speech cache before persistence opens", async () => {
    await withDataDirectory(async (dataDirectory) => {
      const services = await servicesIn(
        dataDirectory,
        "/opt/ffmpeg/bin/ffmpeg",
      );
      expect(recorded.calls).toEqual([
        "speechCache",
        "speechCacheService",
        "manifest",
        "layout",
        "open",
      ]);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        {
          event: "application-start",
          appVersion: "0.1.0",
          databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
          dataDirectoryLayoutVersion: DATA_DIRECTORY_LAYOUT_VERSION,
          dataDirectory,
          distribution: "development-web",
        },
        "Application starting",
      );
      expect(runLayoutSteps).toHaveBeenCalledWith(
        dataDirectory,
        expect.any(Array),
        { logger },
      );
      expect(openStudyNarratorRepository).toHaveBeenCalledWith({
        Database: FakeDatabase,
        databasePath: resolve(dataDirectory, "studynarrator.sqlite"),
        logger,
      });
      expect(services.logger).toBe(logger);
      for (const key of [
        "connection",
        "voiceCatalog",
        "scratchpad",
        "projectPreview",
        "renders",
        "scriptGeneration",
        "speechCache",
      ] as const) {
        expect(services[key], key).not.toBeUndefined();
      }
      expect(services.context).toMatchObject({
        client: "web",
        distribution: "development-web",
        transport: "rest",
        runtimeName: "node",
        runtimeVersion: "24.0.0",
        electronVersion: null,
        dataDirectory,
        sourceRevision: "test-revision",
      });
      expect(vi.mocked(createFfmpegProbe)).toHaveBeenCalledWith({
        executable: "/opt/ffmpeg/bin/ffmpeg",
      });
      expect(services.service.health()).toMatchObject({
        status: "ok",
        applicationVersion: "0.1.0",
      });
      await services.dispose();
      expect(closeLog).toEqual(["close"]);
    });
  });

  it("reports healthy backup listings and refuses restore while the app is open", async () => {
    await withDataDirectory(async (dataDirectory) => {
      const services = await servicesIn(dataDirectory);
      const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
      const backup = makeBackup(databasePath);
      expect(await services.persistence.backups?.list()).toEqual([backup]);
      await expect(
        services.persistence.backups?.restore({ backupPath: backup.path }),
      ).rejects.toThrow(PersistenceConflictError);
      await expect(
        services.persistence.backups?.restore({ backupPath: backup.path }),
      ).rejects.toThrow(
        "Close StudyNarrator before restoring a backup; the database must not be open.",
      );
      expect(vi.mocked(restoreDatabaseFromBackup)).not.toHaveBeenCalled();
    });
  });

  it("renders healthy diagnostics with backup usage and the configured probe", async () => {
    await withDataDirectory(async (dataDirectory) => {
      const services = await servicesIn(dataDirectory);
      const diagnostics = await services.service.diagnostics(services.context);
      expect(diagnostics.overall).toBe("pass");
      expect(diagnostics.checks.storage).toMatchObject({
        status: "pass",
        driver: "better-sqlite3",
        migrationVersion: DATABASE_SCHEMA_VERSION,
      });
      expect(diagnostics.checks.ffmpeg).toEqual({
        status: "pass",
        executable: "ffmpeg",
        version: "7.1",
      });
      expect(diagnostics).toMatchObject({
        backupCount: 1,
        backupTotalBytes: 4096,
        oldestBackupAt: backupCreatedAt,
      });
    });
  });

  it("surfaces a too-new data layout as unavailable persistence with working backups", async () => {
    await withDataDirectory(async (dataDirectory) => {
      const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
      const backup = makeBackup(databasePath);
      vi.mocked(readDataDirectoryManifest).mockImplementation(async () => {
        recorded.calls.push("manifest");
        throw new LayoutTooNewError(dataDirectory, 2, 1);
      });
      const services = await servicesIn(dataDirectory);
      expect(vi.mocked(openStudyNarratorRepository)).not.toHaveBeenCalled();
      expect(services.connection).toBeUndefined();
      expect(services.scratchpad).toBeUndefined();
      expect(services.renders).toBeUndefined();
      expect(services.scriptGeneration).toBeUndefined();
      const status = await services.persistence.status();
      expect(status).toMatchObject({
        state: "unavailable",
        code: "SCHEMA_TOO_NEW",
        databaseSchemaVersion: null,
        targetDatabaseSchemaVersion: DATABASE_SCHEMA_VERSION,
        databasePath,
        latestBackupPath: null,
        availableBackups: [backup],
      });
      expect(await services.persistence.backups?.list()).toEqual([backup]);
      expect(
        await services.persistence.backups?.restore({
          backupPath: backup.path,
        }),
      ).toEqual({ restoredFrom: backup.path, safetyCopyPath: null });
      expect(recorded.restoreInputs).toEqual([
        {
          Database: FakeDatabase,
          databasePath,
          backupPath: backup.path,
        },
      ]);
      const diagnostics = await services.service.diagnostics(services.context);
      expect(diagnostics.overall).toBe("fail");
      expect(diagnostics.checks.storage).toMatchObject({
        status: "fail",
        code: "LAYOUT_TOO_NEW",
      });
      await services.dispose();
    });
  });

  it("surfaces a too-new database schema as unavailable persistence with working backups", async () => {
    await withDataDirectory(async (dataDirectory) => {
      const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
      const backup = makeBackup(databasePath);
      vi.mocked(openStudyNarratorRepository).mockImplementation(async () => {
        recorded.calls.push("open");
        throw new SchemaTooNewError(databasePath, 9, 4, [backup]);
      });
      const services = await servicesIn(dataDirectory);
      const status = await services.persistence.status();
      expect(status).toMatchObject({
        state: "unavailable",
        code: "SCHEMA_TOO_NEW",
        databaseSchemaVersion: 9,
        targetDatabaseSchemaVersion: DATABASE_SCHEMA_VERSION,
        databasePath,
        latestBackupPath: backup.path,
        availableBackups: [backup],
      });
      expect(await services.persistence.backups?.list()).toEqual([backup]);
      expect(
        await services.persistence.backups?.restore({
          backupPath: backup.path,
        }),
      ).toEqual({ restoredFrom: backup.path, safetyCopyPath: null });
      await expect(projectsOf(services).list()).rejects.toBeInstanceOf(
        PersistenceUnavailableError,
      );
      const diagnostics = await services.service.diagnostics(services.context);
      expect(diagnostics.overall).toBe("fail");
      expect(diagnostics.checks.storage).toMatchObject({
        status: "fail",
        code: "SCHEMA_TOO_NEW",
        databasePath,
        recoveryBackupPath: backup.path,
      });
    });
  });

  it("surfaces migration failures as unavailable persistence", async () => {
    await withDataDirectory(async (dataDirectory) => {
      const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
      const backupPath = makeBackup(databasePath).path;
      vi.mocked(openStudyNarratorRepository).mockImplementation(async () => {
        recorded.calls.push("open");
        throw new MigrationFailureError(
          "migration step failed",
          databasePath,
          backupPath,
          2,
          { version: 4, name: "four" },
        );
      });
      const services = await servicesIn(dataDirectory);
      const status = await services.persistence.status();
      expect(status).toMatchObject({
        state: "unavailable",
        code: "MIGRATION_FAILED",
        databaseSchemaVersion: 2,
        databasePath,
        latestBackupPath: backupPath,
        message: "migration step failed",
      });
      expect(
        await services.persistence.backups?.restore({
          backupPath: makeBackup(databasePath).path,
        }),
      ).toEqual({
        restoredFrom: makeBackup(databasePath).path,
        safetyCopyPath: null,
      });
    });
  });

  it("rethrows failures that are not recognized degraded conditions", async () => {
    await withDataDirectory(async (dataDirectory) => {
      const unexpected = new Error("disk full");
      vi.mocked(openStudyNarratorRepository).mockImplementation(async () => {
        recorded.calls.push("open");
        throw unexpected;
      });
      await expect(servicesIn(dataDirectory)).rejects.toBe(unexpected);
    });
  });
});

// Destructured helper so the unavailable-client check stays one line.
function projectsOf(
  services: Awaited<ReturnType<typeof createStudyNarratorServices>>,
) {
  return services.persistence.projects;
}
