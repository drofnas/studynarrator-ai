import { chmod, mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { DATABASE_SCHEMA_VERSION, DEFAULT_GLOBAL_LEXICON } from "@studynarrator/shared-types";
import { MigrationFailureError } from "./errors.js";

export interface StatementLike {
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
  new(path: string): DatabaseLike;
}

export interface Migration {
  version: number;
  name: string;
  up(database: DatabaseLike): void;
}

const MIGRATION_1_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS diagnostic_kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

const MIGRATION_2_SQL = `
  CREATE TABLE connection_profiles (
    id TEXT PRIMARY KEY,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    name TEXT NOT NULL,
    base_url TEXT,
    default_model_id TEXT,
    default_voice_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE system_pacing_defaults (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    paragraph_pause_enabled INTEGER NOT NULL CHECK (paragraph_pause_enabled IN (0, 1)),
    paragraph_pause_duration_ms INTEGER NOT NULL CHECK (paragraph_pause_duration_ms BETWEEN 0 AND 30000),
    updated_at TEXT NOT NULL
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
    config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version = 1),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    script_source TEXT NOT NULL,
    script_hash TEXT NOT NULL CHECK (length(script_hash) = 64),
    connection_profile_id TEXT REFERENCES connection_profiles(id) ON DELETE SET NULL,
    paragraph_pause_enabled INTEGER NOT NULL CHECK (paragraph_pause_enabled IN (0, 1)),
    paragraph_pause_id TEXT NOT NULL,
    paragraph_pause_duration_ms INTEGER NOT NULL CHECK (paragraph_pause_duration_ms BETWEEN 0 AND 30000),
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

  CREATE TABLE pause_presets (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pause_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 30000),
    description TEXT NOT NULL,
    PRIMARY KEY (project_id, pause_id)
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

  CREATE INDEX projects_updated_at_idx ON projects(updated_at DESC, id ASC);
  CREATE INDEX lexicon_project_idx ON lexicon_entries(project_id, ordinal);
`;

const MIGRATION_3_SQL = `
  ALTER TABLE connection_profiles ADD COLUMN source TEXT NOT NULL DEFAULT 'saved' CHECK (source IN ('saved', 'environment'));
  ALTER TABLE connection_profiles ADD COLUMN api_key_reference TEXT;
  ALTER TABLE connection_profiles ADD COLUMN timeout_seconds INTEGER NOT NULL DEFAULT 120 CHECK (timeout_seconds BETWEEN 1 AND 600);
  ALTER TABLE connection_profiles ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 2 CHECK (retry_count BETWEEN 0 AND 5);
  ALTER TABLE connection_profiles ADD COLUMN response_format TEXT NOT NULL DEFAULT 'wav' CHECK (response_format = 'wav');
  ALTER TABLE connection_profiles ADD COLUMN supplied_url_form TEXT NOT NULL DEFAULT 'unconfigured' CHECK (supplied_url_form IN ('root', 'v1', 'unconfigured'));
  ALTER TABLE connection_profiles ADD COLUMN last_tested_at TEXT;
  ALTER TABLE connection_profiles ADD COLUMN last_successful_test_at TEXT;
  ALTER TABLE connection_profiles ADD COLUMN last_test_summary_json TEXT;

  ALTER TABLE projects ADD COLUMN model_id TEXT;
  UPDATE connection_profiles SET supplied_url_form = 'root' WHERE base_url IS NOT NULL;

  CREATE TABLE voice_catalog_overrides (
    model_id TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    label TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    language TEXT,
    locale TEXT,
    accent TEXT,
    category TEXT,
    style TEXT,
    sample_text TEXT,
    PRIMARY KEY (model_id, voice_id)
  );

  CREATE TABLE connection_setup (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    active_profile_id TEXT REFERENCES connection_profiles(id) ON DELETE SET NULL,
    onboarding_completed_at TEXT,
    updated_at TEXT NOT NULL
  );
`;

const MIGRATION_4_SQL = `
  ALTER TABLE projects ADD COLUMN paragraph_transition_mode TEXT NOT NULL DEFAULT 'preset' CHECK (paragraph_transition_mode IN ('none', 'preset', 'duration'));
  ALTER TABLE projects ADD COLUMN paragraph_transition_pause_id TEXT;
  ALTER TABLE projects ADD COLUMN paragraph_transition_duration_ms INTEGER CHECK (paragraph_transition_duration_ms BETWEEN 0 AND 30000);
  ALTER TABLE projects ADD COLUMN speaker_change_transition_mode TEXT NOT NULL DEFAULT 'none' CHECK (speaker_change_transition_mode IN ('none', 'preset', 'duration'));
  ALTER TABLE projects ADD COLUMN speaker_change_transition_pause_id TEXT;
  ALTER TABLE projects ADD COLUMN speaker_change_transition_duration_ms INTEGER CHECK (speaker_change_transition_duration_ms BETWEEN 0 AND 30000);
  ALTER TABLE projects ADD COLUMN section_transition_mode TEXT NOT NULL DEFAULT 'none' CHECK (section_transition_mode IN ('none', 'preset', 'duration'));
  ALTER TABLE projects ADD COLUMN section_transition_pause_id TEXT;
  ALTER TABLE projects ADD COLUMN section_transition_duration_ms INTEGER CHECK (section_transition_duration_ms BETWEEN 0 AND 30000);

  UPDATE projects SET
    paragraph_transition_mode = CASE WHEN paragraph_pause_enabled = 1 THEN 'preset' ELSE 'none' END,
    paragraph_transition_pause_id = CASE WHEN paragraph_pause_enabled = 1 THEN paragraph_pause_id ELSE NULL END,
    paragraph_transition_duration_ms = NULL;
`;

const MIGRATION_5_SQL = `
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
`;

const MIGRATION_6_SQL = `
  ALTER TABLE render_segments ADD COLUMN audio_file_name TEXT;
  ALTER TABLE render_segments ADD COLUMN audio_path TEXT;
  ALTER TABLE render_segments ADD COLUMN audio_size_bytes INTEGER CHECK (audio_size_bytes IS NULL OR audio_size_bytes > 0);
  ALTER TABLE render_segments ADD COLUMN audio_checksum TEXT CHECK (audio_checksum IS NULL OR length(audio_checksum) = 64);
`;

const MIGRATION_7_SQL = `
  INSERT OR IGNORE INTO connection_setup (singleton_id, active_profile_id, onboarding_completed_at, updated_at)
  VALUES (1, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

  CREATE TEMP TABLE migration_7_connection_winner (
    id TEXT PRIMARY KEY
  );

  INSERT INTO migration_7_connection_winner (id)
  SELECT profile.id
  FROM connection_profiles AS profile
  LEFT JOIN connection_setup AS setup ON setup.singleton_id = 1
  ORDER BY
    CASE
      WHEN profile.id = setup.active_profile_id
        AND profile.base_url IS NOT NULL
        AND profile.default_model_id IS NOT NULL
        AND profile.default_voice_id IS NOT NULL THEN 0
      WHEN profile.source = 'saved'
        AND profile.base_url IS NOT NULL
        AND profile.default_model_id IS NOT NULL
        AND profile.default_voice_id IS NOT NULL THEN 1
      WHEN profile.base_url IS NOT NULL
        AND profile.default_model_id IS NOT NULL
        AND profile.default_voice_id IS NOT NULL THEN 2
      WHEN profile.id = setup.active_profile_id THEN 3
      WHEN profile.source = 'saved' THEN 4
      ELSE 5
    END,
    profile.ordinal ASC,
    profile.id ASC
  LIMIT 1;

  INSERT INTO connection_profiles (
    id, ordinal, name, base_url, default_model_id, default_voice_id, source,
    api_key_reference, timeout_seconds, retry_count, response_format,
    supplied_url_form, last_tested_at, last_successful_test_at,
    last_test_summary_json, created_at, updated_at
  )
  SELECT
    'speaches', 0, 'Speaches', NULL, NULL, NULL, 'saved', NULL, 120, 2, 'wav',
    'unconfigured', NULL, NULL, NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NOT EXISTS (SELECT 1 FROM migration_7_connection_winner);

  INSERT OR IGNORE INTO migration_7_connection_winner (id)
  SELECT 'speaches';

  UPDATE connection_profiles
  SET name = 'Speaches', source = 'saved', api_key_reference = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = (SELECT id FROM migration_7_connection_winner LIMIT 1);

  UPDATE projects
  SET connection_profile_id = (SELECT id FROM migration_7_connection_winner LIMIT 1);

  UPDATE connection_setup
  SET active_profile_id = (SELECT id FROM migration_7_connection_winner LIMIT 1),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE singleton_id = 1;

  DELETE FROM connection_profiles
  WHERE id != (SELECT id FROM migration_7_connection_winner LIMIT 1);

  DROP TABLE migration_7_connection_winner;
`;

interface MigrationGlobalLexiconRow {
  id: string;
  ordinal: number;
  display_text: string;
  enabled: number;
}

function migrateSimplifiedGlobalLexicon(database: DatabaseLike): void {
  const rows = database.prepare(`
    SELECT id, ordinal, display_text, enabled
    FROM lexicon_entries
    WHERE scope = 'global'
    ORDER BY ordinal ASC, id ASC
  `).all() as MigrationGlobalLexiconRow[];
  const duplicateKeys = new Set<string>();
  const update = database.prepare(`
    UPDATE lexicon_entries
    SET entry_type = 'exactTerm', sense_id = NULL, case_sensitive = 0,
        whole_word = 1, priority = 0, enabled = ?, notes = ''
    WHERE id = ? AND scope = 'global'
  `);
  for (const row of rows) {
    const key = row.display_text.trim().toLocaleLowerCase("en-US");
    const duplicate = duplicateKeys.has(key);
    duplicateKeys.add(key);
    update.run(duplicate ? 0 : row.enabled, row.id);
  }

  if (rows.length !== 0) return;
  const timestamp = new Date().toISOString();
  const insert = database.prepare(`
    INSERT INTO lexicon_entries (
      id, scope, project_id, ordinal, entry_type, display_text, sense_id, spoken_text,
      case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
    ) VALUES (?, 'global', NULL, ?, 'exactTerm', ?, NULL, ?, 0, 1, 0, 1, '', ?, ?)
  `);
  DEFAULT_GLOBAL_LEXICON.forEach((entry, ordinal) => {
    insert.run(entry.id, ordinal, entry.displayText, entry.spokenText, timestamp, timestamp);
  });
}

export const STUDYNARRATOR_MIGRATIONS: readonly Migration[] = Object.freeze([
  { version: 1, name: "runtime-diagnostics", up: (database) => { database.exec(MIGRATION_1_SQL); } },
  {
    version: 2,
    name: "project-authoring",
    up: (database) => {
      database.exec(MIGRATION_2_SQL);
    }
  },
  {
    version: 3,
    name: "speaches-connections",
    up: (database) => {
      database.exec(MIGRATION_3_SQL);
    }
  },
  {
    version: 4,
    name: "project-transition-pauses",
    up: (database) => {
      database.exec(MIGRATION_4_SQL);
    }
  },
  {
    version: 5,
    name: "render-execution",
    up: (database) => {
      database.exec(MIGRATION_5_SQL);
    }
  },
  {
    version: 6,
    name: "render-review-media",
    up: (database) => {
      database.exec(MIGRATION_6_SQL);
    }
  },
  {
    version: 7,
    name: "single-speaches-connection",
    up: (database) => {
      database.exec(MIGRATION_7_SQL);
    }
  },
  {
    version: 8,
    name: "simplified-global-lexicon",
    up: migrateSimplifiedGlobalLexicon
  }
]);

interface VersionRow { version: number }

export interface MigrationResult {
  database: DatabaseLike;
  databasePath: string;
  databaseSchemaVersion: number;
  appliedVersions: number[];
  backupPath: string | null;
}

function validateMigrations(migrations: readonly Migration[]) {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new Error("Migrations must be consecutive and start at version 1.");
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

function backupFilename(databasePath: string, from: number, to: number, now: Date): string {
  const extension = extname(databasePath) || ".sqlite";
  const stem = basename(databasePath, extname(databasePath));
  const timestamp = now.toISOString().replace(/[:.]/gu, "-");
  return `${stem}-v${String(from)}-to-v${String(to)}-${timestamp}${extension}`;
}

async function latestBackup(databasePath: string): Promise<string | null> {
  const backupDirectory = join(dirname(databasePath), "backups");
  try {
    const stem = `${basename(databasePath, extname(databasePath))}-v`;
    const names = (await readdir(backupDirectory)).filter((name) => name.startsWith(stem)).sort();
    return names.length === 0 ? null : join(backupDirectory, names.at(-1)!);
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
  if (options.migrations === undefined && targetVersion !== DATABASE_SCHEMA_VERSION) {
    throw new Error("The migration registry does not match the shared database schema version.");
  }

  await mkdir(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  const existed = await isExistingDatabase(options.databasePath);
  const database = new options.Database(options.databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");

  let currentVersion = 0;
  let backupPath: string | null = null;
  const appliedVersions: number[] = [];

  try {
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
    if (table) {
      const row = database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as VersionRow;
      currentVersion = Number(row.version);
    }
    if (currentVersion > targetVersion) throw new Error("The database schema is newer than this application supports.");

    if (existed && currentVersion < targetVersion) {
      const backupDirectory = join(dirname(options.databasePath), "backups");
      await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      backupPath = join(backupDirectory, backupFilename(options.databasePath, currentVersion, targetVersion, (options.now ?? (() => new Date()))()));
      await database.backup(backupPath);
      await chmod(backupPath, 0o600);
    }

    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue;
      database.exec("BEGIN IMMEDIATE;");
      try {
        migration.up(database);
        database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(migration.version, (options.now ?? (() => new Date()))().toISOString());
        database.pragma(`user_version = ${String(migration.version)}`);
        database.exec("COMMIT;");
        currentVersion = migration.version;
        appliedVersions.push(migration.version);
      } catch (error) {
        try { database.exec("ROLLBACK;"); } catch { /* transaction did not start */ }
        throw error;
      }
    }
    await chmod(options.databasePath, 0o600);
    backupPath ??= await latestBackup(options.databasePath);
    return { database, databasePath: options.databasePath, databaseSchemaVersion: currentVersion, appliedVersions, backupPath };
  } catch {
    database.close();
    throw new MigrationFailureError(
      "StudyNarrator could not migrate its database. The previous data remains recoverable from the protected backup.",
      options.databasePath,
      backupPath,
      currentVersion
    );
  }
}
