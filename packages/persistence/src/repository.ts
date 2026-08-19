import { createHash, randomUUID } from "node:crypto";
import {
  LexiconEntrySchema,
  type LexiconEntry,
  type LexiconEntryAuthoring,
} from "@studynarrator/core";
import {
  ConnectionTestSummarySchema,
  CONNECTION_DIAGNOSTIC_SCHEMA_VERSION,
  DATABASE_SCHEMA_VERSION,
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PERSISTENCE_CONTRACT_VERSION,
  RENDER_CONTRACT_VERSION,
  PersistenceReadyStatusSchema,
  ProjectCreateInputSchema,
  ProjectDetailSchema,
  ProjectDuplicateInputSchema,
  ProjectIdSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  SystemTimingConfigurationSchema,
  SpeechBackendConnectionAuthoringSchema,
  SpeechBackendConnectionSchema,
  VoiceCatalogSchema,
  RenderArtifactCollectionSchema,
  RenderArtifactSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  RenderSegmentSchema,
  type ConnectionTestSummary,
  type GlobalLexiconReplaceInput,
  type IgnoredDiagnosticCollection,
  type PersistenceStatus,
  type ProjectCreateInput,
  type ProjectDetail,
  type ProjectDuplicateInput,
  type ProjectReplaceInput,
  type ProjectSummary,
  type SystemTimingConfiguration,
  type SystemTransitionPauseConfiguration,
  type SystemTransitionPauseSetting,
  type SpeechBackendConnection,
  type SpeechBackendConnectionAuthoring,
  type VoiceCatalog,
  type VoiceCatalogAuthoring,
  type RenderArtifact,
  type RenderJob,
  type RenderSegment,
} from "@studynarrator/shared-types";
import {
  PersistenceConflictError,
  PersistenceNotFoundError,
} from "./errors.js";
import {
  migrateDatabase,
  type DatabaseConstructor,
  type DatabaseLike,
  type Migration,
} from "./migrations.js";

const STORAGE_SELF_TEST_KEY = "runtime.storage-self-test";
const STORAGE_SELF_TEST_VALUE = "study-narrator-storage-ok";
const CURRENT_MIGRATION_VERSION = DATABASE_SCHEMA_VERSION;

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  script_source: string;
  script_hash: string;
  created_at: string;
  updated_at: string;
}

interface ProjectSummaryRow extends Pick<
  ProjectRow,
  "id" | "name" | "description" | "script_hash" | "created_at" | "updated_at"
> {
  script_line_count: number | null;
  audio_duration_ms: number | null;
}

interface SpeakerRow {
  speaker_id: string;
  display_name: string;
  voice_id: string | null;
  speed: number;
  gain_db: number;
  role_description: string;
  sample_text: string;
}

interface PauseRow {
  pause_id: "pause_short" | "pause_medium" | "pause_long";
  duration_ms: number;
  description: string;
}

interface SystemTimingRow {
  paragraph_transition_mode: "none" | "preset" | "duration";
  paragraph_transition_pause_id: string | null;
  paragraph_transition_duration_ms: number | null;
  speaker_change_transition_mode: "none" | "preset" | "duration";
  speaker_change_transition_pause_id: string | null;
  speaker_change_transition_duration_ms: number | null;
  section_transition_mode: "none" | "preset" | "duration";
  section_transition_pause_id: string | null;
  section_transition_duration_ms: number | null;
}

