import { createHash, randomUUID } from "node:crypto";
import {
  DEFAULT_PARAGRAPH_PAUSE_ID,
  LexiconEntrySchema,
  type LexiconEntry,
  type LexiconEntryAuthoring
} from "@studynarrator/core";
import {
  ConnectionProfileAuthoringSchema,
  ConnectionProfileCollectionSchema,
  ConnectionProfilePlaceholderSchema,
  ConnectionTestSummarySchema,
  DATABASE_SCHEMA_VERSION,
  DEFAULT_SYSTEM_PACING,
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PERSISTENCE_CONTRACT_VERSION,
  PersistenceReadyStatusSchema,
  ProjectCreateInputSchema,
  ProjectDetailSchema,
  ProjectDuplicateInputSchema,
  ProjectIdSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  SystemPacingDefaultsSchema,
  VoiceCatalogSchema,
  RenderArtifactCollectionSchema,
  RenderArtifactSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  RenderSegmentSchema,
  type ConnectionProfileAuthoring,
  type ConnectionProfilePlaceholder,
  type ConnectionTestSummary,
  type GlobalLexiconReplaceInput,
  type IgnoredDiagnosticCollection,
  type PersistenceStatus,
  type ProjectCreateInput,
  type ProjectDetail,
  type ProjectDuplicateInput,
  type ProjectReplaceInput,
  type ProjectSummary,
  type SystemPacingDefaults,
  type TransitionPauseConfiguration,
  type TransitionPauseSetting,
  type VoiceCatalog,
  type VoiceCatalogAuthoring,
  type RenderArtifact,
  type RenderJob,
  type RenderSegment
} from "@studynarrator/shared-types";
import { PersistenceConflictError, PersistenceNotFoundError } from "./errors.js";
import {
  migrateDatabase,
  type DatabaseConstructor,
  type DatabaseLike,
  type Migration
} from "./migrations.js";

export const STORAGE_SELF_TEST_KEY = "runtime.storage-self-test";
export const STORAGE_SELF_TEST_VALUE = "study-narrator-storage-ok";
export const CURRENT_MIGRATION_VERSION = DATABASE_SCHEMA_VERSION;

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  script_source: string;
  script_hash: string;
  connection_profile_id: string | null;
  model_id: string | null;
  paragraph_pause_enabled: number;
  paragraph_pause_id: string;
  paragraph_pause_duration_ms: number;
  paragraph_transition_mode: "none" | "preset" | "duration";
  paragraph_transition_pause_id: string | null;
  paragraph_transition_duration_ms: number | null;
  speaker_change_transition_mode: "none" | "preset" | "duration";
  speaker_change_transition_pause_id: string | null;
  speaker_change_transition_duration_ms: number | null;
  section_transition_mode: "none" | "preset" | "duration";
  section_transition_pause_id: string | null;
  section_transition_duration_ms: number | null;
  created_at: string;
  updated_at: string;
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

interface PauseRow { pause_id: string; duration_ms: number; description: string }

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

