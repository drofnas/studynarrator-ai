import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  BUNDLED_VOICE_CATALOGS,
  createConnectionService,
  createApplicationSpeechCache,
  createCachedSpeechSynthesis,
  createPersistenceService,
  createProjectPreviewService,
  createProjectSpeechCacheKeyPlanner,
  createRenderPlanComputer,
  createRenderService,
  createScratchpadService,
  createScriptGenerationService,
  createSpeechCacheService,
  createSystemService,
  createUnavailablePersistenceService,
  createVoiceCatalogService,
  type BackupUsage,
  type DiagnosticsContext,
  type DiagnosticRepository,
  type RenderService,
  type StorageCheck,
} from "@studynarrator/application";
import {
  createSpeechCacheSweep,
  LayoutTooNewError,
  MigrationFailureError,
  PersistenceConflictError,
  SchemaTooNewError,
  removeStandaloneRenderPlans,
  listPersistenceBackups,
  openStudyNarratorRepository,
  readDataDirectoryManifest,
  restoreDatabaseFromBackup,
  runLayoutSteps,
  type LayoutStep,
} from "@studynarrator/persistence";
import {
  APPLICATION_VERSION,
  DATABASE_SCHEMA_VERSION,
  PERSISTENCE_CONTRACT_VERSION,
  type PersistenceBackupsClient,
  type PersistenceClient,
} from "@studynarrator/shared-types";
import { createFfmpegProbe } from "@studynarrator/runtime";
import {
  createRenderPlanStore,
  readSpeechCacheMetadata,
  SPEECH_CACHE_SCHEMA_VERSION,
} from "@studynarrator/rendering";

export function resolveDesktopDataDirectory(
  defaultDataDirectory: string,
  environment: NodeJS.ProcessEnv,
): string {
  return environment.STUDYNARRATOR_DATA_DIR
    ? resolve(
        environment.INIT_CWD ?? process.cwd(),
        environment.STUDYNARRATOR_DATA_DIR,
      )
    : resolve(defaultDataDirectory);
}

/**
 * One-time data directory layout steps, in the order that matters. Each
 * step's id is recorded in <dataDir>/manifest.json exactly once, after a
 * successful run (task 10.2); both steps are idempotent on re-run and
 * remove nothing this build or the user still needs.
 */
const layoutSteps: LayoutStep[] = [
  removeStandaloneRenderPlans,
  createSpeechCacheSweep({
    // Kept in lockstep with createApplicationSpeechCache, which roots the
    // speech cache at <dataDirectory>/cache/speech.
    relativeCacheRoot: "cache/speech",
    shouldDeleteEntry: async (metadataPath: string): Promise<boolean> => {
      const result = await readSpeechCacheMetadata(metadataPath);
      if (result.status === "unreadable") return true;
      if (result.status === "ok")
        return result.metadata.schemaVersion < SPEECH_CACHE_SCHEMA_VERSION;
      return false;
    },
  }),
];

