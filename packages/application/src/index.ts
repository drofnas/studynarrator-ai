import {
  APPLICATION_VERSION,
  DIAGNOSTICS_SCHEMA_VERSION,
  HealthSchema,
  RuntimeSchema,
  SystemDiagnosticsSchema,
  type Health,
  type RuntimeInfo,
  type SystemDiagnostics,
} from "@studynarrator/shared-types";

export type StorageCheck = SystemDiagnostics["checks"]["storage"];
export type FfmpegCheck = SystemDiagnostics["checks"]["ffmpeg"];

export interface DiagnosticRepository {
  runMarker(): StorageCheck;
  close(): void;
}

interface FfmpegProbe {
  run(): Promise<FfmpegCheck>;
}

export interface DiagnosticsContext {
  client: "web" | "electron";
  distribution: "development-web" | "docker-web" | "electron";
  transport: "rest" | "ipc";
  runtimeName: "node" | "electron";
  runtimeVersion: string;
  electronVersion: string | null;
  platform: string;
  architecture: string;
  dataDirectory: string;
  sourceRevision: string;
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
  message: "StudyNarrator could not write and read its diagnostic database.",
};

export interface BackupUsage {
  count: number;
  totalBytes: number;
  oldestAt: string | null;
}

export function createSystemService(dependencies: {
  repository: DiagnosticRepository;
  ffmpegProbe: FfmpegProbe;
  provideBackupUsage?: () => Promise<BackupUsage>;
  storageFailure?: StorageCheck;
}): SystemService {
  return {
    health() {
      return HealthSchema.parse({
        status: "ok",
        applicationVersion: APPLICATION_VERSION,
      });
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
        dataDirectory: context.dataDirectory,
        distribution: context.distribution,
        sourceRevision: context.sourceRevision,
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
      // Backup usage is disk evidence that must still render when the
      // database will not open, so a missing or unreadable backups directory
      // degrades to zeros rather than failing the diagnostic.
      let backupUsage: BackupUsage = {
        count: 0,
        totalBytes: 0,
        oldestAt: null,
      };
      const provideBackupUsage = dependencies.provideBackupUsage;
      if (provideBackupUsage !== undefined) {
        try {
          backupUsage = await provideBackupUsage();
        } catch {
          // Keep zeros; diagnostics must render in this case.
        }
      }
      const overall =
        storage.status === "pass" && ffmpeg.status === "pass" ? "pass" : "fail";

      return SystemDiagnosticsSchema.parse({
        schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
        overall,
        client: context.client,
        transport: context.transport,
        runtime: this.runtime(context),
        backupCount: backupUsage.count,
        backupTotalBytes: backupUsage.totalBytes,
        oldestBackupAt: backupUsage.oldestAt,
        checks: {
          sharedCore: {
            status: "pass",
            marker: "study-narrator-core",
          },
          storage,
          ffmpeg,
        },
      });
    },
    close() {
      dependencies.repository.close();
    },
  };
}

export {
  PersistenceUnavailableError,
  createPersistenceService,
  createUnavailablePersistenceService,
  type PersistenceRepository,
} from "./persistence.js";
export {
  ConnectionCatalogError,
  classifyEndpoint,
  createConnectionService,
  createVoiceCatalogService,
  type ConnectionCatalogRunner,
  type ConnectionRepository,
} from "./connections.js";
export { APPLICATION_SERVICE_MANIFEST } from "./serviceManifest.js";
export type { StudyNarratorRuntimeDescriptor } from "./composition.js";
export {
  SPEACHES_CACHE_ADAPTER_ID,
  SPEACHES_CACHE_ADAPTER_VERSION,
  createApplicationSpeechCache,
  createCachedSpeechSynthesis,
  createProjectSpeechCacheKeyPlanner,
  createSpeechCacheService,
  type CachedSpeechSynthesis,
  type CachedSpeechSynthesisRunner,
} from "./cachedSpeech.js";
export {
  createProjectPreviewService,
  type ProjectPreviewRepository,
} from "./projectPreview.js";
export {
  createRenderPlanComputer,
  type ComputedRenderPlan,
  type RenderPlanComputer,
  type RenderPlanRepository,
} from "./renderPlan.js";
export {
  createRenderService,
  type RenderRepository,
  type RenderService,
} from "./render.js";
export {
  parseRenderMediaRange,
  type ResolvedRenderMedia,
} from "./renderMedia.js";
export {
  createScriptGenerationService,
  type ScriptGenerationRepository,
  type ScriptGenerationService,
} from "./scriptGeneration.js";
export {
  createScratchpadService,
  type ScratchpadRepository,
} from "./scratchpad.js";
export {
  BUNDLED_VOICE_CATALOGS,
  KOKORO_V1_MODEL_ID,
  KOKORO_V1_VOICE_CATALOG,
  KOKORO_VOICE_CATALOG_ATTRIBUTION,
  KOKORO_VOICE_CATALOG_SOURCE,
} from "./kokoroCatalog.js";
