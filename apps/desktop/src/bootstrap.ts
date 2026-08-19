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
  type DiagnosticsContext,
  type DiagnosticRepository,
  type RenderService,
  type StorageCheck,
} from "@studynarrator/application";
import {
  MigrationFailureError,
  PersistenceConflictError,
  SchemaTooNewError,
  listPersistenceBackups,
  openStudyNarratorRepository,
  restoreDatabaseFromBackup,
} from "@studynarrator/persistence";
import {
  DATABASE_SCHEMA_VERSION,
  PERSISTENCE_CONTRACT_VERSION,
  type PersistenceBackupsClient,
  type PersistenceClient,
} from "@studynarrator/shared-types";
import { createFfmpegProbe } from "@studynarrator/runtime";
import { createRenderPlanStore } from "@studynarrator/rendering";

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
      !(error instanceof SchemaTooNewError)
    )
      throw error;
    const recoveryBackupPath =
      error instanceof SchemaTooNewError
        ? (error.backups[0]?.path ?? null)
        : error.backupPath;
    storageFailure = {
      status: "fail",
      code: error.code,
      message: error.message,
      databasePath: error.databasePath,
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
        databaseSchemaVersion: error.databaseSchemaVersion,
        targetDatabaseSchemaVersion: DATABASE_SCHEMA_VERSION,
        databasePath: error.databasePath,
        latestBackupPath: recoveryBackupPath,
        code: error.code,
        message: error.message,
        availableBackups: await listPersistenceBackups(databasePath),
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
