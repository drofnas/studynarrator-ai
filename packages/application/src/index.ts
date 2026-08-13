import {
  APPLICATION_VERSION,
  DIAGNOSTICS_SCHEMA_VERSION,
  HealthSchema,
  RuntimeSchema,
  SystemDiagnosticsSchema,
  type Health,
  type RuntimeInfo,
  type SystemDiagnostics
} from "@studynarrator/shared-types";

export type StorageCheck = SystemDiagnostics["checks"]["storage"];
export type FfmpegCheck = SystemDiagnostics["checks"]["ffmpeg"];

export interface DiagnosticRepository {
  runMarker(): StorageCheck;
  close(): void;
}

export interface FfmpegProbe {
  run(): Promise<FfmpegCheck>;
}

export interface DiagnosticsContext {
  client: "web" | "electron";
  transport: "rest" | "ipc";
  runtimeName: "node" | "electron";
  runtimeVersion: string;
  electronVersion: string | null;
  platform: string;
  architecture: string;
  dataDirectory: string;
}

export interface SystemService {
  health(): Health;
  runtime(context: DiagnosticsContext): RuntimeInfo;
  diagnostics(context: DiagnosticsContext): Promise<SystemDiagnostics>;
  close(): void;
}

const STORAGE_FAILURE: StorageCheck = {
  status: "fail",
  code: "STORAGE_UNAVAILABLE",
  message: "StudyNarrator could not write and read its diagnostic database."
};

export function createSystemService(dependencies: {
  repository: DiagnosticRepository;
  ffmpegProbe: FfmpegProbe;
  storageFailure?: StorageCheck;
}): SystemService {
  return {
    health() {
      return HealthSchema.parse({ status: "ok", applicationVersion: APPLICATION_VERSION });
    },
    runtime(context) {
      return RuntimeSchema.parse({
        schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
        applicationVersion: APPLICATION_VERSION,
        runtimeName: context.runtimeName,
        runtimeVersion: context.runtimeVersion,
        electronVersion: context.electronVersion,
        platform: context.platform,
        architecture: context.architecture,
        dataDirectory: context.dataDirectory
      });
    },
    async diagnostics(context) {
      let storage: StorageCheck;
      try {
        storage = dependencies.repository.runMarker();
      } catch {
        storage = dependencies.storageFailure ?? STORAGE_FAILURE;
      }

      const ffmpeg = await dependencies.ffmpegProbe.run();
      const overall = storage.status === "pass" && ffmpeg.status === "pass" ? "pass" : "fail";

      return SystemDiagnosticsSchema.parse({
        schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
        overall,
        client: context.client,
        transport: context.transport,
        runtime: this.runtime(context),
        checks: {
          sharedCore: { status: "pass", marker: "study-narrator-g01" },
          storage,
          ffmpeg
        }
      });
    },
    close() {
      dependencies.repository.close();
    }
  };
}

export {
  PersistenceUnavailableError,
  createPersistenceService,
  createUnavailablePersistenceService,
  type PersistenceRepository
} from "./persistence.js";
export {
  ConnectionConfigurationError,
  ConnectionPolicyError,
  ENVIRONMENT_CREDENTIAL_REFERENCE,
  classifyEndpoint,
  createConnectionsService,
  createRoutedCredentialStore,
  createVoiceCatalogService,
  reconcileEnvironmentConnectionProfile,
  type ConnectionDiagnosticRunner,
  type ConnectionRepository,
  type ConnectionRuntimeContext,
  type CredentialStore
} from "./connections.js";
