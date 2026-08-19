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
  DATABASE_SCHEMA_VERSION,
  PERSISTENCE_CONTRACT_VERSION,
  type PersistenceBackupsClient,
  type PersistenceClient,
} from "@studynarrator/shared-types";
import {
  MigrationFailureError,
  PersistenceConflictError,
  SchemaTooNewError,
  listPersistenceBackups,
  openStudyNarratorRepository,
  restoreDatabaseFromBackup,
} from "@studynarrator/persistence";
import { createFfmpegProbe } from "@studynarrator/runtime";
import { createRenderPlanStore } from "@studynarrator/rendering";
import { resolveServerRuntimeConfiguration } from "./runtimeConfig.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

export function resolveServerDataDirectory(environment = process.env): string {
  return environment.STUDYNARRATOR_DATA_DIR
    ? resolve(
        environment.INIT_CWD ?? repositoryRoot,
        environment.STUDYNARRATOR_DATA_DIR,
      )
    : resolve(repositoryRoot, ".tmp/dev/web");
}

export async function createServerServices(environment = process.env) {
  const runtimeConfiguration = resolveServerRuntimeConfiguration(
    environment,
    repositoryRoot,
  );
  const dataDirectory = resolveServerDataDirectory(environment);
  const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
  const cache = createApplicationSpeechCache(dataDirectory);
  const speechCache = createSpeechCacheService(cache);
  let storageFailure: StorageCheck | undefined;
  let persistence: PersistenceClient;
  let repository: DiagnosticRepository;
  let connection;
  let voiceCatalog;
  let scratchpad;
  let projectPreview;
  let renders: RenderService | undefined;
  let scriptGeneration;
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
      client: "web" as const,
      nodeVersion: process.versions.node,
      electronVersion: null,
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
    const availableBackups = await listPersistenceBackups(error.databasePath);
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
        availableBackups,
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
    client: "web",
    distribution: runtimeConfiguration.distribution,
    transport: "rest",
    runtimeName: "node",
    runtimeVersion: process.versions.node,
    electronVersion: null,
    platform: process.platform,
    architecture: process.arch,
    dataDirectory,
    sourceRevision: runtimeConfiguration.sourceRevision,
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
