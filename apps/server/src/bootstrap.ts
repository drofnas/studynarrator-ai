import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  createConnectionsService,
  createPersistenceService,
  createRoutedCredentialStore,
  createSystemService,
  createUnavailablePersistenceService,
  createVoiceCatalogService,
  reconcileEnvironmentConnectionProfile,
  type DiagnosticsContext,
  type DiagnosticRepository,
  type StorageCheck
} from "@studynarrator/application";
import { MigrationFailureError, openStudyNarratorRepository } from "@studynarrator/persistence";
import { DATABASE_SCHEMA_VERSION, PERSISTENCE_CONTRACT_VERSION, type PersistenceClient } from "@studynarrator/shared-types";
import { createFfmpegProbe } from "@studynarrator/runtime";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

export function resolveServerDataDirectory(environment = process.env): string {
  return environment.STUDYNARRATOR_DATA_DIR
    ? resolve(environment.INIT_CWD ?? repositoryRoot, environment.STUDYNARRATOR_DATA_DIR)
    : resolve(repositoryRoot, ".tmp/gates/G01/web");
}

export async function createServerServices(environment = process.env) {
  const dataDirectory = resolveServerDataDirectory(environment);
  const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
  let storageFailure: StorageCheck | undefined;
  let persistence: PersistenceClient;
  let repository: DiagnosticRepository;
  let connections;
  let voiceCatalog;
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
    connections = createConnectionsService({
      repository: openedRepository,
      credentials: createRoutedCredentialStore({ environmentApiKey: environmentProfile.apiKey }),
      context
    });
    voiceCatalog = createVoiceCatalogService({ repository: openedRepository, bundledCatalogs: new Map() });
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
    transport: "rest",
    runtimeName: "node",
    runtimeVersion: process.versions.node,
    electronVersion: null,
    platform: process.platform,
    architecture: process.arch,
    dataDirectory
  };
  return { service, persistence, connections, voiceCatalog, context };
}