export async function createDesktopServices(options: {
  defaultDataDirectory: string;
  environment?: NodeJS.ProcessEnv;
}) {
  const environment = options.environment ?? process.env;
  const dataDirectory = resolveDesktopDataDirectory(
    options.defaultDataDirectory,
    environment,
  );
  const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
  let storageFailure: StorageCheck | undefined;
  let persistence: PersistenceClient;
  let repository: DiagnosticRepository;
  let connection;
  let voiceCatalog;
  let scratchpad;
  let projectPreview;
  let renders: RenderService | undefined;
  let scriptGeneration;
  const cache = createApplicationSpeechCache(dataDirectory);
  const speechCache = createSpeechCacheService(cache);
  try {
    await readDataDirectoryManifest(dataDirectory, {
      appVersion: APPLICATION_VERSION,
    });
    await runLayoutSteps(dataDirectory, layoutSteps);
    const openedRepository = await openStudyNarratorRepository({
      Database,
      databasePath,
    });
    repository = openedRepository;
    const backups: PersistenceBackupsClient = {
      list: () => listPersistenceBackups(databasePath),
      restore: () => {
        throw new PersistenceConflictError(
          "Close StudyNarrator before restoring a backup; the database must not be open.",
        );
      },
    };
    persistence = createPersistenceService(openedRepository, {
      projectSpeechCacheKeys:
        createProjectSpeechCacheKeyPlanner(openedRepository),
      backups,
    });
    const context = {
      client: "electron" as const,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron ?? null,
    };
    connection = createConnectionService({
      repository: openedRepository,
      context,
    });
    voiceCatalog = createVoiceCatalogService({
      repository: openedRepository,
      bundledCatalogs: BUNDLED_VOICE_CATALOGS,
    });
    const speech = createCachedSpeechSynthesis({
      repository: openedRepository,
      cache,
    });
    scratchpad = createScratchpadService({
      repository: openedRepository,
      cache,
    });
    projectPreview = createProjectPreviewService({
      repository: openedRepository,
      speech,
    });
    const planStore = createRenderPlanStore(
      resolve(dataDirectory, "render-plans"),
    );
    const planComputer = createRenderPlanComputer({
      repository: openedRepository,
      cache,
    });
    scriptGeneration = createScriptGenerationService({
      repository: openedRepository,
    });
    renders = await createRenderService({
      repository: openedRepository,
      plans: planStore,
      planComputer,
      speech,
      dataDirectory,
      ...(environment.STUDYNARRATOR_FFMPEG_PATH
        ? { ffmpegPath: environment.STUDYNARRATOR_FFMPEG_PATH }
        : {}),
    });
  } catch (error) {
    if (
      !(error instanceof MigrationFailureError) &&
      !(error instanceof SchemaTooNewError) &&
      !(error instanceof LayoutTooNewError)
    )
      throw error;
    // A too-new layout is a data directory condition, not a database one:
    // there is no database schema version or per-error backup to surface.
    const layoutTooNew = error instanceof LayoutTooNewError;
    let recoveryBackupPath: string | null = null;
    if (!layoutTooNew) {
      recoveryBackupPath =
        error instanceof SchemaTooNewError
          ? (error.backups[0]?.path ?? null)
          : error.backupPath;
    }
    const unavailableDatabasePath = layoutTooNew
      ? databasePath
      : error.databasePath;
    storageFailure = {
      status: "fail",
      code: error.code,
      message: error.message,
      ...(layoutTooNew ? {} : { databasePath: error.databasePath }),
      recoveryBackupPath,
    };
    const backups: PersistenceBackupsClient = {
      list: () => listPersistenceBackups(databasePath),
      restore: (input) =>
        restoreDatabaseFromBackup({
          Database,
          databasePath,
          backupPath: input.backupPath,
        }),
    };
    persistence = createUnavailablePersistenceService(
      {
        contractVersion: PERSISTENCE_CONTRACT_VERSION,
        state: "unavailable",
        // The unavailable-status contract only knows the two database
        // failure codes; a too-new layout is the same user condition
        // ("created by a newer version") and carries its own message.
        databaseSchemaVersion: layoutTooNew
          ? null
          : error.databaseSchemaVersion,
        targetDatabaseSchemaVersion: DATABASE_SCHEMA_VERSION,
        databasePath: unavailableDatabasePath,
        latestBackupPath: recoveryBackupPath,
        code: layoutTooNew ? "SCHEMA_TOO_NEW" : error.code,
        message: error.message,
        availableBackups: await listPersistenceBackups(unavailableDatabasePath),
      },
      { backups },
    );
    repository = {
      runMarker: () => {
        throw error;
      },
      close: () => undefined,
    };
  }
  const service = createSystemService({
    repository,
    provideBackupUsage: async (): Promise<BackupUsage> => {
      const backups = await listPersistenceBackups(databasePath);
      return {
        count: backups.length,
        totalBytes: backups.reduce(
          (sumBytes, backup) => sumBytes + backup.sizeBytes,
          0,
        ),
        oldestAt: backups.reduce<string | null>(
          (oldest, backup) =>
            oldest === null || backup.createdAt < oldest
              ? backup.createdAt
              : oldest,
          null,
        ),
      };
    },
    ...(storageFailure === undefined ? {} : { storageFailure }),
    ffmpegProbe: createFfmpegProbe(
      environment.STUDYNARRATOR_FFMPEG_PATH
        ? { executable: environment.STUDYNARRATOR_FFMPEG_PATH }
        : {},
    ),
  });
  const context: DiagnosticsContext = {
    client: "electron",
    distribution: "electron",
    transport: "ipc",
    runtimeName: "electron",
    runtimeVersion: process.versions.node,
    electronVersion: process.versions.electron ?? null,
    platform: process.platform,
    architecture: process.arch,
    dataDirectory,
    sourceRevision:
      environment.STUDYNARRATOR_SOURCE_REVISION?.trim() || "development",
  };
  return {
    service,
    persistence,
    connection,
    voiceCatalog,
    scratchpad,
    projectPreview,
    renders,
    scriptGeneration,
    speechCache,
    context,
    dispose: async () => {
      await renders?.close();
      repository.close();
    },
  };
}
