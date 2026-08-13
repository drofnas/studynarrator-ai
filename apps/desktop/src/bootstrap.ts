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
import { CredentialEncryptionUnavailableError, ElectronCredentialVault, type SafeStorageLike } from "./credentialVault.js";

export function resolveDesktopDataDirectory(defaultDataDirectory: string, environment: NodeJS.ProcessEnv): string {
  return environment.STUDYNARRATOR_DATA_DIR
    ? resolve(environment.INIT_CWD ?? process.cwd(), environment.STUDYNARRATOR_DATA_DIR)
    : resolve(defaultDataDirectory);
}

export async function createDesktopServices(options: {
  defaultDataDirectory: string;
  environment?: NodeJS.ProcessEnv;
  safeStorage?: SafeStorageLike;
}) {
  const environment = options.environment ?? process.env;
  const dataDirectory = resolveDesktopDataDirectory(options.defaultDataDirectory, environment);
  const databasePath = resolve(dataDirectory, "studynarrator.sqlite");
  let storageFailure: StorageCheck | undefined;
  let persistence: PersistenceClient;
  let repository: DiagnosticRepository;
  let connections;
  let voiceCatalog;
  let credentialVault: ElectronCredentialVault | undefined;
  try {
    const openedRepository = await openStudyNarratorRepository({ Database, databasePath });
    repository = openedRepository;
    persistence = createPersistenceService(openedRepository);
    const environmentProfile = reconcileEnvironmentConnectionProfile(openedRepository, environment);
    if (options.safeStorage) {
      credentialVault = new ElectronCredentialVault(options.safeStorage, dataDirectory);
      const references = new Set(openedRepository.listConnectionProfiles()
        .map((profile) => openedRepository.getConnectionCredentialReference(profile.id))
        .filter((reference): reference is string => reference?.startsWith("safe-storage:") === true));
      try {
        await credentialVault.cleanup(references);
      } catch (error) {
        if (!(error instanceof CredentialEncryptionUnavailableError)) throw error;
      }
    }
    const context = {
      client: "electron" as const,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron ?? null,
      activeProfileLocked: environmentProfile.activeProfileLocked
    };
    connections = createConnectionsService({
      repository: openedRepository,
      credentials: createRoutedCredentialStore({ environmentApiKey: environmentProfile.apiKey, vault: credentialVault }),
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
    client: "electron",
    transport: "ipc",
    runtimeName: "electron",
    runtimeVersion: process.versions.node,
    electronVersion: process.versions.electron ?? null,
    platform: process.platform,
    architecture: process.arch,
    dataDirectory
  };
  return { service, persistence, connections, voiceCatalog, credentialVault, context };
}