interface ProfileRow {
  id: string;
  name: string;
  base_url: string | null;
  default_model_id: string | null;
  default_voice_id: string | null;
  source: "saved" | "environment";
  api_key_reference: string | null;
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

interface MarkerRow { key: string; value: string; created_at: string }
interface VersionRow { version: string }

export interface ConnectionSetupRecord {
  activeProfileId: string | null;
  onboardingCompletedAt: string | null;
}

export interface MarkerEvidence {
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
  replaceProject(projectId: string, input: ProjectReplaceInput): ProjectDetail;
  duplicateProject(projectId: string, input: ProjectDuplicateInput): ProjectDetail;
  deleteProject(projectId: string): void;
  getSystemPacing(): SystemPacingDefaults;
  updateSystemPacing(input: SystemPacingDefaults): SystemPacingDefaults;
  getIgnoredDiagnostics(): IgnoredDiagnosticCollection;
  replaceIgnoredDiagnostics(input: IgnoredDiagnosticCollection): IgnoredDiagnosticCollection;
  listGlobalLexicon(): LexiconEntry[];
  replaceGlobalLexicon(input: GlobalLexiconReplaceInput): LexiconEntry[];
  listConnectionProfiles(): ConnectionProfilePlaceholder[];
  getConnectionProfile(profileId: string): ConnectionProfilePlaceholder;
  createConnectionProfile(input: ConnectionProfileAuthoring): ConnectionProfilePlaceholder;
  replaceConnectionProfile(profileId: string, input: ConnectionProfileAuthoring): ConnectionProfilePlaceholder;
  deleteConnectionProfile(profileId: string): void;
  getConnectionCredentialReference(profileId: string): string | null;
  setConnectionCredentialReference(profileId: string, reference: string | null): ConnectionProfilePlaceholder;
  setConnectionSuppliedUrlForm(profileId: string, suppliedUrlForm: "root" | "v1" | "unconfigured"): ConnectionProfilePlaceholder;
  upsertEnvironmentConnectionProfile(input: ConnectionProfileAuthoring, credentialReference: string | null): ConnectionProfilePlaceholder;
  recordConnectionTest(profileId: string, summary: ConnectionTestSummary): ConnectionProfilePlaceholder;
  getConnectionSetup(): ConnectionSetupRecord;
  setActiveConnectionProfile(profileId: string | null): ConnectionSetupRecord;
  completeConnectionOnboarding(): ConnectionSetupRecord;
  getVoiceCatalogOverrides(modelId: string): VoiceCatalog;
  replaceVoiceCatalogOverrides(input: VoiceCatalogAuthoring): VoiceCatalog;
  createRenderJob(job: RenderJob, segments: RenderSegment[]): RenderJob;
  getRenderJob(renderId: string): RenderJob;
  listRenderJobs(projectId: string): RenderJob[];
  findActiveRenderJob(planId: string): RenderJob | null;
  listRecoverableRenderJobs(): RenderJob[];
  updateRenderJob(job: RenderJob): RenderJob;
  updateRenderSegment(segment: RenderSegment): RenderSegment;
  replaceRenderArtifacts(renderId: string, artifacts: Array<RenderArtifact & { path: string }>): RenderArtifact[];
  listRenderArtifacts(renderId: string): RenderArtifact[];
  getRenderArtifactPath(artifactId: string): { artifact: RenderArtifact; path: string };
  close(): void;
}

interface RenderJobRow {
  id: string; project_id: string; plan_id: string; retry_of_render_id: string | null; state: RenderJob["state"];
  progress_json: string; error_json: string | null; created_at: string; started_at: string | null; finished_at: string | null;
}

interface RenderArtifactRow {
  id: string; render_id: string; artifact_type: RenderArtifact["type"]; file_name: string; path: string;
  size_bytes: number; checksum: string; duration_ms: number | null; created_at: string;
}

function renderJobFromRow(row: RenderJobRow): RenderJob {
  return RenderJobSchema.parse({
    contractVersion: 1, id: row.id, projectId: row.project_id, planId: row.plan_id,
    retryOfRenderId: row.retry_of_render_id, state: row.state,
    progress: JSON.parse(row.progress_json) as unknown,
    error: row.error_json === null ? null : JSON.parse(row.error_json) as unknown,
    createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at
  });
}

function renderArtifactFromRow(row: RenderArtifactRow): RenderArtifact {
  return RenderArtifactSchema.parse({
    contractVersion: 1, id: row.id, renderId: row.render_id, type: row.artifact_type,
    fileName: row.file_name, sizeBytes: row.size_bytes, checksum: row.checksum,
    durationMs: row.duration_ms, createdAt: row.created_at
  });
}

function scriptHash(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function booleanFromSql(value: number): boolean { return value === 1; }
function booleanToSql(value: boolean): number { return value ? 1 : 0; }

function transitionFromRow(
  mode: ProjectRow["paragraph_transition_mode"],
  pauseId: string | null,
  durationMs: number | null
): TransitionPauseSetting {
  if (mode === "none") return { mode };
  if (mode === "preset" && pauseId) return { mode, pauseId };
  if (mode === "duration" && durationMs !== null) return { mode, durationMs };
  throw new Error("Stored transition pause configuration is invalid.");
}

function transitionParameters(setting: TransitionPauseSetting): [string, string | null, number | null] {
  if (setting.mode === "none") return [setting.mode, null, null];
  if (setting.mode === "preset") return [setting.mode, setting.pauseId, null];
  return [setting.mode, null, setting.durationMs];
}

function transitionConfiguration(row: ProjectRow): TransitionPauseConfiguration {
  return {
    paragraph: transitionFromRow(row.paragraph_transition_mode, row.paragraph_transition_pause_id, row.paragraph_transition_duration_ms),
    speakerChange: transitionFromRow(row.speaker_change_transition_mode, row.speaker_change_transition_pause_id, row.speaker_change_transition_duration_ms),
    section: transitionFromRow(row.section_transition_mode, row.section_transition_pause_id, row.section_transition_duration_ms)
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
    updatedAt: row.updated_at
  });
}

function profileFromRow(row: ProfileRow): ConnectionProfilePlaceholder {
  return ConnectionProfilePlaceholderSchema.parse({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    source: row.source,
    editable: row.source === "saved",
    credentialEntryAllowed: false,
    configured: row.base_url !== null && row.default_model_id !== null && row.default_voice_id !== null,
    apiKeyConfigured: row.api_key_reference !== null,
    defaultModelId: row.default_model_id,
    defaultVoiceId: row.default_voice_id,
    timeoutSeconds: row.timeout_seconds,
    retryCount: row.retry_count,
    responseFormat: row.response_format,
    suppliedUrlForm: row.supplied_url_form,
    lastTestedAt: row.last_tested_at,
    lastSuccessfulTestAt: row.last_successful_test_at,
    lastTestSummary: row.last_test_summary_json === null ? null : JSON.parse(row.last_test_summary_json) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function lexiconBehaviorMatches(existing: LexiconEntry, authored: LexiconEntryAuthoring): boolean {
  return existing.scope === authored.scope
    && existing.entryType === authored.entryType
    && existing.displayText === authored.displayText
    && existing.senseId === authored.senseId
    && existing.spokenText === authored.spokenText
    && existing.caseSensitive === authored.caseSensitive
    && existing.wholeWord === authored.wholeWord
    && existing.priority === authored.priority
    && existing.enabled === authored.enabled
    && existing.notes === authored.notes;
}

function createRepository(options: {
  database: DatabaseLike;
  databasePath: string;
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
      try { database.exec("ROLLBACK;"); } catch { /* transaction did not start */ }
      throw error;
    }
  };

  const nextId = (): string => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = options.idFactory();
      if (!database.prepare("SELECT id FROM projects WHERE id = ? UNION ALL SELECT id FROM lexicon_entries WHERE id = ? UNION ALL SELECT id FROM connection_profiles WHERE id = ?")
        .get(candidate, candidate, candidate)) return candidate;
    }
    throw new PersistenceConflictError("StudyNarrator could not allocate a collision-free durable ID.");
  };

  const readLexicon = (scope: "global" | "project", projectId: string | null): LexiconEntry[] => {
    const rows = scope === "global"
      ? database.prepare("SELECT * FROM lexicon_entries WHERE scope = 'global' ORDER BY ordinal ASC, id ASC").all()
      : database.prepare("SELECT * FROM lexicon_entries WHERE scope = 'project' AND project_id = ? ORDER BY ordinal ASC, id ASC").all(projectId);
    return rows.map((row) => lexiconFromRow(row as LexiconRow));
  };

  const replaceLexicon = (
    scope: "global" | "project",
    projectId: string | null,
    authoredEntries: readonly LexiconEntryAuthoring[],
    timestamp: string
  ): LexiconEntry[] => {
    const existing = readLexicon(scope, projectId);
    const existingById = new Map(existing.map((entry) => [entry.id, entry]));
    const normalized = authoredEntries.map((authored) => {
      const id = authored.id ?? nextId();
      const owner = database.prepare("SELECT scope, project_id FROM lexicon_entries WHERE id = ?").get(id) as { scope: string; project_id: string | null } | undefined;
      if (owner && (owner.scope !== scope || owner.project_id !== projectId)) {
        throw new PersistenceConflictError(`Lexicon entry ID ${id} belongs to another scope.`);
      }
      const prior = existingById.get(id);
      return LexiconEntrySchema.parse({
        ...authored,
        id,
        createdAt: prior?.createdAt ?? timestamp,
        updatedAt: prior && lexiconBehaviorMatches(prior, authored) ? prior.updatedAt : timestamp
      });
    });

    if (scope === "global") database.prepare("DELETE FROM lexicon_entries WHERE scope = 'global'").run();
    else database.prepare("DELETE FROM lexicon_entries WHERE scope = 'project' AND project_id = ?").run(projectId);

    const insert = database.prepare(`
      INSERT INTO lexicon_entries (
        id, scope, project_id, ordinal, entry_type, display_text, sense_id, spoken_text,
        case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    normalized.forEach((entry, ordinal) => insert.run(
      entry.id, entry.scope, projectId, ordinal, entry.entryType, entry.displayText, entry.senseId ?? null,
      entry.spokenText, booleanToSql(entry.caseSensitive), booleanToSql(entry.wholeWord), entry.priority,
      booleanToSql(entry.enabled), entry.notes, entry.createdAt, entry.updatedAt
    ));
    return normalized;
  };

  const getProject = (projectIdInput: string): ProjectDetail => {
    assertOpen();
    const projectId = ProjectIdSchema.parse(projectIdInput);
    const row = database.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
    if (!row) throw new PersistenceNotFoundError(`Project ${projectId} was not found.`);
    const speakers = database.prepare("SELECT * FROM speaker_mappings WHERE project_id = ? ORDER BY ordinal ASC, speaker_id ASC")
      .all(projectId) as SpeakerRow[];
    const pauses = database.prepare("SELECT * FROM pause_presets WHERE project_id = ? ORDER BY ordinal ASC, pause_id ASC")
      .all(projectId) as PauseRow[];
    return ProjectDetailSchema.parse({
      contractVersion: PERSISTENCE_CONTRACT_VERSION,
      id: row.id,
      name: row.name,
      description: row.description,
      scriptSource: row.script_source,
      scriptHash: row.script_hash,
      connectionProfileId: row.connection_profile_id,
      modelId: row.model_id,
      speakerMappings: speakers.map((speaker) => ({
        speakerId: speaker.speaker_id,
        displayName: speaker.display_name,
        voiceId: speaker.voice_id,
        speed: speaker.speed,
        gainDb: speaker.gain_db,
        roleDescription: speaker.role_description,
        sampleText: speaker.sample_text
      })),
      pausePresets: pauses.map((pause) => ({ pauseId: pause.pause_id, durationMs: pause.duration_ms, description: pause.description })),
      transitionPauses: transitionConfiguration(row),
      lexiconEntries: readLexicon("project", projectId),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  };

  const getConnectionProfile = (profileId: string): ConnectionProfilePlaceholder => {
    assertOpen();
    const row = database.prepare("SELECT * FROM connection_profiles WHERE id = ?").get(profileId) as ProfileRow | undefined;
    if (!row) throw new PersistenceNotFoundError(`Connection profile ${profileId} was not found.`);
    return profileFromRow(row);
  };

  const getConnectionSetup = (): ConnectionSetupRecord => {
    assertOpen();
    const row = database.prepare("SELECT active_profile_id, onboarding_completed_at FROM connection_setup WHERE singleton_id = 1")
      .get() as { active_profile_id: string | null; onboarding_completed_at: string | null };
    return { activeProfileId: row.active_profile_id, onboardingCompletedAt: row.onboarding_completed_at };
  };

  const getVoiceCatalogOverrides = (modelId: string): VoiceCatalog => {
    assertOpen();
    const rows = database.prepare(`
      SELECT voice_id, label, enabled, language, locale, accent, category, style, sample_text
      FROM voice_catalog_overrides WHERE model_id = ? ORDER BY ordinal ASC, voice_id ASC
    `).all(modelId) as Array<{
      voice_id: string; label: string; enabled: number; language: string | null; locale: string | null;
      accent: string | null; category: string | null; style: string | null; sample_text: string | null;
    }>;
    return VoiceCatalogSchema.parse({
      schemaVersion: 1,
      modelId,
      entries: rows.map((row) => ({
        voiceId: row.voice_id,
        label: row.label,
        enabled: booleanFromSql(row.enabled),
        language: row.language,
        locale: row.locale,
        accent: row.accent,
        category: row.category,
        style: row.style,
        sampleText: row.sample_text
      }))
    });
  };

  return {
    status() {
      assertOpen();
      return PersistenceReadyStatusSchema.parse({
        contractVersion: PERSISTENCE_CONTRACT_VERSION,
        state: "ready",
        databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
        targetDatabaseSchemaVersion: DATABASE_SCHEMA_VERSION,
        databasePath: options.databasePath,
        latestBackupPath: options.latestBackupPath
      });
    },
    runMarker() {
      assertOpen();
      const timestamp = options.now().toISOString();
      database.prepare("DELETE FROM diagnostic_kv WHERE key <> ?").run(STORAGE_SELF_TEST_KEY);
      database.prepare("INSERT OR IGNORE INTO diagnostic_kv (key, value, created_at) VALUES (?, ?, ?)")
        .run(STORAGE_SELF_TEST_KEY, STORAGE_SELF_TEST_VALUE, timestamp);
      const row = database.prepare("SELECT key, value, created_at FROM diagnostic_kv WHERE key = ?").get(STORAGE_SELF_TEST_KEY) as MarkerRow | undefined;
      const version = database.prepare("SELECT sqlite_version() AS version").get() as VersionRow | undefined;
      if (!row || !version?.version) throw new Error("Diagnostic storage verification failed");
      return {
        status: "pass",
        driver: "better-sqlite3",
        sqliteVersion: version.version,
        migrationVersion: CURRENT_MIGRATION_VERSION,
        databasePath: options.databasePath,
        latestBackupPath: options.latestBackupPath,
        markerKey: STORAGE_SELF_TEST_KEY,
        markerValue: STORAGE_SELF_TEST_VALUE,
        createdAt: row.created_at
      };
    },
    listProjects() {
      assertOpen();
      const rows = database.prepare("SELECT id, name, description, script_hash, created_at, updated_at FROM projects ORDER BY updated_at DESC, id ASC").all() as Array<Pick<ProjectRow, "id" | "name" | "description" | "script_hash" | "created_at" | "updated_at">>;
      return ProjectSummaryCollectionSchema.parse(rows.map((row) => ({
        id: row.id, name: row.name, description: row.description, scriptHash: row.script_hash,
        createdAt: row.created_at, updatedAt: row.updated_at
      })));
    },
    createProject(inputValue) {
      assertOpen();
      const input = ProjectCreateInputSchema.parse(inputValue);
      const id = ProjectIdSchema.parse(nextId());
      const timestamp = options.now().toISOString();
      const pacing = this.getSystemPacing();
      transaction(() => {
        database.prepare(`
          INSERT INTO projects (
            id, name, description, script_source, script_hash, connection_profile_id, model_id,
            paragraph_pause_enabled, paragraph_pause_id, paragraph_pause_duration_ms,
            paragraph_transition_mode, paragraph_transition_pause_id, paragraph_transition_duration_ms,
            speaker_change_transition_mode, speaker_change_transition_pause_id, speaker_change_transition_duration_ms,
            section_transition_mode, section_transition_pause_id, section_transition_duration_ms,
            created_at, updated_at
          ) VALUES (?, ?, ?, '', ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, 'none', NULL, NULL, 'none', NULL, NULL, ?, ?)
        `).run(
          id, input.name, input.description, scriptHash(""), booleanToSql(pacing.enabled),
          DEFAULT_PARAGRAPH_PAUSE_ID, pacing.durationMs, pacing.enabled ? "preset" : "none",
          pacing.enabled ? DEFAULT_PARAGRAPH_PAUSE_ID : null, timestamp, timestamp
        );
        database.prepare("INSERT INTO pause_presets (project_id, pause_id, ordinal, duration_ms, description) VALUES (?, ?, 0, ?, ?)")
          .run(id, DEFAULT_PARAGRAPH_PAUSE_ID, pacing.durationMs, "Paragraph or subtopic separation.");
      });
      return getProject(id);
    },
    getProject,
    replaceProject(projectIdInput, inputValue) {
      assertOpen();
      const projectId = ProjectIdSchema.parse(projectIdInput);
      const input = ProjectReplaceInputSchema.parse(inputValue);
      const prior = getProject(projectId);
      const timestamp = options.now().toISOString();
      const paragraphSetting = input.transitionPauses.paragraph;
      const paragraph = transitionParameters(paragraphSetting);
      const speakerChange = transitionParameters(input.transitionPauses.speakerChange);
      const section = transitionParameters(input.transitionPauses.section);
      const legacyParagraphPauseId = paragraphSetting.mode === "preset"
        ? paragraphSetting.pauseId
        : DEFAULT_PARAGRAPH_PAUSE_ID;
      const legacyParagraphDuration = paragraphSetting.mode === "duration"
        ? paragraphSetting.durationMs
        : paragraphSetting.mode === "preset"
          ? input.pausePresets.find(({ pauseId }) => pauseId === paragraphSetting.pauseId)?.durationMs ?? 0
          : 0;
      transaction(() => {
        const result = database.prepare(`
          UPDATE projects SET name = ?, description = ?, script_source = ?, script_hash = ?,
            connection_profile_id = ?, model_id = ?, paragraph_pause_enabled = ?, paragraph_pause_id = ?,
            paragraph_pause_duration_ms = ?,
            paragraph_transition_mode = ?, paragraph_transition_pause_id = ?, paragraph_transition_duration_ms = ?,
            speaker_change_transition_mode = ?, speaker_change_transition_pause_id = ?, speaker_change_transition_duration_ms = ?,
            section_transition_mode = ?, section_transition_pause_id = ?, section_transition_duration_ms = ?,
            updated_at = ? WHERE id = ?
        `).run(
          input.name, input.description, input.scriptSource, scriptHash(input.scriptSource), input.connectionProfileId, input.modelId,
          booleanToSql(input.transitionPauses.paragraph.mode !== "none"), legacyParagraphPauseId,
          legacyParagraphDuration, ...paragraph, ...speakerChange, ...section, timestamp, projectId
        );
        if (Number(result.changes ?? 0) !== 1) throw new PersistenceNotFoundError(`Project ${projectId} was not found.`);
        database.prepare("DELETE FROM speaker_mappings WHERE project_id = ?").run(projectId);
        database.prepare("DELETE FROM pause_presets WHERE project_id = ?").run(projectId);
        const insertSpeaker = database.prepare(`
          INSERT INTO speaker_mappings (
            project_id, speaker_id, ordinal, display_name, voice_id, speed, gain_db, role_description, sample_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        input.speakerMappings.forEach((speaker, ordinal) => insertSpeaker.run(
          projectId, speaker.speakerId, ordinal, speaker.displayName, speaker.voiceId, speaker.speed,
          speaker.gainDb, speaker.roleDescription, speaker.sampleText
        ));
        const insertPause = database.prepare("INSERT INTO pause_presets (project_id, pause_id, ordinal, duration_ms, description) VALUES (?, ?, ?, ?, ?)");
        input.pausePresets.forEach((pause, ordinal) => insertPause.run(projectId, pause.pauseId, ordinal, pause.durationMs, pause.description));
        replaceLexicon("project", projectId, input.lexiconEntries, timestamp);
      });
      const updated = getProject(projectId);
      if (updated.createdAt !== prior.createdAt) throw new Error("Project creation timestamp changed unexpectedly.");
      return updated;
    },
    duplicateProject(projectIdInput, inputValue) {
      assertOpen();
      const projectId = ProjectIdSchema.parse(projectIdInput);
      const input = ProjectDuplicateInputSchema.parse(inputValue);
      const source = getProject(projectId);
      const duplicateId = ProjectIdSchema.parse(nextId());
      const timestamp = options.now().toISOString();
      const paragraphSetting = source.transitionPauses.paragraph;
      const paragraph = transitionParameters(paragraphSetting);
      const speakerChange = transitionParameters(source.transitionPauses.speakerChange);
      const section = transitionParameters(source.transitionPauses.section);
      const legacyParagraphPauseId = paragraphSetting.mode === "preset"
        ? paragraphSetting.pauseId
        : DEFAULT_PARAGRAPH_PAUSE_ID;
      const legacyParagraphDuration = paragraphSetting.mode === "duration"
        ? paragraphSetting.durationMs
        : paragraphSetting.mode === "preset"
          ? source.pausePresets.find(({ pauseId }) => pauseId === paragraphSetting.pauseId)?.durationMs ?? 0
          : 0;
      transaction(() => {
        database.prepare(`
          INSERT INTO projects (
            id, name, description, script_source, script_hash, connection_profile_id, model_id,
            paragraph_pause_enabled, paragraph_pause_id, paragraph_pause_duration_ms,
            paragraph_transition_mode, paragraph_transition_pause_id, paragraph_transition_duration_ms,
            speaker_change_transition_mode, speaker_change_transition_pause_id, speaker_change_transition_duration_ms,
            section_transition_mode, section_transition_pause_id, section_transition_duration_ms,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          duplicateId, input.name, source.description, source.scriptSource, source.scriptHash, source.connectionProfileId, source.modelId,
          booleanToSql(source.transitionPauses.paragraph.mode !== "none"), legacyParagraphPauseId,
          legacyParagraphDuration, ...paragraph, ...speakerChange, ...section, timestamp, timestamp
        );
        const insertSpeaker = database.prepare(`
          INSERT INTO speaker_mappings (
            project_id, speaker_id, ordinal, display_name, voice_id, speed, gain_db, role_description, sample_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        source.speakerMappings.forEach((speaker, ordinal) => insertSpeaker.run(
          duplicateId, speaker.speakerId, ordinal, speaker.displayName, speaker.voiceId, speaker.speed,
          speaker.gainDb, speaker.roleDescription, speaker.sampleText
        ));
        const insertPause = database.prepare("INSERT INTO pause_presets (project_id, pause_id, ordinal, duration_ms, description) VALUES (?, ?, ?, ?, ?)");
        source.pausePresets.forEach((pause, ordinal) => insertPause.run(duplicateId, pause.pauseId, ordinal, pause.durationMs, pause.description));
        replaceLexicon("project", duplicateId, source.lexiconEntries.map((entry) => ({
          scope: entry.scope,
          entryType: entry.entryType,
          displayText: entry.displayText,
          ...(entry.senseId === undefined ? {} : { senseId: entry.senseId }),
          spokenText: entry.spokenText,
          caseSensitive: entry.caseSensitive,
          wholeWord: entry.wholeWord,
          priority: entry.priority,
          enabled: entry.enabled,
          notes: entry.notes
        })), timestamp);
      });
      return getProject(duplicateId);
    },
    deleteProject(projectIdInput) {
      assertOpen();
      const projectId = ProjectIdSchema.parse(projectIdInput);
      const result = database.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
      if (Number(result.changes ?? 0) !== 1) throw new PersistenceNotFoundError(`Project ${projectId} was not found.`);
    },
    getSystemPacing() {
      assertOpen();
      const row = database.prepare("SELECT paragraph_pause_enabled, paragraph_pause_duration_ms FROM system_pacing_defaults WHERE singleton_id = 1")
        .get() as { paragraph_pause_enabled: number; paragraph_pause_duration_ms: number };
      return SystemPacingDefaultsSchema.parse({ enabled: booleanFromSql(row.paragraph_pause_enabled), durationMs: row.paragraph_pause_duration_ms });
    },
    updateSystemPacing(inputValue) {
      assertOpen();
      const input = SystemPacingDefaultsSchema.parse(inputValue);
      database.prepare("UPDATE system_pacing_defaults SET paragraph_pause_enabled = ?, paragraph_pause_duration_ms = ?, updated_at = ? WHERE singleton_id = 1")
        .run(booleanToSql(input.enabled), input.durationMs, options.now().toISOString());
      return this.getSystemPacing();
    },
    getIgnoredDiagnostics() {
      assertOpen();
      return IgnoredDiagnosticCollectionSchema.parse(database.prepare("SELECT code, pattern FROM ignored_diagnostic_patterns ORDER BY ordinal ASC, code ASC, pattern ASC").all());
    },
    replaceIgnoredDiagnostics(inputValue) {
      assertOpen();
      const input = IgnoredDiagnosticCollectionSchema.parse(inputValue);
      const timestamp = options.now().toISOString();
      transaction(() => {
        database.prepare("DELETE FROM ignored_diagnostic_patterns").run();
        const insert = database.prepare("INSERT INTO ignored_diagnostic_patterns (code, pattern, ordinal, created_at) VALUES (?, ?, ?, ?)");
        input.forEach((item, ordinal) => insert.run(item.code, item.pattern, ordinal, timestamp));
      });
      return this.getIgnoredDiagnostics();
    },
    listGlobalLexicon() {
      assertOpen();
      return GlobalLexiconEntryCollectionSchema.parse(readLexicon("global", null));
    },
    replaceGlobalLexicon(inputValue) {
      assertOpen();
      const input = GlobalLexiconReplaceInputSchema.parse(inputValue);
      const result = transaction(() => replaceLexicon("global", null, input, options.now().toISOString()));
      return GlobalLexiconEntryCollectionSchema.parse(result);
    },
    listConnectionProfiles() {
      assertOpen();
      const rows = database.prepare("SELECT * FROM connection_profiles ORDER BY ordinal ASC, id ASC").all() as ProfileRow[];
      return ConnectionProfileCollectionSchema.parse(rows.map(profileFromRow));
    },
    getConnectionProfile,
    createConnectionProfile(inputValue) {
      assertOpen();
      const input = ConnectionProfileAuthoringSchema.parse(inputValue);
      const id = input.id ?? nextId();
      if (database.prepare("SELECT id FROM connection_profiles WHERE id = ?").get(id)) throw new PersistenceConflictError(`Connection profile ${id} already exists.`);
      const timestamp = options.now().toISOString();
      const ordinal = (database.prepare("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM connection_profiles").get() as { ordinal: number }).ordinal;
      database.prepare(`
        INSERT INTO connection_profiles (
          id, ordinal, name, base_url, default_model_id, default_voice_id,
          timeout_seconds, retry_count, response_format, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, ordinal, input.name, input.baseUrl, input.defaultModelId, input.defaultVoiceId,
        input.timeoutSeconds, input.retryCount, input.responseFormat, timestamp, timestamp
      );
      return profileFromRow(database.prepare("SELECT * FROM connection_profiles WHERE id = ?").get(id) as ProfileRow);
    },
    replaceConnectionProfile(profileIdInput, inputValue) {
      assertOpen();
      const input = ConnectionProfileAuthoringSchema.parse(inputValue);
      const profileId = profileIdInput;
      if (input.id !== undefined && input.id !== profileId) throw new PersistenceConflictError("Connection profile IDs cannot be changed.");
      const existing = database.prepare("SELECT * FROM connection_profiles WHERE id = ?").get(profileId) as ProfileRow | undefined;
      if (!existing) throw new PersistenceNotFoundError(`Connection profile ${profileId} was not found.`);
      const unchanged = existing.name === input.name && existing.base_url === input.baseUrl
        && existing.default_model_id === input.defaultModelId && existing.default_voice_id === input.defaultVoiceId
        && existing.timeout_seconds === input.timeoutSeconds && existing.retry_count === input.retryCount;
      database.prepare(`
        UPDATE connection_profiles SET name = ?, base_url = ?, default_model_id = ?, default_voice_id = ?,
          timeout_seconds = ?, retry_count = ?, response_format = ?, updated_at = ? WHERE id = ?
      `).run(
        input.name, input.baseUrl, input.defaultModelId, input.defaultVoiceId,
        input.timeoutSeconds, input.retryCount, input.responseFormat,
        unchanged ? existing.updated_at : options.now().toISOString(), profileId
      );
      return profileFromRow(database.prepare("SELECT * FROM connection_profiles WHERE id = ?").get(profileId) as ProfileRow);
    },
    deleteConnectionProfile(profileId) {
      assertOpen();
      const existing = database.prepare("SELECT source FROM connection_profiles WHERE id = ?").get(profileId) as { source: string } | undefined;
      if (!existing) throw new PersistenceNotFoundError(`Connection profile ${profileId} was not found.`);
      if (existing.source === "environment") throw new PersistenceConflictError("Environment-managed connection profiles cannot be deleted.");
      const result = database.prepare("DELETE FROM connection_profiles WHERE id = ?").run(profileId);
      if (Number(result.changes ?? 0) !== 1) throw new PersistenceNotFoundError(`Connection profile ${profileId} was not found.`);
    },
    getConnectionCredentialReference(profileId) {
      assertOpen();
      const row = database.prepare("SELECT api_key_reference FROM connection_profiles WHERE id = ?").get(profileId) as { api_key_reference: string | null } | undefined;
      if (!row) throw new PersistenceNotFoundError(`Connection profile ${profileId} was not found.`);
      return row.api_key_reference;
    },
    setConnectionCredentialReference(profileId, reference) {
      assertOpen();
      const result = database.prepare("UPDATE connection_profiles SET api_key_reference = ?, updated_at = ? WHERE id = ?")
        .run(reference, options.now().toISOString(), profileId);
      if (Number(result.changes ?? 0) !== 1) throw new PersistenceNotFoundError(`Connection profile ${profileId} was not found.`);
      return getConnectionProfile(profileId);
    },
    setConnectionSuppliedUrlForm(profileId, suppliedUrlForm) {
      assertOpen();
      const result = database.prepare("UPDATE connection_profiles SET supplied_url_form = ?, updated_at = ? WHERE id = ?")
        .run(suppliedUrlForm, options.now().toISOString(), profileId);
      if (Number(result.changes ?? 0) !== 1) throw new PersistenceNotFoundError(`Connection profile ${profileId} was not found.`);
      return getConnectionProfile(profileId);
    },
    upsertEnvironmentConnectionProfile(inputValue, credentialReference) {
      assertOpen();
      const input = ConnectionProfileAuthoringSchema.parse(inputValue);
      if (!input.id) throw new PersistenceConflictError("Environment profiles require a stable ID.");
      const existing = database.prepare("SELECT id, created_at FROM connection_profiles WHERE id = ?").get(input.id) as { id: string; created_at: string } | undefined;
      const timestamp = options.now().toISOString();
      if (!existing) {
        const ordinal = (database.prepare("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM connection_profiles").get() as { ordinal: number }).ordinal;
        database.prepare(`
          INSERT INTO connection_profiles (
            id, ordinal, name, base_url, default_model_id, default_voice_id, source, api_key_reference,
            timeout_seconds, retry_count, response_format, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'environment', ?, ?, ?, ?, ?, ?)
        `).run(
          input.id, ordinal, input.name, input.baseUrl, input.defaultModelId, input.defaultVoiceId, credentialReference,
          input.timeoutSeconds, input.retryCount, input.responseFormat, timestamp, timestamp
        );
      } else {
        database.prepare(`
          UPDATE connection_profiles SET name = ?, base_url = ?, default_model_id = ?, default_voice_id = ?,
            source = 'environment', api_key_reference = ?, timeout_seconds = ?, retry_count = ?, response_format = ?, updated_at = ?
          WHERE id = ?
        `).run(
          input.name, input.baseUrl, input.defaultModelId, input.defaultVoiceId, credentialReference,
          input.timeoutSeconds, input.retryCount, input.responseFormat, timestamp, input.id
        );
      }
      return getConnectionProfile(input.id);
    },
    recordConnectionTest(profileId, summaryValue) {
      assertOpen();
      const summary = ConnectionTestSummarySchema.parse(summaryValue);
      const result = database.prepare(`
        UPDATE connection_profiles SET last_tested_at = ?, last_successful_test_at = ?,
          last_test_summary_json = ?, updated_at = ? WHERE id = ?
      `).run(
        summary.testedAt,
        summary.overall === "connected" ? summary.testedAt : getConnectionProfile(profileId).lastSuccessfulTestAt,
        JSON.stringify(summary),
        options.now().toISOString(),
        profileId
      );
      if (Number(result.changes ?? 0) !== 1) throw new PersistenceNotFoundError(`Connection profile ${profileId} was not found.`);
      return getConnectionProfile(profileId);
    },
    getConnectionSetup,
    setActiveConnectionProfile(profileId) {
      assertOpen();
      if (profileId !== null) getConnectionProfile(profileId);
      database.prepare("UPDATE connection_setup SET active_profile_id = ?, updated_at = ? WHERE singleton_id = 1")
        .run(profileId, options.now().toISOString());
      return getConnectionSetup();
    },
    completeConnectionOnboarding() {
      assertOpen();
      const timestamp = options.now().toISOString();
      database.prepare("UPDATE connection_setup SET onboarding_completed_at = ?, updated_at = ? WHERE singleton_id = 1")
        .run(timestamp, timestamp);
      return getConnectionSetup();
    },
    getVoiceCatalogOverrides,
    replaceVoiceCatalogOverrides(inputValue) {
      assertOpen();
      const input = VoiceCatalogSchema.parse(inputValue);
      transaction(() => {
        database.prepare("DELETE FROM voice_catalog_overrides WHERE model_id = ?").run(input.modelId);
        const insert = database.prepare(`
          INSERT INTO voice_catalog_overrides (
            model_id, voice_id, ordinal, label, enabled, language, locale, accent, category, style, sample_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        input.entries.forEach((entry, ordinal) => insert.run(
          input.modelId, entry.voiceId, ordinal, entry.label, booleanToSql(entry.enabled), entry.language,
          entry.locale, entry.accent, entry.category, entry.style, entry.sampleText
        ));
      });
      return getVoiceCatalogOverrides(input.modelId);
    },
    createRenderJob(jobValue, segmentValues) {
      assertOpen();
      const job = RenderJobSchema.parse(jobValue);
      const segments = segmentValues.map((segment) => RenderSegmentSchema.parse(segment));
      transaction(() => {
        database.prepare(`
          INSERT INTO render_jobs (
            id, project_id, plan_id, retry_of_render_id, state, progress_json, error_json,
            created_at, started_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          job.id, job.projectId, job.planId, job.retryOfRenderId, job.state, JSON.stringify(job.progress),
          job.error === null ? null : JSON.stringify(job.error), job.createdAt, job.startedAt, job.finishedAt
        );
        const insert = database.prepare(`
          INSERT INTO render_segments (render_id, ordinal, segment_type, state, cache_status, audio_duration_ms, error_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const segment of segments) insert.run(
          segment.renderId, segment.ordinal, segment.type, segment.state, segment.cacheStatus,
          segment.audioDurationMs, segment.error === null ? null : JSON.stringify(segment.error)
        );
      });
      return job;
    },
    getRenderJob(renderId) {
      assertOpen();
      const row = database.prepare("SELECT * FROM render_jobs WHERE id = ?").get(renderId) as RenderJobRow | undefined;
      if (!row) throw new PersistenceNotFoundError(`Render ${renderId} was not found.`);
      return renderJobFromRow(row);
    },
    listRenderJobs(projectId) {
      assertOpen();
      return RenderJobCollectionSchema.parse((database.prepare(
        "SELECT * FROM render_jobs WHERE project_id = ? ORDER BY created_at DESC, id ASC"
      ).all(projectId) as RenderJobRow[]).map(renderJobFromRow));
    },
    findActiveRenderJob(planId) {
      assertOpen();
      const row = database.prepare(`
        SELECT * FROM render_jobs WHERE plan_id = ? AND state NOT IN ('complete','failed','canceled')
        ORDER BY created_at ASC LIMIT 1
      `).get(planId) as RenderJobRow | undefined;
      return row ? renderJobFromRow(row) : null;
    },
    listRecoverableRenderJobs() {
      assertOpen();
      return RenderJobCollectionSchema.parse((database.prepare(`
        SELECT * FROM render_jobs WHERE state NOT IN ('complete','failed','canceled') ORDER BY created_at ASC, id ASC
      `).all() as RenderJobRow[]).map(renderJobFromRow));
    },
    updateRenderJob(jobValue) {
      assertOpen();
      const job = RenderJobSchema.parse(jobValue);
      const result = database.prepare(`
        UPDATE render_jobs SET state = ?, progress_json = ?, error_json = ?, started_at = ?, finished_at = ? WHERE id = ?
      `).run(
        job.state, JSON.stringify(job.progress), job.error === null ? null : JSON.stringify(job.error),
        job.startedAt, job.finishedAt, job.id
      );
      if (Number(result.changes ?? 0) !== 1) throw new PersistenceNotFoundError(`Render ${job.id} was not found.`);
      return job;
    },
    updateRenderSegment(segmentValue) {
      assertOpen();
      const segment = RenderSegmentSchema.parse(segmentValue);
      const result = database.prepare(`
        UPDATE render_segments SET state = ?, cache_status = ?, audio_duration_ms = ?, error_json = ?
        WHERE render_id = ? AND ordinal = ?
      `).run(
        segment.state, segment.cacheStatus, segment.audioDurationMs,
        segment.error === null ? null : JSON.stringify(segment.error), segment.renderId, segment.ordinal
      );
      if (Number(result.changes ?? 0) !== 1) throw new PersistenceNotFoundError("Render segment was not found.");
      return segment;
    },
    replaceRenderArtifacts(renderId, artifactValues) {
      assertOpen();
      const artifacts = artifactValues.map(({ path, ...artifact }) => ({ artifact: RenderArtifactSchema.parse(artifact), path }));
      transaction(() => {
        database.prepare("DELETE FROM render_artifacts WHERE render_id = ?").run(renderId);
        const insert = database.prepare(`
          INSERT INTO render_artifacts (id, render_id, artifact_type, file_name, path, size_bytes, checksum, duration_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const { artifact, path } of artifacts) insert.run(
          artifact.id, artifact.renderId, artifact.type, artifact.fileName, path, artifact.sizeBytes,
          artifact.checksum, artifact.durationMs, artifact.createdAt
        );
      });
      return RenderArtifactCollectionSchema.parse(artifacts.map(({ artifact }) => artifact));
    },
    listRenderArtifacts(renderId) {
      assertOpen();
      return RenderArtifactCollectionSchema.parse((database.prepare(
        "SELECT * FROM render_artifacts WHERE render_id = ? ORDER BY artifact_type ASC"
      ).all(renderId) as RenderArtifactRow[]).map(renderArtifactFromRow));
    },
    getRenderArtifactPath(artifactId) {
      assertOpen();
      const row = database.prepare("SELECT * FROM render_artifacts WHERE id = ?").get(artifactId) as RenderArtifactRow | undefined;
      if (!row) throw new PersistenceNotFoundError(`Render artifact ${artifactId} was not found.`);
      return { artifact: renderArtifactFromRow(row), path: row.path };
    },
    close() {
      if (!closed) {
        database.close();
        closed = true;
      }
    }
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
    ...(options.migrations === undefined ? {} : { migrations: options.migrations })
  });
  const timestamp = now().toISOString();
  migrated.database.prepare(`
    INSERT OR IGNORE INTO system_pacing_defaults (
      singleton_id, paragraph_pause_enabled, paragraph_pause_duration_ms, updated_at
    ) VALUES (1, ?, ?, ?)
  `).run(booleanToSql(DEFAULT_SYSTEM_PACING.enabled), DEFAULT_SYSTEM_PACING.durationMs, timestamp);
  migrated.database.prepare(`
    INSERT OR IGNORE INTO connection_setup (singleton_id, active_profile_id, onboarding_completed_at, updated_at)
    VALUES (1, NULL, NULL, ?)
  `).run(timestamp);
  return createRepository({
    database: migrated.database,
    databasePath: migrated.databasePath,
    latestBackupPath: migrated.backupPath,
    now,
    idFactory: options.idFactory ?? randomUUID
  });
}
