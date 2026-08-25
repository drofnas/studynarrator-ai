import { randomUUID } from "node:crypto";
import type { LexiconEntry } from "@studynarrator/core";
import {
  DATABASE_SCHEMA_VERSION,
  PERSISTENCE_CONTRACT_VERSION,
  PersistenceReadyStatusSchema,
  type ConnectionTestSummary,
  type CustomGlobalLexiconReplaceInput,
  type GlobalLexiconBuiltInEnabledInput,
  type GlobalLexiconState,
  type IgnoredDiagnosticCollection,
  type PersistenceStatus,
  type ProjectCreateInput,
  type ProjectDetail,
  type ProjectDuplicateInput,
  type ProjectReplaceInput,
  type ProjectSummary,
  type RetentionSettings,
  type RetentionSettingsAuthoring,
  type SystemTimingConfiguration,
  type SpeechBackendConnection,
  type SpeechBackendConnectionAuthoring,
  type VoiceCatalog,
  type VoiceCatalogAuthoring,
  type VoiceTimingCalibration,
  type RenderArtifact,
  type RenderJob,
  type RenderSegment,
} from "@studynarrator/shared-types";
import {
  createConnectionRepository,
  type ConnectionSetupRecord,
} from "./connection.js";
import { PersistenceConflictError } from "./errors.js";
import { createLexiconRepository } from "./lexicon.js";
import {
  migrateDatabase,
  type DatabaseConstructor,
  type DatabaseLike,
  type Migration,
  type PersistenceLogger,
} from "./migrations.js";
import { createProjectRepository } from "./projects.js";
import { createRenderRepository } from "./renders.js";
import type { MarkerRow, VersionRow } from "./rowMappers.js";

const STORAGE_SELF_TEST_KEY = "runtime.storage-self-test";
const STORAGE_SELF_TEST_VALUE = "study-narrator-storage-ok";
const CURRENT_MIGRATION_VERSION = DATABASE_SCHEMA_VERSION;

interface MarkerEvidence {
  status: "pass";
  driver: "better-sqlite3";
  sqliteVersion: string;
  migrationVersion: typeof CURRENT_MIGRATION_VERSION;
  databasePath: string;
  latestBackupPath: string | null;
  markerKey: typeof STORAGE_SELF_TEST_KEY;
  markerValue: typeof STORAGE_SELF_TEST_VALUE;
  createdAt: string;
}

export interface StudyNarratorRepository {
  status(): PersistenceStatus;
  runMarker(): MarkerEvidence;
  listProjects(): ProjectSummary[];
  createProject(input: ProjectCreateInput): ProjectDetail;
  getProject(projectId: string): ProjectDetail;
  replaceProject(
    projectId: string,
    input: ProjectReplaceInput,
    speechCacheKeys?: readonly string[],
  ): ProjectDetail;
  listSpeechCacheDeletionQueue(projectId: string): string[];
  acknowledgeSpeechCacheDeletion(projectId: string, cacheKey: string): void;
  duplicateProject(
    projectId: string,
    input: ProjectDuplicateInput,
  ): ProjectDetail;
  deleteProject(projectId: string): void;
  getSystemPacing(): SystemTimingConfiguration;
  updateSystemPacing(
    input: SystemTimingConfiguration,
  ): SystemTimingConfiguration;
  getIgnoredDiagnostics(): IgnoredDiagnosticCollection;
  replaceIgnoredDiagnostics(
    input: IgnoredDiagnosticCollection,
  ): IgnoredDiagnosticCollection;
  listGlobalLexicon(): LexiconEntry[];
  getGlobalLexiconState(): GlobalLexiconState;
  replaceCustomGlobalLexicon(
    input: CustomGlobalLexiconReplaceInput,
  ): GlobalLexiconState;
  setBuiltInGlobalLexiconEnabled(
    input: GlobalLexiconBuiltInEnabledInput,
  ): GlobalLexiconState;
  reimportBuiltInGlobalLexicon(): GlobalLexiconState;
  getSpeechBackendConnection(): SpeechBackendConnection;
  replaceSpeechBackendConnection(
    input: SpeechBackendConnectionAuthoring,
    suppliedUrlForm: "root" | "v1" | "unconfigured",
  ): SpeechBackendConnection;
  recordConnectionTest(summary: ConnectionTestSummary): SpeechBackendConnection;
  getConnectionSetup(): ConnectionSetupRecord;
  completeConnectionOnboarding(): ConnectionSetupRecord;
  getVoiceCatalogOverrides(modelId: string): VoiceCatalog;
  replaceVoiceCatalogOverrides(input: VoiceCatalogAuthoring): VoiceCatalog;
  getVoiceTimingCalibration(
    modelId: string,
    voiceId: string,
  ): VoiceTimingCalibration | null;
  upsertVoiceTimingCalibration(
    calibration: VoiceTimingCalibration,
  ): VoiceTimingCalibration;
  getRetentionSettings(): RetentionSettings;
  updateRetentionSettings(
    settings: RetentionSettingsAuthoring,
  ): RetentionSettings;
  createRenderJob(job: RenderJob, segments: RenderSegment[]): RenderJob;
  getRenderJob(renderId: string): RenderJob;
  listRenderJobs(projectId: string): RenderJob[];
  listRecoverableRenderJobs(): RenderJob[];
  listRetentionRenderJobs(): RenderJob[];
  listPinnedRenderProjectIds(): string[];
  clearRenderMedia(renderId: string): void;
  updateRenderJob(job: RenderJob): RenderJob;
  updateRenderSegment(
    segment: RenderSegment,
    audioPath?: string | null,
  ): RenderSegment;
  listRenderSegments(renderId: string): RenderSegment[];
  getRenderSegmentPath(
    renderId: string,
    ordinal: number,
  ): { segment: RenderSegment; path: string | null };
  replaceRenderArtifacts(
    renderId: string,
    artifacts: Array<RenderArtifact & { path: string }>,
  ): RenderArtifact[];
  listRenderArtifacts(renderId: string): RenderArtifact[];
  getRenderArtifactPath(artifactId: string): {
    artifact: RenderArtifact;
    path: string;
  };
  close(): void;
}

