import { resolve } from "node:path";
import {
  DATABASE_SCHEMA_VERSION,
  PERSISTENCE_CONTRACT_VERSION,
  type PersistenceBackupsClient,
  type PersistenceClient,
  type ProjectPreviewClient,
  type ScratchpadClient,
  type SpeechBackendConnectionClient,
  type SpeechCacheClient,
  type VoiceCatalogClient,
} from "@studynarrator/shared-types";
import {
  createSpeechCacheSweep,
  DATA_DIRECTORY_LAYOUT_VERSION,
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
  type DatabaseConstructor,
  type LayoutStep,
} from "@studynarrator/persistence";
import { createFfmpegProbe, type Logger } from "@studynarrator/runtime";
import {
  createRenderPlanStore,
  createSpeechCacheActivityGate,
  createSpeechCacheSweeper,
  readSpeechCacheMetadata,
  SPEECH_CACHE_SCHEMA_VERSION,
} from "@studynarrator/rendering";
import {
  BUNDLED_VOICE_CATALOGS,
  createApplicationSpeechCache,
  createCachedSpeechSynthesis,
  createConnectionService,
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
  type ScriptGenerationService,
  type StorageCheck,
  type SystemService,
} from "./index.js";

export interface StudyNarratorRuntimeDescriptor {
  client: "web" | "electron";
  distribution: string;
  transport: "rest" | "ipc";
  runtimeName: "node" | "electron";
  runtimeVersion: string;
  electronVersion: string | null;
  sourceRevision: string;
  dataDirectory: string;
  appVersion: string;
}

/**
 * The service graph both clients boot from, in its healthy or degraded form.
 * The healthy-only services (connection, voiceCatalog, scratchpad,
 * projectPreview, renders, scriptGeneration) are undefined whenever
 * persistence could not open; speechCache is always present.
 */
export interface StudyNarratorServices {
  service: SystemService;
  persistence: PersistenceClient;
  connection: SpeechBackendConnectionClient | undefined;
  voiceCatalog: VoiceCatalogClient | undefined;
  scratchpad: ScratchpadClient | undefined;
  projectPreview: ProjectPreviewClient | undefined;
  renders: RenderService | undefined;
  scriptGeneration: ScriptGenerationService | undefined;
  speechCache: SpeechCacheClient;
  context: DiagnosticsContext;
  logger: Logger;
  dispose(): Promise<void>;
}

/**
 * One-time data directory layout steps, in the order that matters. Each
 * step's id is recorded in <dataDir>/manifest.json exactly once, after a
 * successful run (task 10.2); both steps are idempotent on re-run and
 * remove nothing this build or the user still needs.
 */
const SPEECH_CACHE_SWEEP_INTERVAL_MILLISECONDS = 6 * 60 * 60 * 1_000;

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

export async function createStudyNarratorServices(options: {
  Database: DatabaseConstructor;
  descriptor: StudyNarratorRuntimeDescriptor;
  logger: Logger;
  ffmpegPath?: string;
}): Promise<StudyNarratorServices> {
  const descriptor = options.descriptor;
  options.logger.info(
    {
      event: "application-start",
      appVersion: descriptor.appVersion,
      databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
      dataDirectoryLayoutVersion: DATA_DIRECTORY_LAYOUT_VERSION,
      dataDirectory: descriptor.dataDirectory,
      distribution: descriptor.distribution,
    },
    "Application starting",
  );
  const databasePath = resolve(
    descriptor.dataDirectory,
    "studynarrator.sqlite",
  );
  const cacheActivityGate = createSpeechCacheActivityGate();
  const cache = createApplicationSpeechCache(
    descriptor.dataDirectory,
    cacheActivityGate,
  );
  const speechCache = createSpeechCacheService(cache);
  let storageFailure: StorageCheck | undefined;
  let persistence: PersistenceClient;
  let repository: DiagnosticRepository;
  let connection: SpeechBackendConnectionClient | undefined;
  let voiceCatalog: VoiceCatalogClient | undefined;
  let scratchpad: ScratchpadClient | undefined;
  let projectPreview: ProjectPreviewClient | undefined;
  let renders: RenderService | undefined;
  let scriptGeneration: ScriptGenerationService | undefined;
  let speechCacheSweepInterval: NodeJS.Timeout | undefined;
  try {
    await readDataDirectoryManifest(descriptor.dataDirectory, {
      appVersion: descriptor.appVersion,
    });
    await runLayoutSteps(descriptor.dataDirectory, layoutSteps, {
      logger: options.logger,
    });
    const openedRepository = await openStudyNarratorRepository({
      Database: options.Database,
      databasePath,
      logger: options.logger,
    });
    repository = openedRepository;
    const speechCacheSweeper = createSpeechCacheSweeper({
      cache,
      rootDirectory: resolve(descriptor.dataDirectory, "cache/speech"),
      activityGate: cacheActivityGate,
    });
    const runSpeechCacheSweep = async () => {
      try {
        if (openedRepository.listRecoverableRenderJobs().length > 0) return;
        const retention = openedRepository.getRetentionSettings();
        await speechCacheSweeper.sweep({
          ttl: retention.speechCacheTtl,
          sizeCapBytes: retention.speechCacheSizeCapBytes,
          pinnedProjectIds: openedRepository.listPinnedRenderProjectIds(),
        });
      } catch (error) {
        options.logger.warn(
          { event: "speech-cache-sweep-failed", error },
          "Speech cache sweep failed",
        );
      }
    };
    speechCacheSweepInterval = setInterval(
      () => void runSpeechCacheSweep(),
      SPEECH_CACHE_SWEEP_INTERVAL_MILLISECONDS,
    );
    speechCacheSweepInterval.unref();
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
      client: descriptor.client,
      nodeVersion: descriptor.runtimeVersion,
      electronVersion: descriptor.electronVersion,
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
      resolve(descriptor.dataDirectory, "render-plans"),
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
      dataDirectory: descriptor.dataDirectory,
      logger: options.logger,
      activityGate: cacheActivityGate,
      ...(options.ffmpegPath === undefined
        ? {}
        : { ffmpegPath: options.ffmpegPath }),
    });
    void runSpeechCacheSweep();
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
    const availableBackups = await listPersistenceBackups(
      unavailableDatabasePath,
    );
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
          Database: options.Database,
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
      options.ffmpegPath === undefined
        ? {}
        : { executable: options.ffmpegPath },
    ),
  });
  const context: DiagnosticsContext = {
    client: descriptor.client,
    // The descriptor carries the Task 16.1 string contract; current
    // diagnostics accepts the three existing distributions.
    distribution: descriptor.distribution as DiagnosticsContext["distribution"],
    transport: descriptor.transport,
    runtimeName: descriptor.runtimeName,
    runtimeVersion: descriptor.runtimeVersion,
    electronVersion: descriptor.electronVersion,
    platform: process.platform,
    architecture: process.arch,
    dataDirectory: descriptor.dataDirectory,
    sourceRevision: descriptor.sourceRevision,
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
    logger: options.logger,
    dispose: async () => {
      if (speechCacheSweepInterval) clearInterval(speechCacheSweepInterval);
      await renders?.close();
      repository.close();
    },
  };
}