interface LexiconRow {
  id: string;
  scope: "global" | "project";
  entry_type: "exactTerm" | "exactPhrase" | "namedSense";
  display_text: string;
  sense_id: string | null;
  spoken_text: string;
  case_sensitive: number;
  whole_word: number;
  priority: number;
  enabled: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface ConnectionRow {
  backend_id: "speaches";
  base_url: string | null;
  default_model_id: string | null;
  default_voice_id: string | null;
  timeout_seconds: number;
  retry_count: number;
  response_format: "wav";
  supplied_url_form: "root" | "v1" | "unconfigured";
  last_tested_at: string | null;
  last_successful_test_at: string | null;
  last_test_summary_json: string | null;
  created_at: string;
  updated_at: string;
}

interface MarkerRow {
  key: string;
  value: string;
  created_at: string;
}
interface VersionRow {
  version: string;
}

interface ConnectionSetupRecord {
  onboardingCompletedAt: string | null;
}

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
  replaceGlobalLexicon(input: GlobalLexiconReplaceInput): LexiconEntry[];
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
  createRenderJob(job: RenderJob, segments: RenderSegment[]): RenderJob;
  getRenderJob(renderId: string): RenderJob;
  listRenderJobs(projectId: string): RenderJob[];
  listRecoverableRenderJobs(): RenderJob[];
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

interface RenderJobRow {
  id: string;
  project_id: string;
  // Vestigial. Render plans are computed per render and no longer have a
  // user-visible identity, so this value is generated and never looked up.
  // Scheduled for removal; see docs/technical-debt.md.
  plan_id: string;
  retry_of_render_id: string | null;
  state: RenderJob["state"];
  progress_json: string;
  error_json: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface RenderArtifactRow {
  id: string;
  render_id: string;
  artifact_type: RenderArtifact["type"];
  file_name: string;
  path: string;
  size_bytes: number;
  checksum: string;
  duration_ms: number | null;
  created_at: string;
}

interface RenderSegmentRow {
  render_id: string;
  ordinal: number;
  segment_type: RenderSegment["type"];
  state: RenderSegment["state"];
  cache_status: RenderSegment["cacheStatus"];
  audio_duration_ms: number | null;
  error_json: string | null;
  audio_file_name: string | null;
  audio_path: string | null;
  audio_size_bytes: number | null;
  audio_checksum: string | null;
}

function renderJobFromRow(row: RenderJobRow): RenderJob {
  return RenderJobSchema.parse({
    contractVersion: RENDER_CONTRACT_VERSION,
    id: row.id,
    projectId: row.project_id,
    planId: row.plan_id,
    retryOfRenderId: row.retry_of_render_id,
    state: row.state,
    progress: JSON.parse(row.progress_json) as unknown,
    error:
      row.error_json === null ? null : (JSON.parse(row.error_json) as unknown),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
}

function renderArtifactFromRow(row: RenderArtifactRow): RenderArtifact {
  return RenderArtifactSchema.parse({
    contractVersion: RENDER_CONTRACT_VERSION,
    id: row.id,
    renderId: row.render_id,
    type: row.artifact_type,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    checksum: row.checksum,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  });
}

function renderSegmentFromRow(row: RenderSegmentRow): RenderSegment {
  return RenderSegmentSchema.parse({
    renderId: row.render_id,
    ordinal: row.ordinal,
    type: row.segment_type,
    state: row.state,
    cacheStatus: row.cache_status,
    audioDurationMs: row.audio_duration_ms,
    audioFileName: row.audio_file_name,
    audioSizeBytes: row.audio_size_bytes,
    audioChecksum: row.audio_checksum,
    error:
      row.error_json === null ? null : (JSON.parse(row.error_json) as unknown),
  });
}

function scriptHash(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function booleanFromSql(value: number): boolean {
  return value === 1;
}
function booleanToSql(value: boolean): number {
  return value ? 1 : 0;
}

function transitionFromRow(
  mode: SystemTimingRow["paragraph_transition_mode"],
  pauseId: string | null,
  durationMs: number | null,
): SystemTransitionPauseSetting {
  if (mode === "none") return { mode };
  if (
    mode === "preset" &&
    (pauseId === "pause_short" ||
      pauseId === "pause_medium" ||
      pauseId === "pause_long")
  )
    return { mode, pauseId };
  if (mode === "duration" && durationMs !== null) return { mode, durationMs };
  throw new Error("Stored transition pause configuration is invalid.");
}

function transitionParameters(
  setting: SystemTransitionPauseSetting,
): [string, string | null, number | null] {
  if (setting.mode === "none") return [setting.mode, null, null];
  if (setting.mode === "preset") return [setting.mode, setting.pauseId, null];
  return [setting.mode, null, setting.durationMs];
}

function transitionConfiguration(
  row: SystemTimingRow,
): SystemTransitionPauseConfiguration {
  return {
    paragraph: transitionFromRow(
      row.paragraph_transition_mode,
      row.paragraph_transition_pause_id,
      row.paragraph_transition_duration_ms,
    ),
    speakerChange: transitionFromRow(
      row.speaker_change_transition_mode,
      row.speaker_change_transition_pause_id,
      row.speaker_change_transition_duration_ms,
    ),
    section: transitionFromRow(
      row.section_transition_mode,
      row.section_transition_pause_id,
      row.section_transition_duration_ms,
    ),
  };
}

function lexiconFromRow(row: LexiconRow): LexiconEntry {
  return LexiconEntrySchema.parse({
    id: row.id,
    scope: row.scope,
    entryType: row.entry_type,
    displayText: row.display_text,
    ...(row.sense_id === null ? {} : { senseId: row.sense_id }),
    spokenText: row.spoken_text,
    caseSensitive: booleanFromSql(row.case_sensitive),
    wholeWord: booleanFromSql(row.whole_word),
    priority: row.priority,
    enabled: booleanFromSql(row.enabled),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function connectionFromRow(row: ConnectionRow): SpeechBackendConnection {
  return SpeechBackendConnectionSchema.parse({
    backendId: row.backend_id,
    baseUrl: row.base_url,
    configured:
      row.base_url !== null &&
      row.default_model_id !== null &&
      row.default_voice_id !== null,
    defaultModelId: row.default_model_id,
    defaultVoiceId: row.default_voice_id,
    timeoutSeconds: row.timeout_seconds,
    retryCount: row.retry_count,
    responseFormat: row.response_format,
    suppliedUrlForm: row.supplied_url_form,
    lastTestedAt: row.last_tested_at,
    lastSuccessfulTestAt: row.last_successful_test_at,
    lastTestSummary:
      row.last_test_summary_json === null
        ? null
        : (JSON.parse(row.last_test_summary_json) as unknown),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function lexiconBehaviorMatches(
  existing: LexiconEntry,
  authored: LexiconEntryAuthoring,
): boolean {
  return (
    existing.scope === authored.scope &&
    existing.entryType === authored.entryType &&
    existing.displayText === authored.displayText &&
    existing.senseId === authored.senseId &&
    existing.spokenText === authored.spokenText &&
    existing.caseSensitive === authored.caseSensitive &&
    existing.wholeWord === authored.wholeWord &&
    existing.priority === authored.priority &&
    existing.enabled === authored.enabled &&
    existing.notes === authored.notes
  );
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

  const readLexicon = (
    scope: "global" | "project",
    projectId: string | null,
  ): LexiconEntry[] => {
    const rows =
      scope === "global"
        ? database
            .prepare(
              "SELECT * FROM lexicon_entries WHERE scope = 'global' ORDER BY ordinal ASC, id ASC",
            )
            .all()
        : database
            .prepare(
              "SELECT * FROM lexicon_entries WHERE scope = 'project' AND project_id = ? ORDER BY ordinal ASC, id ASC",
            )
            .all(projectId);
    return rows.map((row) => lexiconFromRow(row as LexiconRow));
  };

  const replaceLexicon = (
    scope: "global" | "project",
    projectId: string | null,
    authoredEntries: readonly LexiconEntryAuthoring[],
    timestamp: string,
  ): LexiconEntry[] => {
    const existing = readLexicon(scope, projectId);
    const existingById = new Map(existing.map((entry) => [entry.id, entry]));
    const normalized = authoredEntries.map((authored) => {
      const id = authored.id ?? nextId();
      const owner = database
        .prepare("SELECT scope, project_id FROM lexicon_entries WHERE id = ?")
        .get(id) as { scope: string; project_id: string | null } | undefined;
      if (owner && (owner.scope !== scope || owner.project_id !== projectId)) {
        throw new PersistenceConflictError(
          `Lexicon entry ID ${id} belongs to another scope.`,
        );
      }
      const prior = existingById.get(id);
      return LexiconEntrySchema.parse({
        ...authored,
        id,
        createdAt: prior?.createdAt ?? timestamp,
        updatedAt:
          prior && lexiconBehaviorMatches(prior, authored)
            ? prior.updatedAt
            : timestamp,
      });
    });

    if (scope === "global")
      database
        .prepare("DELETE FROM lexicon_entries WHERE scope = 'global'")
        .run();
    else
      database
        .prepare(
          "DELETE FROM lexicon_entries WHERE scope = 'project' AND project_id = ?",
        )
        .run(projectId);

    const insert = database.prepare(`
      INSERT INTO lexicon_entries (
        id, scope, project_id, ordinal, entry_type, display_text, sense_id, spoken_text,
        case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    normalized.forEach((entry, ordinal) =>
      insert.run(
        entry.id,
        entry.scope,
        projectId,
        ordinal,
        entry.entryType,
        entry.displayText,
        entry.senseId ?? null,
        entry.spokenText,
        booleanToSql(entry.caseSensitive),
        booleanToSql(entry.wholeWord),
        entry.priority,
        booleanToSql(entry.enabled),
        entry.notes,
        entry.createdAt,
        entry.updatedAt,
      ),
    );
    return normalized;
  };

  const getProject = (projectIdInput: string): ProjectDetail => {
    assertOpen();
    const projectId = ProjectIdSchema.parse(projectIdInput);
    const row = database
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(projectId) as ProjectRow | undefined;
    if (!row)
      throw new PersistenceNotFoundError(`Project ${projectId} was not found.`);
    const speakers = database
      .prepare(
        "SELECT * FROM speaker_mappings WHERE project_id = ? ORDER BY ordinal ASC, speaker_id ASC",
      )
      .all(projectId) as SpeakerRow[];
    return ProjectDetailSchema.parse({
      contractVersion: PERSISTENCE_CONTRACT_VERSION,
      id: row.id,
      name: row.name,
      description: row.description,
      scriptSource: row.script_source,
      scriptHash: row.script_hash,
      speakerMappings: speakers.map((speaker) => ({
        speakerId: speaker.speaker_id,
        displayName: speaker.display_name,
        voiceId: speaker.voice_id,
        speed: speaker.speed,
        gainDb: speaker.gain_db,
        roleDescription: speaker.role_description,
        sampleText: speaker.sample_text,
      })),
      lexiconEntries: readLexicon("project", projectId),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  };

  const getSpeechBackendConnection = (): SpeechBackendConnection => {
    assertOpen();
    const row = database
      .prepare("SELECT * FROM speech_backend_connection WHERE singleton_id = 1")
      .get() as ConnectionRow | undefined;
    if (!row)
      throw new PersistenceNotFoundError(
        "The Speaches connection was not found.",
      );
    return connectionFromRow(row);
  };

  const getConnectionSetup = (): ConnectionSetupRecord => {
    assertOpen();
    const row = database
      .prepare(
        "SELECT onboarding_completed_at FROM connection_setup WHERE singleton_id = 1",
      )
      .get() as { onboarding_completed_at: string | null };
    return { onboardingCompletedAt: row.onboarding_completed_at };
  };

  const getVoiceCatalogOverrides = (modelId: string): VoiceCatalog => {
    assertOpen();
    const rows = database
      .prepare(
        `
      SELECT voice_id, label, enabled, favorite, language, locale, accent, category, style, sample_text
      FROM voice_catalog_overrides WHERE model_id = ? ORDER BY ordinal ASC, voice_id ASC
    `,
      )
      .all(modelId) as Array<{
      voice_id: string;
      label: string;
      enabled: number;
      favorite: number;
      language: string | null;
      locale: string | null;
      accent: string | null;
      category: string | null;
      style: string | null;
      sample_text: string | null;
    }>;
    return VoiceCatalogSchema.parse({
      schemaVersion: CONNECTION_DIAGNOSTIC_SCHEMA_VERSION,
      modelId,
      entries: rows.map((row) => ({
        voiceId: row.voice_id,
        label: row.label,
        enabled: booleanFromSql(row.enabled),
        favorite: booleanFromSql(row.favorite),
        language: row.language,
        locale: row.locale,
        accent: row.accent,
        category: row.category,
        style: row.style,
        sampleText: row.sample_text,
      })),
    });
  };

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
    listProjects() {
      assertOpen();
      const rows = database
        .prepare(
          `
        SELECT
          projects.id,
          projects.name,
          projects.description,
          projects.script_hash,
          CASE
            WHEN projects.script_source = '' THEN NULL
            ELSE length(projects.script_source) - length(replace(projects.script_source, char(10), '')) + 1
          END AS script_line_count,
          (
            SELECT render_artifacts.duration_ms
            FROM render_jobs
            JOIN render_artifacts ON render_artifacts.render_id = render_jobs.id
            WHERE render_jobs.project_id = projects.id
              AND render_jobs.state = 'complete'
              AND render_artifacts.artifact_type = 'mp3'
              AND render_artifacts.duration_ms IS NOT NULL
            ORDER BY render_jobs.created_at DESC, render_jobs.id ASC
            LIMIT 1
          ) AS audio_duration_ms,
          projects.created_at,
          projects.updated_at
        FROM projects
        ORDER BY projects.updated_at DESC, projects.id ASC
      `,
        )
        .all() as ProjectSummaryRow[];
      return ProjectSummaryCollectionSchema.parse(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          scriptHash: row.script_hash,
          scriptLineCount: row.script_line_count,
          audioDurationMs: row.audio_duration_ms,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      );
    },
    createProject(inputValue) {
      assertOpen();
      const input = ProjectCreateInputSchema.parse(inputValue);
      const id = ProjectIdSchema.parse(nextId());
      const timestamp = options.now().toISOString();
      transaction(() => {
        database
          .prepare(
            `
          INSERT INTO projects (
            id, name, description, script_source, script_hash, created_at, updated_at
          ) VALUES (?, ?, ?, '', ?, ?, ?)
        `,
          )
          .run(
            id,
            input.name,
            input.description,
            scriptHash(""),
            timestamp,
            timestamp,
          );
      });
      return getProject(id);
    },
    getProject,
    replaceProject(projectIdInput, inputValue, speechCacheKeys) {
      assertOpen();
      const projectId = ProjectIdSchema.parse(projectIdInput);
      const input = ProjectReplaceInputSchema.parse(inputValue);
      const prior = getProject(projectId);
      const timestamp = options.now().toISOString();
      transaction(() => {
        const result = database
          .prepare(
            `
          UPDATE projects SET name = ?, description = ?, script_source = ?, script_hash = ?, updated_at = ? WHERE id = ?
        `,
          )
          .run(
            input.name,
            input.description,
            input.scriptSource,
            scriptHash(input.scriptSource),
            timestamp,
            projectId,
          );
        if (Number(result.changes ?? 0) !== 1)
          throw new PersistenceNotFoundError(
            `Project ${projectId} was not found.`,
          );
        database
          .prepare("DELETE FROM speaker_mappings WHERE project_id = ?")
          .run(projectId);
        const insertSpeaker = database.prepare(`
          INSERT INTO speaker_mappings (
            project_id, speaker_id, ordinal, display_name, voice_id, speed, gain_db, role_description, sample_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        input.speakerMappings.forEach((speaker, ordinal) =>
          insertSpeaker.run(
            projectId,
            speaker.speakerId,
            ordinal,
            speaker.displayName,
            speaker.voiceId,
            speaker.speed,
            speaker.gainDb,
            speaker.roleDescription,
            speaker.sampleText,
          ),
        );
        replaceLexicon("project", projectId, input.lexiconEntries, timestamp);
        if (speechCacheKeys !== undefined) {
          const desired = [...new Set(speechCacheKeys)];
          if (desired.some((key) => !/^[a-f0-9]{64}$/u.test(key)))
            throw new Error("Project speech cache key is invalid.");
          const prior = (
            database
              .prepare(
                "SELECT cache_key FROM project_speech_cache_keys WHERE project_id = ?",
              )
              .all(projectId) as Array<{ cache_key: string }>
          ).map(({ cache_key }) => cache_key);
          const desiredSet = new Set(desired);
          const queue = database.prepare(
            "INSERT OR IGNORE INTO speech_cache_deletion_queue (project_id, cache_key, queued_at) VALUES (?, ?, ?)",
          );
          for (const key of prior)
            if (!desiredSet.has(key)) queue.run(projectId, key, timestamp);
          database
            .prepare(
              "DELETE FROM project_speech_cache_keys WHERE project_id = ?",
            )
            .run(projectId);
          const insertKey = database.prepare(
            "INSERT INTO project_speech_cache_keys (project_id, cache_key) VALUES (?, ?)",
          );
          for (const key of desired) insertKey.run(projectId, key);
          const revive = database.prepare(
            "DELETE FROM speech_cache_deletion_queue WHERE project_id = ? AND cache_key = ?",
          );
          for (const key of desired) revive.run(projectId, key);
        }
      });
      const updated = getProject(projectId);
      if (updated.createdAt !== prior.createdAt)
        throw new Error("Project creation timestamp changed unexpectedly.");
      return updated;
    },
    listSpeechCacheDeletionQueue(projectIdInput) {
      assertOpen();
      const projectId = ProjectIdSchema.parse(projectIdInput);
      return (
        database
          .prepare(
            "SELECT cache_key FROM speech_cache_deletion_queue WHERE project_id = ? ORDER BY queued_at, cache_key",
          )
          .all(projectId) as Array<{ cache_key: string }>
      ).map(({ cache_key }) => cache_key);
    },
    acknowledgeSpeechCacheDeletion(projectIdInput, cacheKey) {
      assertOpen();
      const projectId = ProjectIdSchema.parse(projectIdInput);
      if (!/^[a-f0-9]{64}$/u.test(cacheKey))
        throw new Error("Speech cache key is invalid.");
      database
        .prepare(
          "DELETE FROM speech_cache_deletion_queue WHERE project_id = ? AND cache_key = ?",
        )
        .run(projectId, cacheKey);
    },
    duplicateProject(projectIdInput, inputValue) {
      assertOpen();
      const projectId = ProjectIdSchema.parse(projectIdInput);
      const input = ProjectDuplicateInputSchema.parse(inputValue);
      const source = getProject(projectId);
      const duplicateId = ProjectIdSchema.parse(nextId());
      const timestamp = options.now().toISOString();
      transaction(() => {
        database
          .prepare(
            `
          INSERT INTO projects (
            id, name, description, script_source, script_hash, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            duplicateId,
            input.name,
            source.description,
            source.scriptSource,
            source.scriptHash,
            timestamp,
            timestamp,
          );
        const insertSpeaker = database.prepare(`
          INSERT INTO speaker_mappings (
            project_id, speaker_id, ordinal, display_name, voice_id, speed, gain_db, role_description, sample_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        source.speakerMappings.forEach((speaker, ordinal) =>
          insertSpeaker.run(
            duplicateId,
            speaker.speakerId,
            ordinal,
            speaker.displayName,
            speaker.voiceId,
            speaker.speed,
            speaker.gainDb,
            speaker.roleDescription,
            speaker.sampleText,
          ),
        );
        replaceLexicon(
          "project",
          duplicateId,
          source.lexiconEntries.map((entry) => ({
            scope: entry.scope,
            entryType: entry.entryType,
            displayText: entry.displayText,
            ...(entry.senseId === undefined ? {} : { senseId: entry.senseId }),
            spokenText: entry.spokenText,
            caseSensitive: entry.caseSensitive,
            wholeWord: entry.wholeWord,
            priority: entry.priority,
            enabled: entry.enabled,
            notes: entry.notes,
          })),
          timestamp,
        );
      });
      return getProject(duplicateId);
    },
    deleteProject(projectIdInput) {
      assertOpen();
      const projectId = ProjectIdSchema.parse(projectIdInput);
      const result = database
        .prepare("DELETE FROM projects WHERE id = ?")
        .run(projectId);
      if (Number(result.changes ?? 0) !== 1)
        throw new PersistenceNotFoundError(
          `Project ${projectId} was not found.`,
        );
    },
    getSystemPacing() {
      assertOpen();
      const row = database
        .prepare("SELECT * FROM system_timing WHERE singleton_id = 1")
        .get() as SystemTimingRow;
      const pauses = database
        .prepare(
          "SELECT pause_id, duration_ms, description FROM system_pause_presets ORDER BY ordinal ASC",
        )
        .all() as PauseRow[];
      return SystemTimingConfigurationSchema.parse({
        pausePresets: pauses.map((pause) => ({
          pauseId: pause.pause_id,
          durationMs: pause.duration_ms,
          description: pause.description,
        })),
        transitionPauses: transitionConfiguration(row),
      });
    },
    updateSystemPacing(inputValue) {
      assertOpen();
      const input = SystemTimingConfigurationSchema.parse(inputValue);
      const paragraph = transitionParameters(input.transitionPauses.paragraph);
      const speakerChange = transitionParameters(
        input.transitionPauses.speakerChange,
      );
      const section = transitionParameters(input.transitionPauses.section);
      transaction(() => {
        database
          .prepare(
            `
          UPDATE system_timing SET
            paragraph_transition_mode = ?, paragraph_transition_pause_id = ?, paragraph_transition_duration_ms = ?,
            speaker_change_transition_mode = ?, speaker_change_transition_pause_id = ?, speaker_change_transition_duration_ms = ?,
            section_transition_mode = ?, section_transition_pause_id = ?, section_transition_duration_ms = ?, updated_at = ?
          WHERE singleton_id = 1
        `,
          )
          .run(
            ...paragraph,
            ...speakerChange,
            ...section,
            options.now().toISOString(),
          );
        database.prepare("DELETE FROM system_pause_presets").run();
        const insert = database.prepare(
          "INSERT INTO system_pause_presets (pause_id, ordinal, duration_ms, description) VALUES (?, ?, ?, ?)",
        );
        input.pausePresets.forEach((pause, ordinal) =>
          insert.run(
            pause.pauseId,
            ordinal,
            pause.durationMs,
            pause.description,
          ),
        );
      });
      return this.getSystemPacing();
    },
    getIgnoredDiagnostics() {
      assertOpen();
      return IgnoredDiagnosticCollectionSchema.parse(
        database
          .prepare(
            "SELECT code, pattern FROM ignored_diagnostic_patterns ORDER BY ordinal ASC, code ASC, pattern ASC",
          )
          .all(),
      );
    },
    replaceIgnoredDiagnostics(inputValue) {
      assertOpen();
      const input = IgnoredDiagnosticCollectionSchema.parse(inputValue);
      const timestamp = options.now().toISOString();
      transaction(() => {
        database.prepare("DELETE FROM ignored_diagnostic_patterns").run();
        const insert = database.prepare(
          "INSERT INTO ignored_diagnostic_patterns (code, pattern, ordinal, created_at) VALUES (?, ?, ?, ?)",
        );
        input.forEach((item, ordinal) =>
          insert.run(item.code, item.pattern, ordinal, timestamp),
        );
      });
      return this.getIgnoredDiagnostics();
    },
    listGlobalLexicon() {
      assertOpen();
      return GlobalLexiconEntryCollectionSchema.parse(
        readLexicon("global", null),
      );
    },
    replaceGlobalLexicon(inputValue) {
      assertOpen();
      const input = GlobalLexiconReplaceInputSchema.parse(inputValue);
      const result = transaction(() =>
        replaceLexicon("global", null, input, options.now().toISOString()),
      );
      return GlobalLexiconEntryCollectionSchema.parse(result);
    },
    getSpeechBackendConnection,
    replaceSpeechBackendConnection(inputValue, suppliedUrlForm) {
      assertOpen();
      const input = SpeechBackendConnectionAuthoringSchema.parse(inputValue);
      const existing = getSpeechBackendConnection();
      const unchanged =
        existing.baseUrl === input.baseUrl &&
        existing.defaultModelId === input.defaultModelId &&
        existing.defaultVoiceId === input.defaultVoiceId &&
        existing.timeoutSeconds === input.timeoutSeconds &&
        existing.retryCount === input.retryCount &&
        existing.suppliedUrlForm === suppliedUrlForm;
      database
        .prepare(
          `
        UPDATE speech_backend_connection SET base_url = ?, default_model_id = ?, default_voice_id = ?,
          timeout_seconds = ?, retry_count = ?, response_format = ?, supplied_url_form = ?, updated_at = ?
        WHERE singleton_id = 1
      `,
        )
        .run(
          input.baseUrl,
          input.defaultModelId,
          input.defaultVoiceId,
          input.timeoutSeconds,
          input.retryCount,
          input.responseFormat,
          suppliedUrlForm,
          unchanged ? existing.updatedAt : options.now().toISOString(),
        );
      return getSpeechBackendConnection();
    },
    recordConnectionTest(summaryValue) {
      assertOpen();
      const summary = ConnectionTestSummarySchema.parse(summaryValue);
      const connection = getSpeechBackendConnection();
      const result = database
        .prepare(
          `
        UPDATE speech_backend_connection SET last_tested_at = ?, last_successful_test_at = ?,
          last_test_summary_json = ?, updated_at = ? WHERE singleton_id = 1
      `,
        )
        .run(
          summary.testedAt,
          summary.overall === "connected"
            ? summary.testedAt
            : connection.lastSuccessfulTestAt,
          JSON.stringify(summary),
          options.now().toISOString(),
        );
      if (Number(result.changes ?? 0) !== 1)
        throw new PersistenceNotFoundError(
          "The Speaches connection was not found.",
        );
      return getSpeechBackendConnection();
    },
    getConnectionSetup,
    completeConnectionOnboarding() {
      assertOpen();
      const timestamp = options.now().toISOString();
      database
        .prepare(
          "UPDATE connection_setup SET onboarding_completed_at = ?, updated_at = ? WHERE singleton_id = 1",
        )
        .run(timestamp, timestamp);
      return getConnectionSetup();
    },
    getVoiceCatalogOverrides,
    replaceVoiceCatalogOverrides(inputValue) {
      assertOpen();
      const input = VoiceCatalogSchema.parse(inputValue);
      transaction(() => {
        database
          .prepare("DELETE FROM voice_catalog_overrides WHERE model_id = ?")
          .run(input.modelId);
        const insert = database.prepare(`
          INSERT INTO voice_catalog_overrides (
            model_id, voice_id, ordinal, label, enabled, favorite, language, locale, accent, category, style, sample_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        input.entries.forEach((entry, ordinal) =>
          insert.run(
            input.modelId,
            entry.voiceId,
            ordinal,
            entry.label,
            booleanToSql(entry.enabled),
            booleanToSql(entry.favorite),
            entry.language,
            entry.locale,
            entry.accent,
            entry.category,
            entry.style,
            entry.sampleText,
          ),
        );
      });
      return getVoiceCatalogOverrides(input.modelId);
    },
    createRenderJob(jobValue, segmentValues) {
      assertOpen();
      const job = RenderJobSchema.parse(jobValue);
      const segments = segmentValues.map((segment) =>
        RenderSegmentSchema.parse(segment),
      );
      transaction(() => {
        // Vestigial. Render plans are computed per render and no longer have a
        // user-visible identity, so the plan_id value inserted below is
        // generated and never looked up. Scheduled for removal; see
        // docs/technical-debt.md.
        database
          .prepare(
            `
          INSERT INTO render_jobs (
            id, project_id, plan_id, retry_of_render_id, state, progress_json, error_json,
            created_at, started_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            job.id,
            job.projectId,
            job.planId,
            job.retryOfRenderId,
            job.state,
            JSON.stringify(job.progress),
            job.error === null ? null : JSON.stringify(job.error),
            job.createdAt,
            job.startedAt,
            job.finishedAt,
          );
        const insert = database.prepare(`
          INSERT INTO render_segments (
            render_id, ordinal, segment_type, state, cache_status, audio_duration_ms, error_json,
            audio_file_name, audio_path, audio_size_bytes, audio_checksum
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const segment of segments)
          insert.run(
            segment.renderId,
            segment.ordinal,
            segment.type,
            segment.state,
            segment.cacheStatus,
            segment.audioDurationMs,
            segment.error === null ? null : JSON.stringify(segment.error),
            segment.audioFileName,
            null,
            segment.audioSizeBytes,
            segment.audioChecksum,
          );
      });
      return job;
    },
    getRenderJob(renderId) {
      assertOpen();
      const row = database
        .prepare("SELECT * FROM render_jobs WHERE id = ?")
        .get(renderId) as RenderJobRow | undefined;
      if (!row)
        throw new PersistenceNotFoundError(`Render ${renderId} was not found.`);
      return renderJobFromRow(row);
    },
    listRenderJobs(projectId) {
      assertOpen();
      return RenderJobCollectionSchema.parse(
        (
          database
            .prepare(
              "SELECT * FROM render_jobs WHERE project_id = ? ORDER BY created_at DESC, id ASC",
            )
            .all(projectId) as RenderJobRow[]
        ).map(renderJobFromRow),
      );
    },
    listRecoverableRenderJobs() {
      assertOpen();
      return RenderJobCollectionSchema.parse(
        (
          database
            .prepare(
              `
        SELECT * FROM render_jobs WHERE state NOT IN ('complete','failed','canceled') ORDER BY created_at ASC, id ASC
      `,
            )
            .all() as RenderJobRow[]
        ).map(renderJobFromRow),
      );
    },
    updateRenderJob(jobValue) {
      assertOpen();
      const job = RenderJobSchema.parse(jobValue);
      const result = database
        .prepare(
          `
        UPDATE render_jobs SET state = ?, progress_json = ?, error_json = ?, started_at = ?, finished_at = ? WHERE id = ?
      `,
        )
        .run(
          job.state,
          JSON.stringify(job.progress),
          job.error === null ? null : JSON.stringify(job.error),
          job.startedAt,
          job.finishedAt,
          job.id,
        );
      if (Number(result.changes ?? 0) !== 1)
        throw new PersistenceNotFoundError(`Render ${job.id} was not found.`);
      return job;
    },
    updateRenderSegment(segmentValue, audioPath = null) {
      assertOpen();
      const segment = RenderSegmentSchema.parse(segmentValue);
      const result = database
        .prepare(
          `
        UPDATE render_segments SET state = ?, cache_status = ?, audio_duration_ms = ?, error_json = ?,
          audio_file_name = ?, audio_path = ?, audio_size_bytes = ?, audio_checksum = ?
        WHERE render_id = ? AND ordinal = ?
      `,
        )
        .run(
          segment.state,
          segment.cacheStatus,
          segment.audioDurationMs,
          segment.error === null ? null : JSON.stringify(segment.error),
          segment.audioFileName,
          audioPath,
          segment.audioSizeBytes,
          segment.audioChecksum,
          segment.renderId,
          segment.ordinal,
        );
      if (Number(result.changes ?? 0) !== 1)
        throw new PersistenceNotFoundError("Render segment was not found.");
      return segment;
    },
    listRenderSegments(renderId) {
      assertOpen();
      return (
        database
          .prepare(
            "SELECT * FROM render_segments WHERE render_id = ? ORDER BY ordinal ASC",
          )
          .all(renderId) as RenderSegmentRow[]
      ).map(renderSegmentFromRow);
    },
    getRenderSegmentPath(renderId, ordinal) {
      assertOpen();
      const row = database
        .prepare(
          "SELECT * FROM render_segments WHERE render_id = ? AND ordinal = ?",
        )
        .get(renderId, ordinal) as RenderSegmentRow | undefined;
      if (!row)
        throw new PersistenceNotFoundError(
          `Render segment ${String(ordinal)} was not found.`,
        );
      return { segment: renderSegmentFromRow(row), path: row.audio_path };
    },
    replaceRenderArtifacts(renderId, artifactValues) {
      assertOpen();
      const artifacts = artifactValues.map(({ path, ...artifact }) => ({
        artifact: RenderArtifactSchema.parse(artifact),
        path,
      }));
      transaction(() => {
        database
          .prepare("DELETE FROM render_artifacts WHERE render_id = ?")
          .run(renderId);
        const insert = database.prepare(`
          INSERT INTO render_artifacts (id, render_id, artifact_type, file_name, path, size_bytes, checksum, duration_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const { artifact, path } of artifacts)
          insert.run(
            artifact.id,
            artifact.renderId,
            artifact.type,
            artifact.fileName,
            path,
            artifact.sizeBytes,
            artifact.checksum,
            artifact.durationMs,
            artifact.createdAt,
          );
      });
      return RenderArtifactCollectionSchema.parse(
        artifacts.map(({ artifact }) => artifact),
      );
    },
    listRenderArtifacts(renderId) {
      assertOpen();
      return RenderArtifactCollectionSchema.parse(
        (
          database
            .prepare(
              "SELECT * FROM render_artifacts WHERE render_id = ? ORDER BY artifact_type ASC",
            )
            .all(renderId) as RenderArtifactRow[]
        ).map(renderArtifactFromRow),
      );
    },
    getRenderArtifactPath(artifactId) {
      assertOpen();
      const row = database
        .prepare("SELECT * FROM render_artifacts WHERE id = ?")
        .get(artifactId) as RenderArtifactRow | undefined;
      if (!row)
        throw new PersistenceNotFoundError(
          `Render artifact ${artifactId} was not found.`,
        );
      return { artifact: renderArtifactFromRow(row), path: row.path };
    },
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
}): Promise<StudyNarratorRepository> {
  const now = options.now ?? (() => new Date());
  const migrated = await migrateDatabase({
    Database: options.Database,
    databasePath: options.databasePath,
    now,
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