function createRepository(options: {
  database: DatabaseLike;
  databasePath: string;
  databaseSchemaVersion: number;
  latestBackupPath: string | null;
  now: () => Date;
  idFactory: () => string;
}): StudyNarratorRepository {
  const { database } = options;
  let closed = false;

  const assertOpen = () => {
    if (closed) throw new Error("Persistence repository is closed.");
  };

  const transaction = <T>(operation: () => T): T => {
    database.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      database.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        database.exec("ROLLBACK;");
      } catch {
        /* transaction did not start */
      }
      throw error;
    }
  };

  const nextId = (): string => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = options.idFactory();
      if (
        !database
          .prepare(
            "SELECT id FROM projects WHERE id = ? UNION ALL SELECT id FROM lexicon_entries WHERE id = ?",
          )
          .get(candidate, candidate)
      )
        return candidate;
    }
    throw new PersistenceConflictError(
      "StudyNarrator could not allocate a collision-free durable ID.",
    );
  };

  const lexicon = createLexiconRepository({
    database,
    now: options.now,
    assertOpen,
    transaction,
    nextId,
  });
  const projects = createProjectRepository({
    database,
    now: options.now,
    assertOpen,
    transaction,
    nextId,
    readLexicon: lexicon.readLexicon,
    replaceLexicon: lexicon.replaceLexicon,
  });
  const connection = createConnectionRepository({
    database,
    now: options.now,
    assertOpen,
    transaction,
  });
  const renders = createRenderRepository({ database, assertOpen, transaction });

  return {
    status() {
      assertOpen();
      return PersistenceReadyStatusSchema.parse({
        contractVersion: PERSISTENCE_CONTRACT_VERSION,
        state: "ready",
        databaseSchemaVersion: options.databaseSchemaVersion,
        targetDatabaseSchemaVersion: DATABASE_SCHEMA_VERSION,
        databasePath: options.databasePath,
        latestBackupPath: options.latestBackupPath,
      });
    },
    runMarker() {
      assertOpen();
      const timestamp = options.now().toISOString();
      database
        .prepare("DELETE FROM diagnostic_kv WHERE key <> ?")
        .run(STORAGE_SELF_TEST_KEY);
      database
        .prepare(
          "INSERT OR IGNORE INTO diagnostic_kv (key, value, created_at) VALUES (?, ?, ?)",
        )
        .run(STORAGE_SELF_TEST_KEY, STORAGE_SELF_TEST_VALUE, timestamp);
      const row = database
        .prepare(
          "SELECT key, value, created_at FROM diagnostic_kv WHERE key = ?",
        )
        .get(STORAGE_SELF_TEST_KEY) as MarkerRow | undefined;
      const version = database
        .prepare("SELECT sqlite_version() AS version")
        .get() as VersionRow | undefined;
      if (!row || !version?.version)
        throw new Error("Diagnostic storage verification failed");
      return {
        status: "pass",
        driver: "better-sqlite3",
        sqliteVersion: version.version,
        migrationVersion: CURRENT_MIGRATION_VERSION,
        databasePath: options.databasePath,
        latestBackupPath: options.latestBackupPath,
        markerKey: STORAGE_SELF_TEST_KEY,
        markerValue: STORAGE_SELF_TEST_VALUE,
        createdAt: row.created_at,
      };
    },
    ...projects,
    ...lexicon,
    ...connection,
    ...renders,
    close() {
      if (!closed) {
        database.close();
        closed = true;
      }
    },
  };
}

export async function openStudyNarratorRepository(options: {
  Database: DatabaseConstructor;
  databasePath: string;
  now?: () => Date;
  idFactory?: () => string;
  migrations?: readonly Migration[];
  logger?: PersistenceLogger;
}): Promise<StudyNarratorRepository> {
  const now = options.now ?? (() => new Date());
  const migrated = await migrateDatabase({
    Database: options.Database,
    databasePath: options.databasePath,
    now,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.migrations === undefined
      ? {}
      : { migrations: options.migrations }),
  });
  return createRepository({
    database: migrated.database,
    databasePath: migrated.databasePath,
    databaseSchemaVersion: migrated.databaseSchemaVersion,
    latestBackupPath: migrated.backupPath,
    now,
    idFactory: options.idFactory ?? randomUUID,
  });
}
