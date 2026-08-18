import { chmod, mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import {
  DATABASE_SCHEMA_VERSION,
  DEFAULT_GLOBAL_LEXICON,
  DEFAULT_GLOBAL_NAMED_SENSE_LEXICON,
  DEFAULT_SYSTEM_TIMING,
} from "@studynarrator/shared-types";
import { MigrationFailureError } from "./errors.js";

interface StatementLike {
  run(...parameters: unknown[]): { changes?: number | bigint };
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

export interface DatabaseLike {
  exec(sql: string): unknown;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): StatementLike;
  backup(destinationFile: string): Promise<unknown>;
  close(): void;
}

export interface DatabaseConstructor {
  new (path: string): DatabaseLike;
}

export interface Migration {
  version: number;
  name: string;
  up(database: DatabaseLike): void;
}

const BASELINE_SCHEMA_SQL = `
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
  CREATE TABLE diagnostic_kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE speaches_connection (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    base_url TEXT,
    default_model_id TEXT,
    default_voice_id TEXT,
    timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds BETWEEN 1 AND 600),
    retry_count INTEGER NOT NULL CHECK (retry_count BETWEEN 0 AND 5),
    response_format TEXT NOT NULL CHECK (response_format = 'wav'),
    supplied_url_form TEXT NOT NULL CHECK (supplied_url_form IN ('root', 'v1', 'unconfigured')),
    last_tested_at TEXT,
    last_successful_test_at TEXT,
    last_test_summary_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE connection_setup (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    onboarding_completed_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE system_timing (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    paragraph_transition_mode TEXT NOT NULL CHECK (paragraph_transition_mode IN ('none', 'preset', 'duration')),
    paragraph_transition_pause_id TEXT CHECK (paragraph_transition_pause_id IN ('pause_short', 'pause_medium', 'pause_long')),
    paragraph_transition_duration_ms INTEGER CHECK (paragraph_transition_duration_ms BETWEEN 0 AND 30000),
    speaker_change_transition_mode TEXT NOT NULL CHECK (speaker_change_transition_mode IN ('none', 'preset', 'duration')),
    speaker_change_transition_pause_id TEXT CHECK (speaker_change_transition_pause_id IN ('pause_short', 'pause_medium', 'pause_long')),
    speaker_change_transition_duration_ms INTEGER CHECK (speaker_change_transition_duration_ms BETWEEN 0 AND 30000),
    section_transition_mode TEXT NOT NULL CHECK (section_transition_mode IN ('none', 'preset', 'duration')),
    section_transition_pause_id TEXT CHECK (section_transition_pause_id IN ('pause_short', 'pause_medium', 'pause_long')),
    section_transition_duration_ms INTEGER CHECK (section_transition_duration_ms BETWEEN 0 AND 30000),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE system_pause_presets (
    pause_id TEXT PRIMARY KEY CHECK (pause_id IN ('pause_short', 'pause_medium', 'pause_long')),
    ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal BETWEEN 0 AND 2),
    duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 30000),
    description TEXT NOT NULL
  );

  CREATE TABLE ignored_diagnostic_patterns (
    code TEXT NOT NULL,
    pattern TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY (code, pattern)
  );

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    script_source TEXT NOT NULL,
    script_hash TEXT NOT NULL CHECK (length(script_hash) = 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE speaker_mappings (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    speaker_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    display_name TEXT NOT NULL,
    voice_id TEXT,
    speed REAL NOT NULL,
    gain_db REAL NOT NULL,
    role_description TEXT NOT NULL,
    sample_text TEXT NOT NULL,
    PRIMARY KEY (project_id, speaker_id)
  );

  CREATE TABLE lexicon_entries (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('exactTerm', 'exactPhrase', 'namedSense')),
    display_text TEXT NOT NULL,
    sense_id TEXT,
    spoken_text TEXT NOT NULL,
    case_sensitive INTEGER NOT NULL CHECK (case_sensitive IN (0, 1)),
    whole_word INTEGER NOT NULL CHECK (whole_word IN (0, 1)),
    priority INTEGER NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    notes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (scope = 'global' AND project_id IS NULL)
      OR (scope = 'project' AND project_id IS NOT NULL)
    ),
    CHECK (
      (entry_type = 'namedSense' AND sense_id IS NOT NULL)
      OR (entry_type != 'namedSense' AND sense_id IS NULL)
    )
  );

  CREATE TABLE voice_catalog_overrides (
    model_id TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    label TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    favorite INTEGER NOT NULL CHECK (favorite IN (0, 1)),
    language TEXT,
    locale TEXT,
    accent TEXT,
    category TEXT,
    style TEXT,
    sample_text TEXT,
    PRIMARY KEY (model_id, voice_id)
  );

  CREATE TABLE render_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL,
    retry_of_render_id TEXT REFERENCES render_jobs(id) ON DELETE SET NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','validating','synthesizing','assembling','normalizing','encoding','writing_artifacts','complete','failed','canceled')),
    progress_json TEXT NOT NULL,
    error_json TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE render_segments (
    render_id TEXT NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal > 0),
    segment_type TEXT NOT NULL CHECK (segment_type IN ('section','speech','pause')),
    state TEXT NOT NULL CHECK (state IN ('pending','complete','failed','skipped')),
    cache_status TEXT CHECK (cache_status IN ('hit','miss')),
    audio_duration_ms INTEGER CHECK (audio_duration_ms >= 0),
    error_json TEXT,
    audio_file_name TEXT,
    audio_path TEXT,
    audio_size_bytes INTEGER CHECK (audio_size_bytes IS NULL OR audio_size_bytes > 0),
    audio_checksum TEXT CHECK (audio_checksum IS NULL OR length(audio_checksum) = 64),
    PRIMARY KEY (render_id, ordinal)
  );

  CREATE TABLE render_artifacts (
    id TEXT PRIMARY KEY,
    render_id TEXT NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
    artifact_type TEXT NOT NULL CHECK (artifact_type IN ('mp3','originalScript','readableTranscript','ttsTranscript','manifest','projectSnapshot','checksums')),
    file_name TEXT NOT NULL,
    path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    checksum TEXT NOT NULL CHECK (length(checksum) = 64),
    duration_ms INTEGER CHECK (duration_ms >= 0),
    created_at TEXT NOT NULL,
    UNIQUE (render_id, artifact_type)
  );

  CREATE INDEX render_jobs_project_created_idx ON render_jobs(project_id, created_at DESC);
  CREATE INDEX render_jobs_state_created_idx ON render_jobs(state, created_at ASC);
  CREATE INDEX render_artifacts_render_idx ON render_artifacts(render_id, artifact_type);

  CREATE INDEX projects_updated_at_idx ON projects(updated_at DESC, id ASC);
  CREATE INDEX lexicon_project_idx ON lexicon_entries(project_id, ordinal);
`;

function applyBaseline(database: DatabaseLike): void {
  database.exec(BASELINE_SCHEMA_SQL);
  const timestamp = new Date().toISOString();
  database
    .prepare(`
    INSERT INTO speaches_connection (
      singleton_id, base_url, default_model_id, default_voice_id, timeout_seconds, retry_count,
      response_format, supplied_url_form, last_tested_at, last_successful_test_at,
      last_test_summary_json, created_at, updated_at
    ) VALUES (1, NULL, NULL, NULL, 120, 2, 'wav', 'unconfigured', NULL, NULL, NULL, ?, ?)
  `)
    .run(timestamp, timestamp);
  database
    .prepare(`
    INSERT INTO connection_setup (singleton_id, onboarding_completed_at, updated_at)
    VALUES (1, NULL, ?)
  `)
    .run(timestamp);

  const transition = (
    setting: typeof DEFAULT_SYSTEM_TIMING.transitionPauses.paragraph,
  ): [string, string | null, number | null] => {
    if (setting.mode === "none") return [setting.mode, null, null];
    if (setting.mode === "preset") return [setting.mode, setting.pauseId, null];
    return [setting.mode, null, setting.durationMs];
  };
  database
    .prepare(`
    INSERT INTO system_timing (
      singleton_id,
      paragraph_transition_mode, paragraph_transition_pause_id, paragraph_transition_duration_ms,
      speaker_change_transition_mode, speaker_change_transition_pause_id, speaker_change_transition_duration_ms,
      section_transition_mode, section_transition_pause_id, section_transition_duration_ms, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      ...transition(DEFAULT_SYSTEM_TIMING.transitionPauses.paragraph),
      ...transition(DEFAULT_SYSTEM_TIMING.transitionPauses.speakerChange),
      ...transition(DEFAULT_SYSTEM_TIMING.transitionPauses.section),
      timestamp,
    );
  const insertPause = database.prepare(
    "INSERT INTO system_pause_presets (pause_id, ordinal, duration_ms, description) VALUES (?, ?, ?, ?)",
  );
  DEFAULT_SYSTEM_TIMING.pausePresets.forEach((pause, ordinal) => {
    insertPause.run(
      pause.pauseId,
      ordinal,
      pause.durationMs,
      pause.description,
    );
  });
  const insertLexicon = database.prepare(`
    INSERT INTO lexicon_entries (
      id, scope, project_id, ordinal, entry_type, display_text, sense_id, spoken_text,
      case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
    ) VALUES (?, 'global', NULL, ?, ?, ?, ?, ?, 0, 1, 0, ?, '', ?, ?)
  `);
  DEFAULT_GLOBAL_LEXICON.forEach((entry, ordinal) => {
    insertLexicon.run(
      entry.id,
      ordinal,
      entry.entryType,
      entry.displayText,
      entry.entryType === "namedSense" ? entry.senseId : null,
      entry.spokenText,
      entry.enabled ? 1 : 0,
      timestamp,
      timestamp,
    );
  });
}

function addGlobalNamedSenseDefaults(database: DatabaseLike): void {
  const timestamp = new Date().toISOString();
  const row = database
    .prepare(
      "SELECT COALESCE(MAX(ordinal), -1) AS ordinal FROM lexicon_entries WHERE scope = 'global'",
    )
    .get() as { ordinal: number };
  let ordinal = Number(row.ordinal) + 1;
  const existing = database.prepare(`
    SELECT id FROM lexicon_entries
    WHERE scope = 'global' AND entry_type = 'namedSense'
      AND lower(display_text) = lower(?) AND lower(sense_id) = lower(?)
    LIMIT 1
  `);
  const insert = database.prepare(`
    INSERT OR IGNORE INTO lexicon_entries (
      id, scope, project_id, ordinal, entry_type, display_text, sense_id, spoken_text,
      case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
    ) VALUES (?, 'global', NULL, ?, 'namedSense', ?, ?, ?, 0, 1, 0, 1, '', ?, ?)
  `);
  for (const entry of DEFAULT_GLOBAL_NAMED_SENSE_LEXICON) {
    if (existing.get(entry.displayText, entry.senseId)) continue;
    const result = insert.run(
      entry.id,
      ordinal,
      entry.displayText,
      entry.senseId,
      entry.spokenText,
      timestamp,
      timestamp,
    );
    if (Number(result.changes ?? 0) > 0) ordinal += 1;
  }
}

export const STUDYNARRATOR_MIGRATIONS: readonly Migration[] = Object.freeze([
  { version: 1, name: "v1-baseline", up: applyBaseline },
  {
    version: 2,
    name: "project-speech-cache-lifecycle",
    up(database) {
      database.exec(`
      CREATE TABLE project_speech_cache_keys (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        cache_key TEXT NOT NULL CHECK (length(cache_key) = 64),
        PRIMARY KEY (project_id, cache_key)
      );
      CREATE TABLE speech_cache_deletion_queue (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        cache_key TEXT NOT NULL CHECK (length(cache_key) = 64),
        queued_at TEXT NOT NULL,
        PRIMARY KEY (project_id, cache_key)
      );
      CREATE INDEX speech_cache_deletion_project_idx ON speech_cache_deletion_queue(project_id, queued_at);
    `);
    },
  },
  {
    version: 3,
    name: "global-named-sense-defaults",
    up: addGlobalNamedSenseDefaults,
  },
]);

interface VersionRow {
  version: number;
}
interface NameRow {
  name: string;
}

const BASELINE_TABLES = Object.freeze([
  "connection_setup",
  "diagnostic_kv",
  "ignored_diagnostic_patterns",
  "lexicon_entries",
  "project_speech_cache_keys",
  "projects",
  "render_artifacts",
  "render_jobs",
  "render_segments",
  "schema_migrations",
  "speaches_connection",
  "speaker_mappings",
  "speech_cache_deletion_queue",
  "system_pause_presets",
  "system_timing",
  "voice_catalog_overrides",
]);

function validateBaselineSchema(database: DatabaseLike): void {
  const tables = (
    database
      .prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
  `)
      .all() as NameRow[]
  ).map(({ name }) => name);
  if (JSON.stringify(tables) !== JSON.stringify(BASELINE_TABLES)) {
    throw new Error(
      "The database does not match the StudyNarrator v1 baseline.",
    );
  }
  const projectColumns = (
    database.prepare("PRAGMA table_info(projects)").all() as NameRow[]
  ).map(({ name }) => name);
  if (
    JSON.stringify(projectColumns) !==
    JSON.stringify([
      "id",
      "name",
      "description",
      "script_source",
      "script_hash",
      "created_at",
      "updated_at",
    ])
  ) {
    throw new Error(
      "The projects table does not match the StudyNarrator v1 baseline.",
    );
  }
}

