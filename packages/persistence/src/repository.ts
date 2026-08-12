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
  DATABASE_SCHEMA_VERSION,
  DEFAULT_SYSTEM_PACING,
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PERSISTENCE_CONTRACT_VERSION,
  PersistenceReadyStatusSchema,
  ProjectCreateInputSchema,
  ProjectDetailSchema,
  ProjectIdSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  SystemPacingDefaultsSchema,
  type ConnectionProfileAuthoring,
  type ConnectionProfilePlaceholder,
  type GlobalLexiconReplaceInput,
  type IgnoredDiagnosticCollection,
  type PersistenceStatus,
  type ProjectCreateInput,
  type ProjectDetail,
  type ProjectReplaceInput,
  type ProjectSummary,
  type SystemPacingDefaults
} from "@studynarrator/shared-types";
import { PersistenceConflictError, PersistenceNotFoundError } from "./errors.js";
import {
  migrateDatabase,
  type DatabaseConstructor,
  type DatabaseLike,
  type Migration
} from "./migrations.js";

export const G01_MARKER_KEY = "g01.runtime-self-test";
export const G01_MARKER_VALUE = "study-narrator-g01";
export const CURRENT_MIGRATION_VERSION = DATABASE_SCHEMA_VERSION;

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  script_source: string;
  script_hash: string;
  connection_profile_id: string | null;
  paragraph_pause_enabled: number;
  paragraph_pause_id: string;
  paragraph_pause_duration_ms: number;
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
  created_at: string;
  updated_at: string;
}

interface MarkerRow { key: string; value: string; created_at: string }
interface VersionRow { version: string }

export interface MarkerEvidence {
  status: "pass";
  driver: "better-sqlite3";
  sqliteVersion: string;
  migrationVersion: typeof CURRENT_MIGRATION_VERSION;
  databasePath: string;
  latestBackupPath: string | null;
  markerKey: typeof G01_MARKER_KEY;
  markerValue: typeof G01_MARKER_VALUE;
  createdAt: string;
}

export interface StudyNarratorRepository {
  status(): PersistenceStatus;
  runMarker(): MarkerEvidence;
  listProjects(): ProjectSummary[];
  createProject(input: ProjectCreateInput): ProjectDetail;
  getProject(projectId: string): ProjectDetail;
  replaceProject(projectId: string, input: ProjectReplaceInput): ProjectDetail;
  deleteProject(projectId: string): void;
  getSystemPacing(): SystemPacingDefaults;
  updateSystemPacing(input: SystemPacingDefaults): SystemPacingDefaults;
  getIgnoredDiagnostics(): IgnoredDiagnosticCollection;
  replaceIgnoredDiagnostics(input: IgnoredDiagnosticCollection): IgnoredDiagnosticCollection;
  listGlobalLexicon(): LexiconEntry[];
  replaceGlobalLexicon(input: GlobalLexiconReplaceInput): LexiconEntry[];
  listConnectionProfiles(): ConnectionProfilePlaceholder[];
  createConnectionProfile(input: ConnectionProfileAuthoring): ConnectionProfilePlaceholder;
  replaceConnectionProfile(profileId: string, input: ConnectionProfileAuthoring): ConnectionProfilePlaceholder;
  deleteConnectionProfile(profileId: string): void;
  close(): void;
}

