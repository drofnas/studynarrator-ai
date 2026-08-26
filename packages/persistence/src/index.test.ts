import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  listBackups,
  listPersistenceBackups,
  MigrationFailureError,
  PersistenceNotFoundError,
  pruneBackups,
  STUDYNARRATOR_MIGRATIONS,
  migrateDatabase,
  openStudyNarratorRepository,
  SchemaTooNewError,
  type BackupRecord,
  type DatabaseConstructor,
  type Migration,
} from "./index.js";
import {
  DATABASE_SCHEMA_VERSION,
  DEFAULT_RETENTION_SETTINGS,
  GLOBAL_LEXICON_BUILT_INS,
} from "@studynarrator/shared-types";

const DatabaseAdapter = Database as unknown as DatabaseConstructor;
const projectId = "00000000-0000-4000-8000-000000000001";
const lexiconId = "00000000-0000-4000-8000-000000000003";
const duplicateProjectId = "00000000-0000-4000-8000-000000000005";
const duplicateLexiconId = "00000000-0000-4000-8000-000000000006";

async function temporaryDatabase(name: string) {
  return join(await mkdtemp(join(tmpdir(), name)), "studynarrator.sqlite");
}

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? "00000000-0000-4000-8000-ffffffffffff";
}

function columns(database: Database.Database, table: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>
  ).map(({ name }) => name);
}

