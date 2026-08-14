import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  createConnectionsService,
  createApplicationSpeechCache,
  createCachedSpeechSynthesis,
  BUNDLED_VOICE_CATALOGS,
  createPersistenceService,
  createProjectPreviewService,
  createRenderPlanService,
  createRenderService,
  createRoutedCredentialStore,
  createScratchpadService,
  createScriptGenerationService,
  createSpeechCacheService,
  createSystemService,
  createUnavailablePersistenceService,
  createVoiceCatalogService,
  reconcileEnvironmentConnectionProfile,
  type DiagnosticsContext,
  type DiagnosticRepository,
  type RenderService,
  type StorageCheck
} from "@studynarrator/application";
import { MigrationFailureError, openStudyNarratorRepository } from "@studynarrator/persistence";
import { DATABASE_SCHEMA_VERSION, PERSISTENCE_CONTRACT_VERSION, type PersistenceClient } from "@studynarrator/shared-types";
import { createFfmpegProbe } from "@studynarrator/runtime";
import { createRenderPlanStore } from "@studynarrator/rendering";
import { resolveServerRuntimeConfiguration } from "./runtimeConfig.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

export function resolveServerDataDirectory(environment = process.env): string {
  return environment.STUDYNARRATOR_DATA_DIR
    ? resolve(environment.INIT_CWD ?? repositoryRoot, environment.STUDYNARRATOR_DATA_DIR)
    : resolve(repositoryRoot, ".tmp/dev/web");
}

export async function createServerServices(environment = process.env) {
  const runtimeConfiguration = resolveServerRuntimeConfiguration(environment, repositoryRoot);
  const dataDirectory = resolveServerDataDirectory(environment);
  const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
  const cache = createApplicationSpeechCache(dataDirectory);
  const speechCache = createSpeechCacheService(cache);
  let storageFailure: StorageCheck | undefined;
  let persistence: PersistenceClient;
  let repository: DiagnosticRepository;
  let connections;
  let voiceCatalog;
  let scratchpad;
  let projectPreview;
  let renderPlans;
  let renders: RenderService | undefined;
  let scriptGeneration;
  try {
    const openedRepository = await openStudyNarratorRepository({ Database, databasePath });
    repository = openedRepository;
    persistence = createPersistenceService(openedRepository);
    const environmentProfile = reconcileEnvironmentConnectionProfile(openedRepository, environment);
    const context = {
      client: "web" as const,
      nodeVersion: process.versions.node,
      electronVersion: null,
      activeProfileLocked: environmentProfile.activeProfileLocked
    };
    const credentials = createRoutedCredentialStore({ environmentApiKey: environmentProfile.apiKey });
    connections = createConnectionsService({
      repository: openedRepository,
      credentials,
      context
    });
    voiceCatalog = createVoiceCatalogService({ repository: openedRepository, bundledCatalogs: BUNDLED_VOICE_CATALOGS });
    const speech = createCachedSpeechSynthesis({ repository: openedRepository, credentials, cache });
    scratchpad = createScratchpadService({ repository: openedRepository, credentials, cache });
    projectPreview = createProjectPreviewService({ repository: openedRepository, speech });
    const planStore = createRenderPlanStore(resolve(dataDirectory, "render-plans"));
    renderPlans = createRenderPlanService({
      repository: openedRepository,
      cache,
      store: planStore
    });
    scriptGeneration = createScriptGenerationService({ repository: openedRepository });
    renders = await createRenderService({
      repository: openedRepository,
      plans: planStore,
      speech,
      dataDirectory,
      ...(environment.STUDYNARRATOR_FFMPEG_PATH ? { ffmpegPath: environment.STUDYNARRATOR_FFMPEG_PATH } : {})
    });
  } catch (error) {
    if (!(error instanceof MigrationFailureError)) throw error;
    storageFailure = {
      status: "fail",
      code: error.code,
      message: error.message,
      databasePath: error.databasePath,
      recoveryBackupPath: error.backupPath
    };
    persistence = createUnavailablePersistenceService({
      contractVersion: PERSISTENCE_CONTRACT_VERSION,
      state: "unavailable",
      databaseSchemaVersion: error.databaseSchemaVersion,
      targetDatabaseSchemaVersion: DATABASE_SCHEMA_VERSION,
      databasePath: error.databasePath,
      latestBackupPath: error.backupPath,
      code: "MIGRATION_FAILED",
      message: error.message
    });
    repository = { runMarker: () => { throw error; }, close: () => undefined };
  }
  const service = createSystemService({
    repository,
    ...(storageFailure === undefined ? {} : { storageFailure }),
    ffmpegProbe: createFfmpegProbe(
      environment.STUDYNARRATOR_FFMPEG_PATH
        ? { executable: environment.STUDYNARRATOR_FFMPEG_PATH }
        : {}
    )
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
    sourceRevision: runtimeConfiguration.sourceRevision
  };
  return {
    service,
    persistence,
    connections,
    voiceCatalog,
    scratchpad,
    projectPreview,
    renderPlans,
    renders,
    scriptGeneration,
    speechCache,
    context,
    dispose: async () => {
      await renders?.close();
      repository.close();
    }
  };
}