interface MigrationResult {
  database: DatabaseLike;
  databasePath: string;
  databaseSchemaVersion: number;
  appliedVersions: number[];
  backupPath: string | null;
}

function validateMigrations(migrations: readonly Migration[]) {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1)
      throw new Error("Migrations must be consecutive and start at version 1.");
  });
}

async function isExistingDatabase(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function padVersion(version: number): string {
  return String(version).padStart(4, "0");
}

function backupFilename(
  databasePath: string,
  from: number,
  to: number,
  now: Date,
): string {
  const extension = extname(databasePath) || ".sqlite";
  const stem = basename(databasePath, extname(databasePath));
  const timestamp = now.toISOString().replace(/[:.]/gu, "-");
  return `${stem}-v${padVersion(from)}-to-v${padVersion(to)}-${timestamp}${extension}`;
}

async function latestBackup(databasePath: string): Promise<string | null> {
  const backupDirectory = join(dirname(databasePath), "backups");
  try {
    const stem = `${basename(databasePath, extname(databasePath))}-v`;
    const names = (await readdir(backupDirectory)).filter((name) =>
      name.startsWith(stem),
    );
    if (names.length === 0) return null;
    const dated = await Promise.all(
      names.map(async (name) => {
        const path = join(backupDirectory, name);
        return { path, modifiedAt: (await stat(path)).mtimeMs };
      }),
    );
    dated.sort((left, right) => left.modifiedAt - right.modifiedAt || left.path.localeCompare(right.path));
    return dated.at(-1)!.path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function migrateDatabase(options: {
  Database: DatabaseConstructor;
  databasePath: string;
  now?: () => Date;
  migrations?: readonly Migration[];
}): Promise<MigrationResult> {
  const migrations = options.migrations ?? STUDYNARRATOR_MIGRATIONS;
  validateMigrations(migrations);
  const targetVersion = migrations.at(-1)?.version ?? 0;
  if (
    options.migrations === undefined &&
    targetVersion !== DATABASE_SCHEMA_VERSION
  ) {
    throw new Error(
      "The migration registry does not match the shared database schema version.",
    );
  }

  await mkdir(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  const existed = await isExistingDatabase(options.databasePath);
  const database = new options.Database(options.databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");

  let currentVersion = 0;
  let backupPath: string | null = null;
  let failedMigration: { version: number; name: string } | null = null;
  const readFailedMigration = (): typeof failedMigration => failedMigration;
  const appliedVersions: number[] = [];

  try {
    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .get();
    if (table) {
      const row = database
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
        )
        .get() as VersionRow;
      currentVersion = Number(row.version);
    }
    if (currentVersion > targetVersion)
      throw new Error(
        "The database schema is newer than this application supports.",
      );

    if (existed && currentVersion < targetVersion) {
      const backupDirectory = join(dirname(options.databasePath), "backups");
      await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      backupPath = join(
        backupDirectory,
        backupFilename(
          options.databasePath,
          currentVersion,
          targetVersion,
          (options.now ?? (() => new Date()))(),
        ),
      );
      await database.backup(backupPath);
      await chmod(backupPath, 0o600);
    }

    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue;
      database.exec("BEGIN IMMEDIATE;");
      try {
        migration.up(database);
        database
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          )
          .run(
            migration.version,
            (options.now ?? (() => new Date()))().toISOString(),
          );
        database.pragma(`user_version = ${String(migration.version)}`);
        database.exec("COMMIT;");
        currentVersion = migration.version;
        appliedVersions.push(migration.version);
      } catch (error) {
        try {
          database.exec("ROLLBACK;");
        } catch {
          /* transaction did not start */
        }
        failedMigration = { version: migration.version, name: migration.name };
        throw error;
      }
    }
    if (options.migrations === undefined) validateBaselineSchema(database);
    await chmod(options.databasePath, 0o600);
    backupPath ??= await latestBackup(options.databasePath);
    return {
      database,
      databasePath: options.databasePath,
      databaseSchemaVersion: currentVersion,
      appliedVersions,
      backupPath,
    };
  } catch (error) {
    database.close();
    const failedMigrationInfo = readFailedMigration();
    const detail =
      failedMigrationInfo === null
        ? ""
        : ` The failure occurred while applying migration ${String(failedMigrationInfo.version)} (${failedMigrationInfo.name}).`;
    throw new MigrationFailureError(
      `StudyNarrator could not migrate its database. The previous data remains recoverable from the protected backup.${detail}`,
      options.databasePath,
      backupPath,
      currentVersion,
      failedMigrationInfo,
      { cause: error },
    );
  }
}