function scriptHash(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function booleanFromSql(value: number): boolean { return value === 1; }
function booleanToSql(value: boolean): number { return value ? 1 : 0; }

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
    defaultModelId: row.default_model_id,
    defaultVoiceId: row.default_voice_id,
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
      paragraphPause: {
        enabled: booleanFromSql(row.paragraph_pause_enabled),
        pauseId: row.paragraph_pause_id,
        durationMs: row.paragraph_pause_duration_ms
      },
      lexiconEntries: readLexicon("project", projectId),
      createdAt: row.created_at,
      updatedAt: row.updated_at
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
      database.prepare("INSERT OR IGNORE INTO diagnostic_kv (key, value, created_at) VALUES (?, ?, ?)")
        .run(G01_MARKER_KEY, G01_MARKER_VALUE, timestamp);
      const row = database.prepare("SELECT key, value, created_at FROM diagnostic_kv WHERE key = ?").get(G01_MARKER_KEY) as MarkerRow | undefined;
      const version = database.prepare("SELECT sqlite_version() AS version").get() as VersionRow | undefined;
      if (!row || !version?.version) throw new Error("Diagnostic storage verification failed");
      return {
        status: "pass",
        driver: "better-sqlite3",
        sqliteVersion: version.version,
        migrationVersion: CURRENT_MIGRATION_VERSION,
        databasePath: options.databasePath,
        latestBackupPath: options.latestBackupPath,
        markerKey: G01_MARKER_KEY,
        markerValue: G01_MARKER_VALUE,
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
            id, name, description, script_source, script_hash, connection_profile_id,
            paragraph_pause_enabled, paragraph_pause_id, paragraph_pause_duration_ms, created_at, updated_at
          ) VALUES (?, ?, ?, '', ?, NULL, ?, ?, ?, ?, ?)
        `).run(
          id, input.name, input.description, scriptHash(""), booleanToSql(pacing.enabled),
          DEFAULT_PARAGRAPH_PAUSE_ID, pacing.durationMs, timestamp, timestamp
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
      transaction(() => {
        const result = database.prepare(`
          UPDATE projects SET name = ?, description = ?, script_source = ?, script_hash = ?,
            connection_profile_id = ?, paragraph_pause_enabled = ?, paragraph_pause_id = ?,
            paragraph_pause_duration_ms = ?, updated_at = ? WHERE id = ?
        `).run(
          input.name, input.description, input.scriptSource, scriptHash(input.scriptSource), input.connectionProfileId,
          booleanToSql(input.paragraphPause.enabled), input.paragraphPause.pauseId,
          input.paragraphPause.durationMs, timestamp, projectId
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
    createConnectionProfile(inputValue) {
      assertOpen();
      const input = ConnectionProfileAuthoringSchema.parse(inputValue);
      const id = input.id ?? nextId();
      if (database.prepare("SELECT id FROM connection_profiles WHERE id = ?").get(id)) throw new PersistenceConflictError(`Connection profile ${id} already exists.`);
      const timestamp = options.now().toISOString();
      const ordinal = (database.prepare("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM connection_profiles").get() as { ordinal: number }).ordinal;
      database.prepare(`
        INSERT INTO connection_profiles (id, ordinal, name, base_url, default_model_id, default_voice_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ordinal, input.name, input.baseUrl, input.defaultModelId, input.defaultVoiceId, timestamp, timestamp);
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
        && existing.default_model_id === input.defaultModelId && existing.default_voice_id === input.defaultVoiceId;
      database.prepare("UPDATE connection_profiles SET name = ?, base_url = ?, default_model_id = ?, default_voice_id = ?, updated_at = ? WHERE id = ?")
        .run(input.name, input.baseUrl, input.defaultModelId, input.defaultVoiceId, unchanged ? existing.updated_at : options.now().toISOString(), profileId);
      return profileFromRow(database.prepare("SELECT * FROM connection_profiles WHERE id = ?").get(profileId) as ProfileRow);
    },
    deleteConnectionProfile(profileId) {
      assertOpen();
      const result = database.prepare("DELETE FROM connection_profiles WHERE id = ?").run(profileId);
      if (Number(result.changes ?? 0) !== 1) throw new PersistenceNotFoundError(`Connection profile ${profileId} was not found.`);
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
  return createRepository({
    database: migrated.database,
    databasePath: migrated.databasePath,
    latestBackupPath: migrated.backupPath,
    now,
    idFactory: options.idFactory ?? randomUUID
  });
}
