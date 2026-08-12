import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  createPersistenceService,
  createSystemService,
  createUnavailablePersistenceService,
  type DiagnosticsContext,
  type StorageCheck
} from "@studynarrator/application";
import { MigrationFailureError, openStudyNarratorRepository } from "@studynarrator/persistence";
import { DATABASE_SCHEMA_VERSION, PERSISTENCE_CONTRACT_VERSION, type PersistenceClient } from "@studynarrator/shared-types";
import { createFfmpegProbe } from "@studynarrator/runtime";

export async function createDesktopServices(options: {
  defaultDataDirectory: string;
  environment?: NodeJS.ProcessEnv;
}) {
  const environment = options.environment ?? process.env;
  const dataDirectory = resolve(environment.STUDYNARRATOR_DATA_DIR ?? options.defaultDataDirectory);
  const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
  let storageFailure: StorageCheck | undefined;
  let persistence: PersistenceClient;
  let repository;
  try {
    repository = await openStudyNarratorRepository({ Database, databasePath });
    persistence = createPersistenceService(repository);
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
    client: "electron",
    transport: "ipc",
    runtimeName: "electron",
    runtimeVersion: process.versions.node,
    electronVersion: process.versions.electron ?? null,
    platform: process.platform,
    architecture: process.arch,
    dataDirectory
  };
  return { service, persistence, context };
}