describe("database baseline", () => {
  it("applies current migrations, seeds singleton defaults, and reopens idempotently", async () => {
    const databasePath = await temporaryDatabase("studynarrator-v1-baseline-");
    const first = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(
      STUDYNARRATOR_MIGRATIONS.map(({ version, name }) => ({ version, name })),
    ).toEqual([
      { version: 1, name: "v1-baseline" },
      { version: 2, name: "project-speech-cache-lifecycle" },
      { version: 3, name: "global-named-sense-defaults" },
      { version: 4, name: "neutral-speech-backend-naming" },
      { version: 5, name: "voice-timing-calibration" },
      { version: 6, name: "retention-settings" },
      { version: 7, name: "render-pinning" },
      { version: 8, name: "global-lexicon-entry-kinds" },
      { version: 9, name: "global-lexicon-catalog-reconciliation" },
      { version: 10, name: "global-lexicon-import-reconciliation" },
      { version: 11, name: "global-lexicon-collision-deduplication" },
      { version: 12, name: "global-lexicon-pronunciation-reconciliation" },
    ]);
    expect(first.appliedVersions).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(first.databaseSchemaVersion).toBe(12);
    expect(first.backupPath).toBeNull();
    expect(
      first.database.prepare("SELECT version FROM schema_migrations").all(),
    ).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
    ]);
    expect(
      first.database
        .prepare(
          "SELECT singleton_id, base_url, supplied_url_form FROM speech_backend_connection",
        )
        .all(),
    ).toEqual([
      { singleton_id: 1, base_url: null, supplied_url_form: "unconfigured" },
    ]);
    expect(
      first.database
        .prepare(
          "SELECT pause_id, duration_ms FROM system_pause_presets ORDER BY ordinal",
        )
        .all(),
    ).toEqual([
      { pause_id: "pause_short", duration_ms: 350 },
      { pause_id: "pause_medium", duration_ms: 750 },
      { pause_id: "pause_long", duration_ms: 1_500 },
    ]);
    expect(
      first.database
        .prepare(
          "SELECT display_text, sense_id, spoken_text FROM lexicon_entries WHERE scope = 'global' ORDER BY ordinal",
        )
        .all(),
    ).toHaveLength(45);
    expect(
      first.database
        .prepare(
          "SELECT display_text, sense_id, spoken_text, entry_kind FROM lexicon_entries WHERE id = ?",
        )
        .get("10000000-0000-4000-8000-000000000009"),
    ).toEqual({
      display_text: "resume",
      sense_id: "cv",
      spoken_text: "rez.oo.may",
      entry_kind: "builtIn",
    });
    first.database
      .prepare("DELETE FROM lexicon_entries WHERE scope = 'global'")
      .run();
    first.database.close();

    const second = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(second.appliedVersions).toEqual([]);
    expect(
      second.database
        .prepare(
          "SELECT count(*) AS count FROM lexicon_entries WHERE scope = 'global'",
        )
        .get(),
    ).toEqual({ count: 0 });
    second.database.close();
  });

  it("reconciles built-ins to the current catalog while preserving custom globals and enabled state", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-global-lexicon-reconciliation-",
    );
    const v7 = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 7),
    });
    const timestamp = "2026-08-23T00:00:00.000Z";
    v7.database
      .prepare(
        `UPDATE lexicon_entries
         SET spoken_text = ?, case_sensitive = 1, enabled = 0
         WHERE id = ?`,
      )
      .run("obsolete", "10000000-0000-4000-8000-000000000009");
    v7.database
      .prepare(
        `INSERT INTO lexicon_entries (
          id, scope, project_id, ordinal, entry_type, display_text, sense_id,
          spoken_text, case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
        ) VALUES (?, 'global', NULL, ?, 'exactTerm', ?, NULL, ?, 0, 1, 0, 1, '', ?, ?)`,
      )
      .run(
        "20000000-0000-4000-8000-000000000001",
        44,
        "CLI",
        "C L I",
        timestamp,
        timestamp,
      );
    v7.database
      .prepare(
        `INSERT INTO lexicon_entries (
          id, scope, project_id, ordinal, entry_type, display_text, sense_id,
          spoken_text, case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
        ) VALUES (?, 'global', NULL, ?, 'exactTerm', ?, NULL, ?, 1, 1, 7, 0, 'v7 collision metadata', ?, ?)`,
      )
      .run(
        "10000000-0000-4000-8000-000000000045",
        45,
        "custom iframe",
        "custom.i.frame",
        timestamp,
        timestamp,
      );
    v7.database.close();

    const upgraded = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(upgraded.appliedVersions).toEqual([8, 9, 10, 11, 12]);
    expect(
      upgraded.database
        .prepare(
          "SELECT id, display_text, spoken_text, case_sensitive, enabled FROM lexicon_entries WHERE id = ?",
        )
        .get("10000000-0000-4000-8000-000000000009"),
    ).toEqual({
      id: "10000000-0000-4000-8000-000000000009",
      display_text: "resume",
      spoken_text: "rez.oo.may",
      case_sensitive: 0,
      enabled: 0,
    });
    expect(
      upgraded.database
        .prepare(
          "SELECT display_text, spoken_text, entry_kind, enabled FROM lexicon_entries WHERE id = ?",
        )
        .get("10000000-0000-4000-8000-000000000045"),
    ).toEqual({
      display_text: "iframe",
      spoken_text: "iFrame",
      entry_kind: "builtIn",
      enabled: 1,
    });
    const preservedCustom = upgraded.database
      .prepare(
        "SELECT id, display_text, entry_kind, spoken_text, case_sensitive, priority, enabled, notes, created_at, updated_at FROM lexicon_entries WHERE display_text = ?",
      )
      .get("custom iframe") as unknown as {
      id: string;
      display_text: string;
      entry_kind: string;
      spoken_text: string;
      case_sensitive: number;
      priority: number;
      enabled: number;
      notes: string;
      created_at: string;
      updated_at: string;
    };
    expect(preservedCustom.id).not.toMatch(/000000000045$/u);
    expect(preservedCustom).toEqual({
      id: preservedCustom.id,
      display_text: "custom iframe",
      entry_kind: "custom",
      spoken_text: "custom.i.frame",
      case_sensitive: 1,
      priority: 7,
      enabled: 0,
      notes: "v7 collision metadata",
      created_at: timestamp,
      updated_at: timestamp,
    });
    expect(
      upgraded.database
        .prepare(
          "SELECT id FROM lexicon_entries WHERE id IN (?, ?) ORDER BY id",
        )
        .all(
          "10000000-0000-4000-8000-000000000001",
          "10000000-0000-4000-8000-000000000023",
        ),
    ).toEqual([]);
    expect(
      upgraded.database
        .prepare(
          "SELECT entry_kind, spoken_text, enabled FROM lexicon_entries WHERE id = ?",
        )
        .get("20000000-0000-4000-8000-000000000001"),
    ).toEqual({ entry_kind: "custom", spoken_text: "C L I", enabled: 1 });
    expect(() =>
      upgraded.database
        .prepare("UPDATE lexicon_entries SET entry_kind = ? WHERE id = ?")
        .run("invalid", "20000000-0000-4000-8000-000000000001"),
    ).toThrow(/CHECK constraint failed/u);
    upgraded.database.close();

    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(repository.listGlobalLexicon()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayText: "custom iframe",
          caseSensitive: true,
          priority: 7,
          notes: "v7 collision metadata",
        }),
      ]),
    );
    expect(repository.getGlobalLexiconState().custom).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayText: "custom iframe",
          caseSensitive: true,
          priority: 7,
          notes: "v7 collision metadata",
        }),
      ]),
    );
    repository.close();
  });

  it("removes migration-created custom copies of existing built-ins", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-global-lexicon-collision-deduplication-",
    );
    const v7 = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 7),
    });
    const timestamp = "2026-08-24T00:00:00.000Z";
    const insertLegacyBuiltIn = v7.database.prepare(`
      INSERT INTO lexicon_entries (
        id, scope, project_id, ordinal, entry_type, display_text, sense_id,
        spoken_text, case_sensitive, whole_word, priority, enabled, notes,
        created_at, updated_at
      ) VALUES (?, 'global', NULL, ?, 'exactTerm', ?, NULL, ?, 0, 1, 0, ?, '', ?, ?)
    `);
    [
      {
        id: "10000000-0000-4000-8000-000000000045",
        ordinal: 36,
        displayText: "iframe",
        spokenText: "iFrame",
        enabled: 0,
      },
      {
        id: "10000000-0000-4000-8000-000000000046",
        ordinal: 37,
        displayText: "prefetch",
        spokenText: "PreFetch",
        enabled: 1,
      },
      {
        id: "10000000-0000-4000-8000-000000000047",
        ordinal: 38,
        displayText: "database",
        spokenText: "DataBase",
        enabled: 0,
      },
    ].forEach((entry) => {
      insertLegacyBuiltIn.run(
        entry.id,
        entry.ordinal,
        entry.displayText,
        entry.spokenText,
        entry.enabled,
        timestamp,
        timestamp,
      );
    });
    v7.database
      .prepare(
        `INSERT INTO lexicon_entries (
          id, scope, project_id, ordinal, entry_type, display_text, sense_id,
          spoken_text, case_sensitive, whole_word, priority, enabled, notes,
          created_at, updated_at
        ) VALUES (?, 'global', NULL, ?, 'exactTerm', ?, NULL, ?, 0, 1, 3, 1, ?, ?, ?)`,
      )
      .run(
        "30000000-0000-4000-8000-000000000045",
        39,
        "iframe",
        "iFrame",
        "intentional custom metadata",
        timestamp,
        timestamp,
      );
    v7.database.close();

    const v10 = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 10),
    });
    expect(
      v10.database
        .prepare(
          `SELECT count(*) AS count FROM lexicon_entries
           WHERE scope = 'global' AND entry_kind = 'custom'
             AND display_text IN ('iframe', 'prefetch', 'database')
             AND priority = 0 AND notes = ''`,
        )
        .get(),
    ).toEqual({ count: 3 });
    expect(
      v10.database
        .prepare(
          `SELECT display_text, enabled FROM lexicon_entries
           WHERE id IN (?, ?, ?) ORDER BY id`,
        )
        .all(
          "10000000-0000-4000-8000-000000000045",
          "10000000-0000-4000-8000-000000000046",
          "10000000-0000-4000-8000-000000000047",
        ),
    ).toEqual([
      { display_text: "iframe", enabled: 1 },
      { display_text: "prefetch", enabled: 1 },
      { display_text: "database", enabled: 1 },
    ]);
    v10.database.close();

    const upgraded = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(upgraded.appliedVersions).toEqual([11, 12]);
    expect(upgraded.databaseSchemaVersion).toBe(12);
    expect(
      upgraded.database
        .prepare(
          `SELECT count(*) AS count FROM lexicon_entries
           WHERE scope = 'global' AND entry_kind = 'custom'
             AND display_text IN ('iframe', 'prefetch', 'database')
             AND priority = 0 AND notes = ''`,
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      upgraded.database
        .prepare(
          `SELECT display_text, entry_kind, enabled FROM lexicon_entries
           WHERE id IN (?, ?, ?) ORDER BY id`,
        )
        .all(
          "10000000-0000-4000-8000-000000000045",
          "10000000-0000-4000-8000-000000000046",
          "10000000-0000-4000-8000-000000000047",
        ),
    ).toEqual([
      { display_text: "iframe", entry_kind: "builtIn", enabled: 0 },
      { display_text: "prefetch", entry_kind: "builtIn", enabled: 1 },
      { display_text: "database", entry_kind: "builtIn", enabled: 0 },
    ]);
    expect(
      upgraded.database
        .prepare(
          "SELECT entry_kind, priority, notes FROM lexicon_entries WHERE id = ?",
        )
        .get("30000000-0000-4000-8000-000000000045"),
    ).toEqual({
      entry_kind: "custom",
      priority: 3,
      notes: "intentional custom metadata",
    });
    upgraded.database.close();
  });

  it("reconciles released schema-v9 built-ins without losing colliding custom data", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-v10-global-lexicon-reconciliation-",
    );
    const v9 = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 9),
    });
    const timestamp = "2026-08-25T00:00:00.000Z";
    v9.database
      .prepare(
        `UPDATE lexicon_entries
         SET entry_kind = 'builtIn', ordinal = CASE id WHEN ? THEN 28 ELSE 29 END
         WHERE id IN (?, ?)`,
      )
      .run(
        "10000000-0000-4000-8000-000000000037",
        "10000000-0000-4000-8000-000000000037",
        "10000000-0000-4000-8000-000000000038",
      );
    v9.database
      .prepare(
        `UPDATE lexicon_entries SET ordinal = ordinal + 2
         WHERE entry_kind = 'builtIn' AND id BETWEEN ? AND ?`,
      )
      .run(
        "10000000-0000-4000-8000-000000000039",
        "10000000-0000-4000-8000-000000000047",
      );
    v9.database
      .prepare("UPDATE lexicon_entries SET enabled = 0 WHERE id = ?")
      .run("10000000-0000-4000-8000-000000000009");
    v9.database
      .prepare("DELETE FROM lexicon_entries WHERE id IN (?, ?, ?)")
      .run(
        "10000000-0000-4000-8000-000000000048",
        "10000000-0000-4000-8000-000000000049",
        "10000000-0000-4000-8000-000000000050",
      );
    v9.database
      .prepare(
        `INSERT INTO lexicon_entries (
          id, scope, project_id, entry_kind, ordinal, entry_type, display_text, sense_id,
          spoken_text, case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
        ) VALUES (?, 'global', NULL, 'custom', ?, 'exactTerm', ?, NULL, ?, 1, 1, 7, 0, ?, ?, ?)`,
      )
      .run(
        "10000000-0000-4000-8000-000000000048",
        48,
        "custom reranker",
        "custom.re.ranker",
        "v9 collision metadata",
        timestamp,
        timestamp,
      );
    expect(
      v9.database
        .prepare(
          `SELECT count(*) AS count, count(DISTINCT ordinal) AS distinct_ordinals,
                  min(ordinal) AS minimum_ordinal, max(ordinal) AS maximum_ordinal
           FROM lexicon_entries WHERE scope = 'global' AND entry_kind = 'builtIn'`,
        )
        .get(),
    ).toEqual({
      count: 44,
      distinct_ordinals: 44,
      minimum_ordinal: 0,
      maximum_ordinal: 44,
    });
    v9.database.close();

    const upgraded = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(upgraded.appliedVersions).toEqual([10, 11, 12]);
    expect(
      upgraded.database
        .prepare(
          "SELECT display_text, spoken_text, enabled FROM lexicon_entries WHERE id = ?",
        )
        .get("10000000-0000-4000-8000-000000000009"),
    ).toEqual({
      display_text: "resume",
      spoken_text: "rez.oo.may",
      enabled: 0,
    });
    expect(
      upgraded.database
        .prepare(
          "SELECT id FROM lexicon_entries WHERE id IN (?, ?) ORDER BY id",
        )
        .all(
          "10000000-0000-4000-8000-000000000037",
          "10000000-0000-4000-8000-000000000038",
        ),
    ).toEqual([]);
    expect(
      upgraded.database
        .prepare(
          "SELECT ordinal, display_text, spoken_text FROM lexicon_entries WHERE id IN (?, ?, ?) ORDER BY id",
        )
        .all(
          "10000000-0000-4000-8000-000000000048",
          "10000000-0000-4000-8000-000000000049",
          "10000000-0000-4000-8000-000000000050",
        ),
    ).toEqual([
      { ordinal: 37, display_text: "reranker", spoken_text: "ree.ranker" },
      { ordinal: 38, display_text: "reranking", spoken_text: "ree.ranking" },
      {
        ordinal: 39,
        display_text: "illustrative",
        spoken_text: "illustray.tiv",
      },
    ]);
    const custom = upgraded.database
      .prepare(
        "SELECT id, entry_kind, spoken_text, case_sensitive, priority, enabled, notes FROM lexicon_entries WHERE display_text = ?",
      )
      .get("custom reranker") as {
      id: string;
      entry_kind: string;
      spoken_text: string;
      case_sensitive: number;
      priority: number;
      enabled: number;
      notes: string;
    };
    expect(custom.id).not.toBe("10000000-0000-4000-8000-000000000048");
    expect(custom).toEqual({
      id: custom.id,
      entry_kind: "custom",
      spoken_text: "custom.re.ranker",
      case_sensitive: 1,
      priority: 7,
      enabled: 0,
      notes: "v9 collision metadata",
    });
    expect(
      upgraded.database
        .prepare(
          `SELECT count(*) AS count, count(DISTINCT ordinal) AS distinct_ordinals,
                  min(ordinal) AS minimum_ordinal, max(ordinal) AS maximum_ordinal
           FROM lexicon_entries WHERE scope = 'global' AND entry_kind = 'builtIn'`,
        )
        .get(),
    ).toEqual({
      count: 45,
      distinct_ordinals: 45,
      minimum_ordinal: 0,
      maximum_ordinal: 44,
    });
    upgraded.database.close();
  });

  it("upgrades schema-v11 Global Lexicon rows without losing collisions", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-v12-global-lexicon-reconciliation-",
    );
    const v11 = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 11),
    });
    const timestamp = "2026-08-26T00:00:00.000Z";
    v11.database
      .prepare(
        "UPDATE lexicon_entries SET spoken_text = ?, enabled = 0 WHERE id = ?",
      )
      .run("obsolete", "10000000-0000-4000-8000-000000000048");
    v11.database
      .prepare("DELETE FROM lexicon_entries WHERE id IN (?, ?, ?, ?, ?)")
      .run(
        "10000000-0000-4000-8000-000000000051",
        "10000000-0000-4000-8000-000000000052",
        "10000000-0000-4000-8000-000000000053",
        "10000000-0000-4000-8000-000000000054",
        "10000000-0000-4000-8000-000000000055",
      );
    v11.database
      .prepare(
        `INSERT INTO lexicon_entries (
          id, scope, project_id, entry_kind, ordinal, entry_type, display_text, sense_id,
          spoken_text, case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
        ) VALUES (?, 'global', NULL, 'custom', ?, 'exactTerm', ?, NULL, ?, 1, 1, 7, 0, ?, ?, ?)`,
      )
      .run(
        "10000000-0000-4000-8000-000000000051",
        40,
        "custom coordinates",
        "custom.cord.in.its",
        "v11 collision metadata",
        timestamp,
        timestamp,
      );
    v11.database.close();

    const upgraded = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(upgraded.appliedVersions).toEqual([12]);
    expect(upgraded.databaseSchemaVersion).toBe(12);
    expect(
      upgraded.database
        .prepare(
          "SELECT spoken_text, enabled FROM lexicon_entries WHERE id IN (?, ?) ORDER BY id",
        )
        .all(
          "10000000-0000-4000-8000-000000000048",
          "10000000-0000-4000-8000-000000000049",
        ),
    ).toEqual([
      { spoken_text: "ree.ranker", enabled: 0 },
      { spoken_text: "ree.ranking", enabled: 1 },
    ]);
    expect(
      upgraded.database
        .prepare(
          "SELECT entry_type, display_text, sense_id, spoken_text FROM lexicon_entries WHERE id IN (?, ?, ?, ?, ?) ORDER BY id",
        )
        .all(
          "10000000-0000-4000-8000-000000000051",
          "10000000-0000-4000-8000-000000000052",
          "10000000-0000-4000-8000-000000000053",
          "10000000-0000-4000-8000-000000000054",
          "10000000-0000-4000-8000-000000000055",
        ),
    ).toEqual([
      {
        entry_type: "namedSense",
        display_text: "coordinates",
        sense_id: "location",
        spoken_text: "cord.in.its",
      },
      {
        entry_type: "namedSense",
        display_text: "coordinates",
        sense_id: "organize",
        spoken_text: "cord.in.ates",
      },
      {
        entry_type: "namedSense",
        display_text: "coordinate",
        sense_id: "location",
        spoken_text: "cord.in.it",
      },
      {
        entry_type: "namedSense",
        display_text: "coordinate",
        sense_id: "organize",
        spoken_text: "cord.in.ate",
      },
      {
        entry_type: "exactTerm",
        display_text: "solr",
        sense_id: null,
        spoken_text: "solar",
      },
    ]);
    const collision = upgraded.database
      .prepare(
        "SELECT id, entry_kind, spoken_text, case_sensitive, priority, enabled, notes FROM lexicon_entries WHERE display_text = ?",
      )
      .get("custom coordinates") as { id: string } & Record<string, unknown>;
    expect(collision).toEqual({
      id: collision.id,
      entry_kind: "custom",
      spoken_text: "custom.cord.in.its",
      case_sensitive: 1,
      priority: 7,
      enabled: 0,
      notes: "v11 collision metadata",
    });
    expect(collision.id).not.toBe("10000000-0000-4000-8000-000000000051");
    upgraded.database.close();
  });

  it("creates the constrained voice timing calibration table", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-voice-timing-schema-",
    );
    const migrated = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    const database = migrated.database as Database.Database;

    expect(columns(database, "voice_timing_calibration")).toEqual([
      "model_id",
      "voice_id",
      "milliseconds_per_normalized_character",
      "sample_count",
      "updated_at",
    ]);
    expect(
      (
        database
          .prepare("PRAGMA table_info(voice_timing_calibration)")
          .all() as Array<{
          name: string;
          notnull: number;
          pk: number;
        }>
      )
        .filter(({ pk }) => pk > 0)
        .map(({ name, notnull, pk }) => ({ name, notnull, pk })),
    ).toEqual([
      { name: "model_id", notnull: 1, pk: 1 },
      { name: "voice_id", notnull: 1, pk: 2 },
    ]);

    const insert = database.prepare(`
      INSERT INTO voice_timing_calibration (
        model_id, voice_id, milliseconds_per_normalized_character, sample_count, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    expect(() =>
      insert.run("model", "zero-average", 0, 1, "2026-08-21T00:00:00.000Z"),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insert.run("model", "zero-count", 1, 0, "2026-08-21T00:00:00.000Z"),
    ).toThrow(/CHECK constraint failed/u);
    migrated.database.close();
  });

  it("creates constrained singleton retention settings with conservative defaults", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-retention-settings-schema-",
    );
    const migrated = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    const database = migrated.database as Database.Database;

    expect(columns(database, "retention_settings")).toEqual([
      "singleton_id",
      "speech_cache_ttl",
      "job_snapshot_ttl",
      "render_artifact_ttl",
      "speech_cache_size_cap_bytes",
      "updated_at",
    ]);
    const seeded = database
      .prepare("SELECT * FROM retention_settings")
      .get() as Record<string, unknown>;
    expect(seeded).toMatchObject({
      singleton_id: 1,
      speech_cache_ttl: DEFAULT_RETENTION_SETTINGS.speechCacheTtl,
      job_snapshot_ttl: DEFAULT_RETENTION_SETTINGS.jobSnapshotTtl,
      render_artifact_ttl: DEFAULT_RETENTION_SETTINGS.renderArtifactTtl,
      speech_cache_size_cap_bytes:
        DEFAULT_RETENTION_SETTINGS.speechCacheSizeCapBytes,
    });
    expect(new Date(String(seeded.updated_at)).toISOString()).toBe(
      seeded.updated_at,
    );

    for (const column of [
      "speech_cache_ttl",
      "job_snapshot_ttl",
      "render_artifact_ttl",
    ]) {
      expect(() =>
        database
          .prepare(`UPDATE retention_settings SET ${column} = ?`)
          .run("30d"),
      ).toThrow(/CHECK constraint failed/u);
    }
    expect(() =>
      database
        .prepare(
          "UPDATE retention_settings SET speech_cache_size_cap_bytes = ?",
        )
        .run(0),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      database
        .prepare(
          "UPDATE retention_settings SET speech_cache_size_cap_bytes = ?",
        )
        .run(1.5),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      database
        .prepare(
          `
          INSERT INTO retention_settings (
            singleton_id, speech_cache_ttl, job_snapshot_ttl, render_artifact_ttl,
            speech_cache_size_cap_bytes, updated_at
          ) VALUES (2, '8h', '24h', '7d', 1, ?)
        `,
        )
        .run("2026-08-21T00:00:00.000Z"),
    ).toThrow(/CHECK constraint failed/u);
    expect(
      database
        .prepare("SELECT count(*) AS count FROM retention_settings")
        .get(),
    ).toEqual({ count: 1 });
    migrated.database.close();
  });

  it("adds a constrained pinned default to existing render jobs", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-render-pinning-",
    );
    const v6 = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 6),
    });
    const timestamp = "2026-08-21T00:00:00.000Z";
    v6.database
      .prepare(
        `
        INSERT INTO projects (
          id, name, description, script_source, script_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        projectId,
        "Pinned render project",
        "",
        "",
        "a".repeat(64),
        timestamp,
        timestamp,
      );
    v6.database
      .prepare(
        `
        INSERT INTO render_jobs (
          id, project_id, plan_id, retry_of_render_id, state, progress_json, error_json,
          created_at, started_at, finished_at
        ) VALUES (?, ?, ?, NULL, 'queued', '{}', NULL, ?, NULL, NULL)
      `,
      )
      .run(
        "render-before-pinning",
        projectId,
        "plan-before-pinning",
        timestamp,
      );
    v6.database.close();

    const upgraded = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    const database = upgraded.database as Database.Database;
    expect(
      database
        .prepare("SELECT pinned FROM render_jobs WHERE id = ?")
        .get("render-before-pinning"),
    ).toEqual({ pinned: 0 });
    expect(() =>
      database
        .prepare("UPDATE render_jobs SET pinned = ? WHERE id = ?")
        .run(2, "render-before-pinning"),
    ).toThrow(/CHECK constraint failed/u);
    database.close();
  });

  it("seeds the current global lexicon catalog", async () => {
    const databasePath = await temporaryDatabase("studynarrator-frozen-seed-");
    const first = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(
      first.database
        .prepare(
          "SELECT id, entry_type, display_text, sense_id, spoken_text FROM lexicon_entries WHERE scope = 'global' ORDER BY id",
        )
        .all(),
    ).toEqual(
      GLOBAL_LEXICON_BUILT_INS.map((entry) => ({
        id: entry.id,
        entry_type: entry.entryType,
        display_text: entry.displayText,
        sense_id: entry.entryType === "namedSense" ? entry.senseId : null,
        spoken_text: entry.spokenText,
      })),
    );
    first.database.close();
  });

  it("adds named-sense defaults once to schema-v2 data without overwriting user choices", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-v3-named-senses-",
    );
    const v2 = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 2),
    });
    v2.database
      .prepare("DELETE FROM lexicon_entries WHERE entry_type = 'namedSense'")
      .run();
    v2.database
      .prepare(
        `
      INSERT INTO lexicon_entries (
        id, scope, project_id, ordinal, entry_type, display_text, sense_id, spoken_text,
        case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
      ) VALUES (?, 'global', NULL, ?, 'exactTerm', ?, NULL, ?, 0, 1, 0, 0, '', ?, ?)
    `,
      )
      .run(
        "20000000-0000-4000-8000-000000000001",
        8,
        "CLI",
        "C L I",
        "2026-08-12T12:00:00.000Z",
        "2026-08-12T12:00:00.000Z",
      );
    v2.database
      .prepare(
        `
      INSERT INTO lexicon_entries (
        id, scope, project_id, ordinal, entry_type, display_text, sense_id, spoken_text,
        case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
      ) VALUES (?, 'global', NULL, ?, 'namedSense', ?, ?, ?, 0, 1, 0, 0, '', ?, ?)
    `,
      )
      .run(
        "20000000-0000-4000-8000-000000000002",
        9,
        "Resume",
        "CV",
        "my résumé",
        "2026-08-12T12:00:00.000Z",
        "2026-08-12T12:00:00.000Z",
      );
    v2.database.close();

    const logger = { info: vi.fn(), warn: vi.fn() };
    const upgraded = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      logger,
    });
    expect(upgraded.appliedVersions).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(upgraded.databaseSchemaVersion).toBe(12);
    expect(upgraded.backupPath).toContain("-v0002-to-v0012-");
    if (upgraded.backupPath === null)
      throw new Error("Expected the migration backup path.");
    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      {
        event: "database-migration-backup-created",
        backupPath: upgraded.backupPath,
        fromDatabaseSchemaVersion: 2,
        toDatabaseSchemaVersion: 12,
      },
      "Database migration backup created",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      2,
      {
        event: "database-migration-applied",
        migrationVersion: 3,
        migrationName: "global-named-sense-defaults",
      },
      "Database migration applied",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      3,
      {
        event: "database-migration-applied",
        migrationVersion: 4,
        migrationName: "neutral-speech-backend-naming",
      },
      "Database migration applied",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      4,
      {
        event: "database-migration-applied",
        migrationVersion: 5,
        migrationName: "voice-timing-calibration",
      },
      "Database migration applied",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      5,
      {
        event: "database-migration-applied",
        migrationVersion: 6,
        migrationName: "retention-settings",
      },
      "Database migration applied",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      6,
      {
        event: "database-migration-applied",
        migrationVersion: 7,
        migrationName: "render-pinning",
      },
      "Database migration applied",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      7,
      {
        event: "database-migration-applied",
        migrationVersion: 8,
        migrationName: "global-lexicon-entry-kinds",
      },
      "Database migration applied",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      8,
      {
        event: "database-migration-applied",
        migrationVersion: 9,
        migrationName: "global-lexicon-catalog-reconciliation",
      },
      "Database migration applied",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      9,
      {
        event: "database-migration-applied",
        migrationVersion: 10,
        migrationName: "global-lexicon-import-reconciliation",
      },
      "Database migration applied",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      10,
      {
        event: "database-migration-applied",
        migrationVersion: 11,
        migrationName: "global-lexicon-collision-deduplication",
      },
      "Database migration applied",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      11,
      {
        event: "database-migration-applied",
        migrationVersion: 12,
        migrationName: "global-lexicon-pronunciation-reconciliation",
      },
      "Database migration applied",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      12,
      {
        event: "database-backups-pruned",
        removedCount: 0,
        retainedCount: 1,
        removedPaths: [],
        retainedPaths: [upgraded.backupPath],
      },
      "Database backups pruned",
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(
      upgraded.database
        .prepare(
          "SELECT count(*) AS count FROM lexicon_entries WHERE entry_type = 'namedSense'",
        )
        .get(),
    ).toEqual({ count: 37 });
    expect(
      upgraded.database
        .prepare(
          "SELECT spoken_text, enabled FROM lexicon_entries WHERE id = ?",
        )
        .get("20000000-0000-4000-8000-000000000002"),
    ).toEqual({ spoken_text: "my résumé", enabled: 0 });
    expect(
      upgraded.database
        .prepare(
          "SELECT spoken_text, enabled FROM lexicon_entries WHERE id = ?",
        )
        .get("20000000-0000-4000-8000-000000000001"),
    ).toEqual({ spoken_text: "C L I", enabled: 0 });
    upgraded.database
      .prepare("DELETE FROM lexicon_entries WHERE id = ?")
      .run("10000000-0000-4000-8000-000000000010");
    upgraded.database.close();

    const reopened = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(reopened.appliedVersions).toEqual([]);
    expect(
      reopened.database
        .prepare(
          "SELECT count(*) AS count FROM lexicon_entries WHERE entry_type = 'namedSense'",
        )
        .get(),
    ).toEqual({ count: 36 });
    expect(
      reopened.database
        .prepare("SELECT id FROM lexicon_entries WHERE id = ?")
        .get("10000000-0000-4000-8000-000000000010"),
    ).toBeUndefined();
    reopened.database.close();
  });

  it("preserves the connection row across the speech backend rename", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-v3-connection-rename-",
    );
    const v3 = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 3),
    });
    // In the v3 shape the connection row still lives in the pre-rename
    // table; locate it by shape rather than by its old name.
    const legacyConnectionTables = (
      v3.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_connection' AND name != 'connection_setup' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map(({ name }) => name);
    expect(legacyConnectionTables).toHaveLength(1);
    const legacyConnectionTable = legacyConnectionTables[0];
    const now = "2026-08-19T00:00:00.000Z";
    v3.database
      .prepare(
        `UPDATE ${legacyConnectionTable} SET base_url = ?, default_model_id = ?, default_voice_id = ?, created_at = ?, updated_at = ? WHERE singleton_id = 1`,
      )
      .run("https://example.test", "model-x", "voice-y", now, now);
    expect(
      v3.database
        .prepare(
          `SELECT base_url, default_model_id, default_voice_id FROM ${legacyConnectionTable} WHERE singleton_id = 1`,
        )
        .get(),
    ).toEqual({
      base_url: "https://example.test",
      default_model_id: "model-x",
      default_voice_id: "voice-y",
    });
    v3.database.close();

    const upgraded = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(upgraded.appliedVersions).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(upgraded.databaseSchemaVersion).toBe(12);
    expect(
      upgraded.database
        .prepare(
          "SELECT base_url, default_model_id, default_voice_id, backend_id, created_at, updated_at FROM speech_backend_connection WHERE singleton_id = 1",
        )
        .get(),
    ).toEqual({
      base_url: "https://example.test",
      default_model_id: "model-x",
      default_voice_id: "voice-y",
      backend_id: "speaches",
      created_at: now,
      updated_at: now,
    });
    expect(
      upgraded.database
        .prepare("SELECT name FROM sqlite_master WHERE name = ?")
        .get(legacyConnectionTable),
    ).toBeUndefined();
    upgraded.database.close();
  });

  it("contains only current tables and no legacy columns", async () => {
    const databasePath = await temporaryDatabase("studynarrator-v1-shape-");
    const migrated = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    const tables = (
      migrated.database
        .prepare(
          `
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `,
        )
        .all() as Array<{ name: string }>
    ).map(({ name }) => name);
    expect(tables).toContain("schema_migrations");
    const schemaVersion = (
      migrated.database
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
        )
        .get() as { version: number }
    ).version;
    expect(schemaVersion).toBe(DATABASE_SCHEMA_VERSION);
    expect(columns(migrated.database as Database.Database, "projects")).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "description",
        "script_source",
        "script_hash",
        "created_at",
        "updated_at",
      ]),
    );
    expect(tables.filter((table) => table.startsWith("legacy_"))).toEqual([]);
    expect(
      columns(
        migrated.database as Database.Database,
        "speech_backend_connection",
      ),
    ).not.toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "source",
        "api_key_reference",
        "ordinal",
      ]),
    );
    expect(tables).not.toEqual(
      expect.arrayContaining([
        "connection_profiles",
        "pause_presets",
        "system_pacing_defaults",
      ]),
    );
    migrated.database.close();
  });

  it.each([1, 13])(
    "rejects an unsupported pre-release schema %d database without deleting it",
    async (version) => {
      const databasePath = await temporaryDatabase(
        `studynarrator-unsupported-v${String(version)}-`,
      );
      const old = new Database(databasePath);
      old.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE preserved_development_data (value TEXT NOT NULL);
    `);
      old
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        )
        .run(version, "2026-08-11T00:00:00.000Z");
      old
        .prepare("INSERT INTO preserved_development_data (value) VALUES (?)")
        .run("keep-me");
      old.close();

      if (version > 12) {
        await expect(
          migrateDatabase({ Database: DatabaseAdapter, databasePath }),
        ).rejects.toBeInstanceOf(SchemaTooNewError);
        await expect(
          migrateDatabase({ Database: DatabaseAdapter, databasePath }),
        ).rejects.toMatchObject({ code: "SCHEMA_TOO_NEW" });
      } else {
        await expect(
          migrateDatabase({ Database: DatabaseAdapter, databasePath }),
        ).rejects.toBeInstanceOf(MigrationFailureError);
      }
      const inspected = new Database(databasePath, { readonly: true });
      expect(
        inspected.prepare("SELECT value FROM preserved_development_data").get(),
      ).toEqual({ value: "keep-me" });
      expect(
        inspected.prepare("SELECT version FROM schema_migrations").get(),
      ).toEqual({ version });
      inspected.close();
    },
  );

  it("backs up before a future migration and rolls back a failed upgrade", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-future-migration-",
    );
    const baseline = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    baseline.database
      .prepare(
        "INSERT INTO diagnostic_kv (key, value, created_at) VALUES ('fixture', 'safe', '2026-08-11T00:00:00.000Z')",
      )
      .run();
    baseline.database.close();
    const failing: Migration = {
      version: 13,
      name: "intentional-test-failure",
      up(database) {
        database.exec(
          "CREATE TABLE must_rollback (id TEXT); INSERT INTO missing_table VALUES (1);",
        );
      },
    };

    let failure: MigrationFailureError | undefined;
    try {
      await migrateDatabase({
        Database: DatabaseAdapter,
        databasePath,
        migrations: [...STUDYNARRATOR_MIGRATIONS, failing],
      });
    } catch (error) {
      failure = error as MigrationFailureError;
    }
    expect(failure).toBeInstanceOf(MigrationFailureError);
    expect(failure?.backupPath).toContain("-v0012-to-v0013-");
    expect((await stat(failure!.backupPath!)).mode & 0o777).toBe(0o600);
    expect((await readFile(failure!.backupPath!)).byteLength).toBeGreaterThan(
      0,
    );
    const inspected = new Database(databasePath, { readonly: true });
    expect(
      inspected
        .prepare("SELECT value FROM diagnostic_kv WHERE key = 'fixture'")
        .get(),
    ).toEqual({ value: "safe" });
    expect(
      inspected
        .prepare("SELECT name FROM sqlite_master WHERE name = 'must_rollback'")
        .get(),
    ).toBeUndefined();
    inspected.close();
  });
});

describe("StudyNarratorRepository", () => {
  it("keeps custom entries separate while reimporting built-in globals", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-global-lexicon-collections-",
    );
    const first = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      idFactory: ids(lexiconId),
    });
    const custom = first.replaceCustomGlobalLexicon([
      {
        scope: "global",
        entryType: "namedSense",
        displayText: "resume",
        senseId: "profile",
        spokenText: "custom résumé",
        enabled: false,
      },
    ]);
    expect(
      custom.builtIns.find(
        ({ id }) => id === "10000000-0000-4000-8000-000000000009",
      ),
    ).toMatchObject({ entryKind: "builtIn" });
    expect(custom.custom).toMatchObject([
      {
        id: lexiconId,
        entryKind: "custom",
        entryType: "namedSense",
        displayText: "resume",
        senseId: "profile",
        spokenText: "custom résumé",
        enabled: false,
      },
    ]);
    expect(() =>
      first.replaceCustomGlobalLexicon([
        {
          id: "10000000-0000-4000-8000-000000000009",
          scope: "global",
          entryType: "namedSense",
          displayText: "resume",
          senseId: "cv",
          spokenText: "not allowed",
        },
      ]),
    ).toThrow(/another lexicon collection/u);
    first.setBuiltInGlobalLexiconEnabled({
      id: "10000000-0000-4000-8000-000000000009",
      enabled: false,
    });
    const reimported = first.reimportBuiltInGlobalLexicon();
    expect(
      reimported.builtIns.find(
        ({ id }) => id === "10000000-0000-4000-8000-000000000009",
      ),
    ).toMatchObject({ spokenText: "rez.oo.may", enabled: true });
    expect(reimported.custom).toMatchObject([
      { id: lexiconId, spokenText: "custom résumé", enabled: false },
    ]);
    first.close();

    const reopened = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(reopened.getGlobalLexiconState().custom).toMatchObject([
      {
        id: lexiconId,
        entryKind: "custom",
        senseId: "profile",
        enabled: false,
      },
    ]);
    expect(reopened.replaceCustomGlobalLexicon([]).custom).toEqual([]);
    expect(reopened.listGlobalLexicon()).toHaveLength(45);
    reopened.close();
  });

  it("reconciles project cache keys and reverses queued deletion when a prior key is restored", async () => {
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath: await temporaryDatabase(
        "studynarrator-cache-reconciliation-",
      ),
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      idFactory: ids(projectId),
    });
    const created = repository.createProject({ name: "Cache reconciliation" });
    const replacement = {
      name: created.name,
      description: created.description,
      scriptSource: "[speaker_narrator] Original",
      speakerMappings: [
        {
          speakerId: "narrator",
          displayName: "Narrator",
          voiceId: "voice-a",
          speed: 1,
          gainDb: 0,
          roleDescription: "",
          sampleText: "Original",
        },
      ],
      lexiconEntries: [],
    };

    const originalKey = "a".repeat(64);
    const editedKey = "b".repeat(64);
    repository.replaceProject(created.id, replacement, [originalKey]);
    expect(repository.listSpeechCacheDeletionQueue(created.id)).toEqual([]);
    repository.replaceProject(
      created.id,
      { ...replacement, scriptSource: "[speaker_narrator] Edited" },
      [editedKey],
    );
    expect(repository.listSpeechCacheDeletionQueue(created.id)).toEqual([
      originalKey,
    ]);
    repository.replaceProject(created.id, replacement, [originalKey]);
    expect(repository.listSpeechCacheDeletionQueue(created.id)).toEqual([
      editedKey,
    ]);
    repository.acknowledgeSpeechCacheDeletion(created.id, editedKey);
    expect(repository.listSpeechCacheDeletionQueue(created.id)).toEqual([]);
    repository.close();
  });

  it("persists projects and global timing across reopen cycles", async () => {
    const databasePath = await temporaryDatabase("studynarrator-projects-");
    const first = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      idFactory: ids(projectId, lexiconId),
    });
    expect(first.status()).toMatchObject({
      contractVersion: 1,
      databaseSchemaVersion: 12,
    });
    const created = first.createProject({
      name: "Persistence restart proof",
      description: "Restart proof",
    });
    const source = "Résumé line\r\n\r\nSQL line 🧠";
    first.replaceProject(created.id, {
      name: created.name,
      description: created.description,
      scriptSource: source,
      speakerMappings: [
        {
          speakerId: "narrator",
          displayName: "Narrator",
          voiceId: null,
          speed: 1,
          gainDb: 0,
          roleDescription: "",
          sampleText: "Preview",
        },
      ],
      lexiconEntries: [
        {
          id: lexiconId,
          scope: "project",
          entryType: "exactTerm",
          displayText: "SQL",
          spokenText: "sequel",
        },
      ],
    });
    const timing = first.getSystemPacing();
    first.updateSystemPacing({
      ...timing,
      pausePresets: timing.pausePresets.map((pause) =>
        pause.pauseId === "pause_medium"
          ? { ...pause, durationMs: 1_200 }
          : pause,
      ) as typeof timing.pausePresets,
      transitionPauses: {
        ...timing.transitionPauses,
        paragraph: { mode: "none" },
      },
    });
    first.close();

    const reopened = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(reopened.getProject(projectId)).toMatchObject({
      scriptSource: source,
      lexiconEntries: [{ id: lexiconId }],
    });
    expect(reopened.getSystemPacing()).toMatchObject({
      transitionPauses: { paragraph: { mode: "none" } },
    });
    expect(reopened.getSystemPacing().pausePresets[1].durationMs).toBe(1_200);
    reopened.close();
  });

  it("duplicates owned project data with fresh IDs", async () => {
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath: await temporaryDatabase("studynarrator-duplicate-"),
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      idFactory: ids(
        projectId,
        lexiconId,
        duplicateProjectId,
        duplicateLexiconId,
      ),
    });
    const source = repository.createProject({
      name: "Source",
      description: "Copy everything",
    });
    const configured = repository.replaceProject(source.id, {
      name: source.name,
      description: source.description,
      scriptSource: "[speaker_teacher] SQL",
      speakerMappings: [
        {
          speakerId: "teacher",
          displayName: "Teacher",
          voiceId: "voice",
          speed: 1,
          gainDb: 0,
          roleDescription: "Guide",
          sampleText: "SQL",
        },
      ],
      lexiconEntries: [
        {
          id: lexiconId,
          scope: "project",
          entryType: "exactTerm",
          displayText: "SQL",
          spokenText: "sequel",
        },
      ],
    });
    const duplicate = repository.duplicateProject(source.id, {
      name: "Source copy",
    });
    expect(duplicate).toMatchObject({
      id: duplicateProjectId,
      name: "Source copy",
      scriptSource: configured.scriptSource,
    });
    expect(duplicate.lexiconEntries[0]).toMatchObject({
      id: duplicateLexiconId,
      displayText: "SQL",
    });
    repository.close();
  });

  it("persists one application-managed connection, setup state, and voice overrides", async () => {
    const databasePath = await temporaryDatabase("studynarrator-connection-");
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
      now: () => new Date("2026-08-12T12:00:00.000Z"),
    });
    expect(repository.getSpeechBackendConnection()).toMatchObject({
      baseUrl: null,
      configured: false,
    });
    expect(
      repository.replaceSpeechBackendConnection(
        {
          baseUrl: "http://127.0.0.1:18080",
          defaultModelId: "model",
          defaultVoiceId: "voice",
        },
        "root",
      ),
    ).toMatchObject({ baseUrl: "http://127.0.0.1:18080", configured: true });
    expect(repository.completeConnectionOnboarding()).toEqual({
      onboardingCompletedAt: "2026-08-12T12:00:00.000Z",
    });
    repository.replaceVoiceCatalogOverrides({
      schemaVersion: 1,
      modelId: "model",
      entries: [
        { voiceId: "voice", label: "Voice", enabled: false, favorite: true },
      ],
    });
    repository.close();

    const reopened = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(reopened.getSpeechBackendConnection()).toMatchObject({
      defaultModelId: "model",
      defaultVoiceId: "voice",
    });
    expect(reopened.getVoiceCatalogOverrides("model").entries).toEqual([
      {
        voiceId: "voice",
        label: "Voice",
        enabled: false,
        favorite: true,
        language: null,
        locale: null,
        accent: null,
        category: null,
        style: null,
        sampleText: null,
      },
    ]);
    reopened.close();
  });

  it("upserts validated voice timing calibration and persists it across reopen", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-voice-timing-calibration-",
    );
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    const initial = {
      modelId: "model-a",
      voiceId: "voice-a",
      millisecondsPerNormalizedCharacter: 61.25,
      sampleCount: 2,
      updatedAt: "2026-08-21T10:00:00.000Z",
    };

    expect(
      repository.getVoiceTimingCalibration(initial.modelId, initial.voiceId),
    ).toBeNull();
    expect(repository.upsertVoiceTimingCalibration(initial)).toEqual(initial);
    expect(
      repository.getVoiceTimingCalibration(initial.modelId, initial.voiceId),
    ).toEqual(initial);
    expect(() =>
      repository.upsertVoiceTimingCalibration({
        ...initial,
        millisecondsPerNormalizedCharacter: 0,
      }),
    ).toThrow();
    expect(() =>
      repository.upsertVoiceTimingCalibration({ ...initial, sampleCount: 0 }),
    ).toThrow();
    expect(() =>
      repository.upsertVoiceTimingCalibration({
        ...initial,
        updatedAt: "not-a-timestamp",
      }),
    ).toThrow();

    const replacement = {
      ...initial,
      millisecondsPerNormalizedCharacter: 54.5,
      sampleCount: 7,
      updatedAt: "2026-08-21T11:00:00.000Z",
    };
    expect(repository.upsertVoiceTimingCalibration(replacement)).toEqual(
      replacement,
    );
    repository.close();

    const inspected = new Database(databasePath, { readonly: true });
    expect(
      inspected
        .prepare(
          "SELECT count(*) AS count FROM voice_timing_calibration WHERE model_id = ? AND voice_id = ?",
        )
        .get(initial.modelId, initial.voiceId),
    ).toEqual({ count: 1 });
    inspected.close();

    const reopened = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(
      reopened.getVoiceTimingCalibration(initial.modelId, initial.voiceId),
    ).toEqual(replacement);
    reopened.close();
  });

  it("updates validated retention settings and persists them across reopen", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-retention-settings-repository-",
    );
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
      now: () => new Date("2026-08-21T12:00:00.000Z"),
    });
    expect(repository.getRetentionSettings()).toMatchObject(
      DEFAULT_RETENTION_SETTINGS,
    );

    const authored = {
      speechCacheTtl: "8h" as const,
      jobSnapshotTtl: "24h" as const,
      renderArtifactTtl: "7d" as const,
      speechCacheSizeCapBytes: 1_024,
    };
    const expected = {
      ...authored,
      updatedAt: "2026-08-21T12:00:00.000Z",
    };
    expect(repository.updateRetentionSettings(authored)).toEqual(expected);
    expect(repository.getRetentionSettings()).toEqual(expected);
    expect(() =>
      repository.updateRetentionSettings({
        ...authored,
        speechCacheTtl: "30d",
      } as unknown as typeof authored),
    ).toThrow();
    expect(() =>
      repository.updateRetentionSettings({
        ...authored,
        speechCacheSizeCapBytes: 0,
      }),
    ).toThrow();
    repository.close();

    const reopened = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(reopened.getRetentionSettings()).toEqual(expected);
    reopened.close();
  });

  it("throws when the retention settings singleton is missing", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-retention-settings-missing-",
    );
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    repository.close();

    const database = new Database(databasePath);
    database.prepare("DELETE FROM retention_settings").run();
    database.close();

    const reopened = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(() => reopened.getRetentionSettings()).toThrow(
      PersistenceNotFoundError,
    );
    expect(() =>
      reopened.updateRetentionSettings(DEFAULT_RETENTION_SETTINGS),
    ).toThrow(PersistenceNotFoundError);
    reopened.close();
  });

  it("persists marker evidence and durable render state", async () => {
    const databasePath = await temporaryDatabase("studynarrator-render-state-");
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
      idFactory: ids(projectId),
    });
    expect(repository.runMarker()).toMatchObject({
      markerKey: "runtime.storage-self-test",
      migrationVersion: 12,
    });
    const project = repository.createProject({ name: "Rendered" });
    repository.replaceProject(project.id, {
      name: project.name,
      description: project.description,
      scriptSource: "First line\n\nThird line\n",
      speakerMappings: [],
      lexiconEntries: [],
    });
    expect(repository.listProjects()).toEqual([
      expect.objectContaining({ scriptLineCount: 4, audioDurationMs: null }),
    ]);
    const timestamp = "2026-08-13T12:00:00.000Z";
    const renderId = "00000000-0000-4000-8000-000000000020";
    const planId = "00000000-0000-4000-8000-000000000021";
    const artifactId = "00000000-0000-4000-8000-000000000022";
    const progress = {
      phase: "queued" as const,
      sectionTitle: null,
      sectionOrdinal: 0,
      sectionCount: 0,
      entryOrdinal: null,
      speechOrdinal: 0,
      speechCount: 1,
      chunkOrdinal: null,
      completedChunks: 0,
      totalChunks: 1,
      cacheHits: 0,
      cacheMisses: 0,
      ttsRequests: 0,
      speakerId: null,
      voiceId: null,
      excerpt: null,
      elapsedMs: 0,
    };
    const job = repository.createRenderJob(
      {
        contractVersion: 1,
        id: renderId,
        projectId: project.id,
        planId,
        retryOfRenderId: null,
        pinned: false,
        state: "queued",
        progress,
        error: null,
        createdAt: timestamp,
        startedAt: null,
        finishedAt: null,
      },
      [
        {
          renderId,
          ordinal: 1,
          type: "speech",
          state: "pending",
          cacheStatus: null,
          audioDurationMs: null,
          audioFileName: null,
          audioSizeBytes: null,
          audioChecksum: null,
          error: null,
        },
      ],
    );
    expect(job.pinned).toBe(false);
    repository.updateRenderSegment(
      {
        renderId,
        ordinal: 1,
        type: "speech",
        state: "complete",
        cacheStatus: "miss",
        audioDurationMs: 1_000,
        audioFileName: "000001.wav",
        audioSizeBytes: 24_044,
        audioChecksum: "a".repeat(64),
        error: null,
      },
      "/tmp/render/000001.wav",
    );
    const complete = repository.updateRenderJob({
      ...job,
      pinned: true,
      state: "complete",
      progress: { ...progress, phase: "complete", completedChunks: 1 },
      startedAt: timestamp,
      finishedAt: timestamp,
    });
    expect(repository.listPinnedRenderProjectIds()).toEqual([project.id]);
    repository.replaceRenderArtifacts(renderId, [
      {
        contractVersion: 1,
        id: artifactId,
        renderId,
        type: "mp3",
        fileName: "rendered.mp3",
        path: "/scoped/rendered.mp3",
        sizeBytes: 12,
        checksum: "a".repeat(64),
        durationMs: 1_000,
        createdAt: timestamp,
      },
    ]);
    const failedRenderId = "00000000-0000-4000-8000-000000000023";
    repository.createRenderJob(
      {
        contractVersion: 1,
        id: failedRenderId,
        projectId: project.id,
        planId: "00000000-0000-4000-8000-000000000024",
        retryOfRenderId: null,
        pinned: false,
        state: "failed",
        progress: { ...progress, phase: "failed" },
        error: null,
        createdAt: "2026-08-13T13:00:00.000Z",
        startedAt: timestamp,
        finishedAt: "2026-08-13T13:00:00.000Z",
      },
      [],
    );
    const latestRenderId = "00000000-0000-4000-8000-000000000025";
    repository.createRenderJob(
      {
        contractVersion: 1,
        id: latestRenderId,
        projectId: project.id,
        planId: "00000000-0000-4000-8000-000000000026",
        retryOfRenderId: null,
        pinned: false,
        state: "complete",
        progress: { ...progress, phase: "complete", completedChunks: 1 },
        error: null,
        createdAt: "2026-08-13T14:00:00.000Z",
        startedAt: timestamp,
        finishedAt: "2026-08-13T14:00:00.000Z",
      },
      [],
    );
    repository.replaceRenderArtifacts(latestRenderId, [
      {
        contractVersion: 1,
        id: "00000000-0000-4000-8000-000000000027",
        renderId: latestRenderId,
        type: "mp3",
        fileName: "latest.mp3",
        path: "/scoped/latest.mp3",
        sizeBytes: 24,
        checksum: "b".repeat(64),
        durationMs: 752_000,
        createdAt: "2026-08-13T14:00:00.000Z",
      },
    ]);
    expect(repository.listProjects()).toEqual([
      expect.objectContaining({ scriptLineCount: 4, audioDurationMs: 752_000 }),
    ]);
    repository.close();

    const reopened = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(reopened.getRenderJob(renderId)).toEqual(complete);
    expect(reopened.getRenderSegmentPath(renderId, 1)).toMatchObject({
      path: "/tmp/render/000001.wav",
    });
    expect(reopened.getRenderArtifactPath(artifactId)).toMatchObject({
      path: "/scoped/rendered.mp3",
    });
    reopened.close();
  });
});

describe("backup retention", () => {
  async function makeHome(prefix: string) {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    return {
      databasePath: join(directory, "studynarrator.sqlite"),
      backupDirectory: join(directory, "backups"),
    };
  }

  async function writeBackup(
    backupDirectory: string,
    from: number,
    to: number,
    at: Date,
  ) {
    const stamp = at.toISOString().replace(/[:.]/gu, "-");
    const fileName = `studynarrator-v${String(from)}-to-v${String(
      to,
    )}-${stamp}.sqlite`;
    const path = join(backupDirectory, fileName);
    await writeFile(path, "retention-test-backup");
    await utimes(path, at, at);
    return path;
  }

  async function writePrerestore(
    backupDirectory: string,
    version: number,
    at: Date,
  ) {
    const stamp = at.toISOString().replace(/[:.]/gu, "-");
    const padded = String(version).padStart(4, "0");
    const fileName = `studynarrator-prerestore-v${padded}-to-v${padded}-${stamp}.sqlite`;
    const path = join(backupDirectory, fileName);
    await writeFile(path, "prerestore-safety-copy");
    await utimes(path, at, at);
    return path;
  }

  const hour = (hours: number) =>
    new Date(Date.UTC(2026, 7, 1) + hours * 3_600_000);

  it("retains the newest backup for each source schema version", async () => {
    const home = await makeHome("studynarrator-retention-");
    await mkdir(home.backupDirectory, { mode: 0o700 });
    // Oldest -> newest. `a` and `c` have a newer backup from the same source
    // version (b / d) and are outside the recent three (d, e, f).
    const a = await writeBackup(home.backupDirectory, 1, 2, hour(1));
    const b = await writeBackup(home.backupDirectory, 1, 2, hour(2));
    const c = await writeBackup(home.backupDirectory, 2, 3, hour(3));
    const d = await writeBackup(home.backupDirectory, 2, 3, hour(4));
    const e = await writeBackup(home.backupDirectory, 3, 4, hour(5));
    const f = await writeBackup(home.backupDirectory, 3, 4, hour(6));
    const unrelated = "backup-notes.txt";
    await writeFile(join(home.backupDirectory, unrelated), "not a backup");

    const { removed, retained } = await pruneBackups(home.databasePath);
    expect(removed).toEqual([c, a]);
    expect(retained).toEqual([f, e, d, b]);

    // Non-backup files are left untouched and the directory itself survives.
    expect(await readdir(home.backupDirectory)).toContain(unrelated);
    await stat(home.backupDirectory);
  });

  it("never removes the backup created by the current migration", async () => {
    const home = await makeHome("studynarrator-protected-");
    await mkdir(home.backupDirectory, { mode: 0o700 });
    const protectedBackup = await writeBackup(
      home.backupDirectory,
      1,
      3,
      hour(1),
    );
    // Newer backup from the same source version plus a recent pair — without
    // protection the older from-version-1 backup is the only prune candidate.
    const sameSource = await writeBackup(home.backupDirectory, 1, 3, hour(2));
    const recentSecond = await writeBackup(home.backupDirectory, 4, 5, hour(3));
    const newest = await writeBackup(home.backupDirectory, 4, 5, hour(4));

    const { removed, retained } = await pruneBackups(home.databasePath, {
      protectPath: protectedBackup,
    });
    expect(removed).toEqual([]);
    expect(retained).toEqual([
      newest,
      recentSecond,
      sameSource,
      protectedBackup,
    ]);

    // Control run on an identical layout: the same backup is pruned when it
    // is not the one created by the current migration.
    const control = await makeHome("studynarrator-unprotected-");
    await mkdir(control.backupDirectory, { mode: 0o700 });
    const unprotectedBackup = await writeBackup(
      control.backupDirectory,
      1,
      3,
      hour(1),
    );
    await writeBackup(control.backupDirectory, 1, 3, hour(2));
    await writeBackup(control.backupDirectory, 4, 5, hour(3));
    await writeBackup(control.backupDirectory, 4, 5, hour(4));
    const { removed: controlRemoved } = await pruneBackups(
      control.databasePath,
      { protectPath: null },
    );
    expect(controlRemoved).toEqual([unprotectedBackup]);
  });

  it("parses unpadded legacy backup filenames", async () => {
    const emptyHome = await makeHome("studynarrator-empty-backups-");
    expect(await listBackups(emptyHome.databasePath)).toEqual([]);

    const home = await makeHome("studynarrator-legacy-");
    await mkdir(home.backupDirectory, { mode: 0o700 });
    const legacyName = "studynarrator-v1-to-v2-2026-07-15T09-30-00-000Z.sqlite";
    const legacyPath = join(home.backupDirectory, legacyName);
    await writeFile(legacyPath, "legacy");
    const created = new Date("2026-07-15T09:30:00.000Z");
    await utimes(legacyPath, created, created);
    // A file that does not match the backup pattern must be ignored.
    await writeFile(join(home.backupDirectory, "scratch.sqlite.bak"), "junk");

    const backups = await listBackups(home.databasePath);
    const expected: readonly BackupRecord[] = [
      {
        path: legacyPath,
        fileName: legacyName,
        fromVersion: 1,
        toVersion: 2,
        createdAt: created.toISOString(),
        sizeBytes: 6,
        kind: "migration",
      },
    ];
    expect(backups).toEqual(expected);

    // A lone legacy backup is protected by the default recent-keep rule.
    const { removed, retained } = await pruneBackups(home.databasePath);
    expect(removed).toEqual([]);
    expect(retained).toEqual([legacyPath]);
    await stat(legacyPath);
  });

  it("ignores sqlite wal and shm sidecars that inherit a backup filename", async () => {
    const home = await makeHome("studynarrator-sidecar-backups-");
    await mkdir(home.backupDirectory, { mode: 0o700 });
    const backup = await writeBackup(home.backupDirectory, 3, 3, hour(1));
    // Opening a WAL-mode backup while verifying restore integrity creates
    // `-wal`/`-shm` siblings next to the real backup file.
    const walPath = `${backup}-wal`;
    const shmPath = `${backup}-shm`;
    await writeFile(walPath, "stale-wal");
    await writeFile(shmPath, "stale-shm");
    // Sidecars land newest, so without the filter they would win the
    // latest-backup and listing order.
    await utimes(walPath, hour(5), hour(5));
    await utimes(shmPath, hour(6), hour(6));

    const backups = await listBackups(home.databasePath);
    expect(backups).toEqual([
      {
        path: backup,
        fileName: backup.split("/").pop() as string,
        fromVersion: 3,
        toVersion: 3,
        createdAt: hour(1).toISOString(),
        sizeBytes: 21,
        kind: "migration",
      },
    ]);

    // Sidecars are never prune candidates.
    const { removed, retained } = await pruneBackups(home.databasePath);
    expect(removed).toEqual([]);
    expect(retained).toEqual([backup]);
    await stat(walPath);
    await stat(shmPath);
  });

  it("lists pre-restore safety copies alongside migration backups", async () => {
    const home = await makeHome("studynarrator-prerestore-listing-");
    await mkdir(home.backupDirectory, { mode: 0o700 });
    const migration = await writeBackup(home.backupDirectory, 3, 4, hour(1));
    const safetyCopy = await writePrerestore(home.backupDirectory, 4, hour(2));

    const backups = await listBackups(home.databasePath);
    expect(backups.map(({ path, kind }) => [path, kind])).toEqual([
      [safetyCopy, "prerestore"],
      [migration, "migration"],
    ]);

    // The wire projection carries the same kind for the recovery UI.
    const persistenceBackups = await listPersistenceBackups(home.databasePath);
    expect(persistenceBackups.map(({ path, kind }) => [path, kind])).toEqual([
      [safetyCopy, "prerestore"],
      [migration, "migration"],
    ]);
  });

  it("retains only the two most recent pre-restore copies when pruning", async () => {
    const home = await makeHome("studynarrator-prerestore-prune-");
    await mkdir(home.backupDirectory, { mode: 0o700 });
    const oldMigration = await writeBackup(home.backupDirectory, 3, 4, hour(1));
    // Three pre-restore copies, oldest to newest; only the newest two remain.
    const oldestSafety = await writePrerestore(
      home.backupDirectory,
      4,
      hour(2),
    );
    const middleSafety = await writePrerestore(
      home.backupDirectory,
      4,
      hour(3),
    );
    const newestSafety = await writePrerestore(
      home.backupDirectory,
      4,
      hour(4),
    );

    const { removed, retained } = await pruneBackups(home.databasePath);
    expect(removed).toEqual([oldestSafety]);
    // Newest first; the migration is a distinct kind and is unaffected.
    expect(retained).toEqual([newestSafety, middleSafety, oldMigration]);
    await stat(newestSafety);
    await stat(middleSafety);
    await stat(oldMigration);
  });
});
