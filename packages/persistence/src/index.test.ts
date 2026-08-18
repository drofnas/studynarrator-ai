import { readFile } from "node:fs/promises";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  MigrationFailureError,
  STUDYNARRATOR_MIGRATIONS,
  migrateDatabase,
  openStudyNarratorRepository,
  type DatabaseConstructor,
  type Migration,
} from "./index.js";
import { DATABASE_SCHEMA_VERSION } from "@studynarrator/shared-types";

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
    ]);
    expect(first.appliedVersions).toEqual([1, 2, 3]);
    expect(first.databaseSchemaVersion).toBe(3);
    expect(first.backupPath).toBeNull();
    expect(
      first.database.prepare("SELECT version FROM schema_migrations").all(),
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    expect(
      first.database
        .prepare(
          "SELECT singleton_id, base_url, supplied_url_form FROM speaches_connection",
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
    ).toHaveLength(44);
    expect(
      first.database
        .prepare(
          "SELECT display_text, sense_id, spoken_text FROM lexicon_entries WHERE id = ?",
        )
        .get("10000000-0000-4000-8000-000000000009"),
    ).toEqual({
      display_text: "resume",
      sense_id: "cv",
      spoken_text: "rez oo may",
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

  it("seeds the same global lexicon rows a pre-change database contains", async () => {
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
    ).toEqual([
        { id: "10000000-0000-4000-8000-000000000001", entry_type: "exactTerm", display_text: "API", sense_id: null, spoken_text: "A P I" },
        { id: "10000000-0000-4000-8000-000000000002", entry_type: "exactTerm", display_text: "URL", sense_id: null, spoken_text: "U R L" },
        { id: "10000000-0000-4000-8000-000000000003", entry_type: "exactTerm", display_text: "HTTP", sense_id: null, spoken_text: "H T T P" },
        { id: "10000000-0000-4000-8000-000000000004", entry_type: "exactTerm", display_text: "HTTPS", sense_id: null, spoken_text: "H T T P S" },
        { id: "10000000-0000-4000-8000-000000000005", entry_type: "exactTerm", display_text: "JSON", sense_id: null, spoken_text: "jay son" },
        { id: "10000000-0000-4000-8000-000000000006", entry_type: "exactTerm", display_text: "SQL", sense_id: null, spoken_text: "S Q L" },
        { id: "10000000-0000-4000-8000-000000000007", entry_type: "exactTerm", display_text: "PostgreSQL", sense_id: null, spoken_text: "post gres Q L" },
        { id: "10000000-0000-4000-8000-000000000008", entry_type: "exactTerm", display_text: "GitHub", sense_id: null, spoken_text: "git hub" },
        { id: "10000000-0000-4000-8000-000000000009", entry_type: "namedSense", display_text: "resume", sense_id: "cv", spoken_text: "rez oo may" },
        { id: "10000000-0000-4000-8000-000000000010", entry_type: "namedSense", display_text: "resume", sense_id: "continue", spoken_text: "ree zoom" },
        { id: "10000000-0000-4000-8000-000000000011", entry_type: "namedSense", display_text: "read", sense_id: "present", spoken_text: "reed" },
        { id: "10000000-0000-4000-8000-000000000012", entry_type: "namedSense", display_text: "read", sense_id: "past", spoken_text: "red" },
        { id: "10000000-0000-4000-8000-000000000013", entry_type: "namedSense", display_text: "lead", sense_id: "guide", spoken_text: "leed" },
        { id: "10000000-0000-4000-8000-000000000014", entry_type: "namedSense", display_text: "lead", sense_id: "metal", spoken_text: "led" },
        { id: "10000000-0000-4000-8000-000000000015", entry_type: "namedSense", display_text: "live", sense_id: "exist", spoken_text: "liv" },
        { id: "10000000-0000-4000-8000-000000000016", entry_type: "namedSense", display_text: "live", sense_id: "realtime", spoken_text: "lyve" },
        { id: "10000000-0000-4000-8000-000000000017", entry_type: "namedSense", display_text: "record", sense_id: "noun", spoken_text: "reck erd" },
        { id: "10000000-0000-4000-8000-000000000018", entry_type: "namedSense", display_text: "record", sense_id: "verb", spoken_text: "ree cord" },
        { id: "10000000-0000-4000-8000-000000000019", entry_type: "namedSense", display_text: "project", sense_id: "noun", spoken_text: "prah jekt" },
        { id: "10000000-0000-4000-8000-000000000020", entry_type: "namedSense", display_text: "project", sense_id: "verb", spoken_text: "pruh jekt" },
        { id: "10000000-0000-4000-8000-000000000021", entry_type: "namedSense", display_text: "object", sense_id: "thing", spoken_text: "ob jekt" },
        { id: "10000000-0000-4000-8000-000000000022", entry_type: "namedSense", display_text: "object", sense_id: "oppose", spoken_text: "ub jekt" },
        { id: "10000000-0000-4000-8000-000000000023", entry_type: "namedSense", display_text: "subject", sense_id: "topic", spoken_text: "sub jekt" },
        { id: "10000000-0000-4000-8000-000000000024", entry_type: "namedSense", display_text: "subject", sense_id: "expose", spoken_text: "sub jekt" },
        { id: "10000000-0000-4000-8000-000000000025", entry_type: "namedSense", display_text: "present", sense_id: "current", spoken_text: "prez ent" },
        { id: "10000000-0000-4000-8000-000000000026", entry_type: "namedSense", display_text: "present", sense_id: "give", spoken_text: "pree zent" },
        { id: "10000000-0000-4000-8000-000000000027", entry_type: "namedSense", display_text: "content", sense_id: "material", spoken_text: "con tent" },
        { id: "10000000-0000-4000-8000-000000000028", entry_type: "namedSense", display_text: "content", sense_id: "satisfied", spoken_text: "kun tent" },
        { id: "10000000-0000-4000-8000-000000000029", entry_type: "namedSense", display_text: "minute", sense_id: "time", spoken_text: "min it" },
        { id: "10000000-0000-4000-8000-000000000030", entry_type: "namedSense", display_text: "minute", sense_id: "tiny", spoken_text: "my noot" },
        { id: "10000000-0000-4000-8000-000000000031", entry_type: "namedSense", display_text: "close", sense_id: "near", spoken_text: "klohs" },
        { id: "10000000-0000-4000-8000-000000000032", entry_type: "namedSense", display_text: "close", sense_id: "shut", spoken_text: "klohz" },
        { id: "10000000-0000-4000-8000-000000000033", entry_type: "namedSense", display_text: "use", sense_id: "noun", spoken_text: "yoos" },
        { id: "10000000-0000-4000-8000-000000000034", entry_type: "namedSense", display_text: "use", sense_id: "verb", spoken_text: "yooz" },
        { id: "10000000-0000-4000-8000-000000000035", entry_type: "namedSense", display_text: "attribute", sense_id: "property", spoken_text: "at trih byoot" },
        { id: "10000000-0000-4000-8000-000000000036", entry_type: "namedSense", display_text: "attribute", sense_id: "assign", spoken_text: "uh trib yoot" },
        { id: "10000000-0000-4000-8000-000000000037", entry_type: "namedSense", display_text: "import", sense_id: "noun", spoken_text: "im port" },
        { id: "10000000-0000-4000-8000-000000000038", entry_type: "namedSense", display_text: "import", sense_id: "verb", spoken_text: "im port" },
        { id: "10000000-0000-4000-8000-000000000039", entry_type: "namedSense", display_text: "export", sense_id: "noun", spoken_text: "eks port" },
        { id: "10000000-0000-4000-8000-000000000040", entry_type: "namedSense", display_text: "export", sense_id: "verb", spoken_text: "ik sport" },
        { id: "10000000-0000-4000-8000-000000000041", entry_type: "namedSense", display_text: "row", sense_id: "line", spoken_text: "roh" },
        { id: "10000000-0000-4000-8000-000000000042", entry_type: "namedSense", display_text: "row", sense_id: "argument", spoken_text: "rau" },
        { id: "10000000-0000-4000-8000-000000000043", entry_type: "namedSense", display_text: "axes", sense_id: "math", spoken_text: "ak seez" },
        { id: "10000000-0000-4000-8000-000000000044", entry_type: "namedSense", display_text: "axes", sense_id: "tools", spoken_text: "ak siz" },
    ]);
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
      .prepare(`
      INSERT INTO lexicon_entries (
        id, scope, project_id, ordinal, entry_type, display_text, sense_id, spoken_text,
        case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
      ) VALUES (?, 'global', NULL, ?, 'exactTerm', ?, NULL, ?, 0, 1, 0, 0, '', ?, ?)
    `)
      .run(
        "20000000-0000-4000-8000-000000000001",
        8,
        "CLI",
        "C L I",
        "2026-08-12T12:00:00.000Z",
        "2026-08-12T12:00:00.000Z",
      );
    v2.database
      .prepare(`
      INSERT INTO lexicon_entries (
        id, scope, project_id, ordinal, entry_type, display_text, sense_id, spoken_text,
        case_sensitive, whole_word, priority, enabled, notes, created_at, updated_at
      ) VALUES (?, 'global', NULL, ?, 'namedSense', ?, ?, ?, 0, 1, 0, 0, '', ?, ?)
    `)
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

    const upgraded = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(upgraded.appliedVersions).toEqual([3]);
    expect(upgraded.databaseSchemaVersion).toBe(3);
    expect(upgraded.backupPath).toContain("-v0002-to-v0003-");
    expect(
      upgraded.database
        .prepare(
          "SELECT count(*) AS count FROM lexicon_entries WHERE entry_type = 'namedSense'",
        )
        .get(),
    ).toEqual({ count: 36 });
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
    ).toEqual({ count: 35 });
    expect(
      reopened.database
        .prepare("SELECT id FROM lexicon_entries WHERE id = ?")
        .get("10000000-0000-4000-8000-000000000010"),
    ).toBeUndefined();
    reopened.database.close();
  });

  it("contains only current tables and no legacy columns", async () => {
    const databasePath = await temporaryDatabase("studynarrator-v1-shape-");
    const migrated = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    const tables = (
      migrated.database
        .prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `)
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
      columns(migrated.database as Database.Database, "speaches_connection"),
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

  it.each([1, 12])(
    "rejects an unsupported pre-release schema %d database without deleting it",
    async (version) => {
      const databasePath = await temporaryDatabase(
        `studynarrator-unsupported-v${String(version)}-`,
      );
      const old = new Database(databasePath);
      old.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE preserved_development_data (value TEXT NOT NULL);
      INSERT INTO schema_migrations (version, applied_at) VALUES (${String(version)}, '2026-08-11T00:00:00.000Z');
      INSERT INTO preserved_development_data (value) VALUES ('keep-me');
    `);
      old.close();

      await expect(
        migrateDatabase({ Database: DatabaseAdapter, databasePath }),
      ).rejects.toBeInstanceOf(MigrationFailureError);
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
      version: 4,
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
    expect(failure?.backupPath).toContain("-v0003-to-v0004-");
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
  it("round-trips editable, disabled, and deleted global named-sense entries", async () => {
    const databasePath = await temporaryDatabase(
      "studynarrator-global-named-sense-",
    );
    const first = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      idFactory: ids(lexiconId),
    });
    expect(
      first.replaceGlobalLexicon([
        {
          scope: "global",
          entryType: "namedSense",
          displayText: "resume",
          senseId: "cv",
          spokenText: "custom résumé",
          enabled: false,
        },
      ]),
    ).toMatchObject([
      {
        id: lexiconId,
        entryType: "namedSense",
        displayText: "resume",
        senseId: "cv",
        spokenText: "custom résumé",
        enabled: false,
      },
    ]);
    first.close();

    const reopened = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(reopened.listGlobalLexicon()).toMatchObject([
      {
        id: lexiconId,
        entryType: "namedSense",
        senseId: "cv",
        enabled: false,
      },
    ]);
    reopened.replaceGlobalLexicon([]);
    reopened.close();

    const empty = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
    });
    expect(empty.listGlobalLexicon()).toEqual([]);
    empty.close();
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
      databaseSchemaVersion: 3,
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
    expect(repository.getSpeachesConnection()).toMatchObject({
      baseUrl: null,
      configured: false,
    });
    expect(
      repository.replaceSpeachesConnection(
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
    expect(reopened.getSpeachesConnection()).toMatchObject({
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

  it("persists marker evidence and durable render state", async () => {
    const databasePath = await temporaryDatabase("studynarrator-render-state-");
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
      idFactory: ids(projectId),
    });
    expect(repository.runMarker()).toMatchObject({
      markerKey: "runtime.storage-self-test",
      migrationVersion: 3,
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
      state: "complete",
      progress: { ...progress, phase: "complete", completedChunks: 1 },
      startedAt: timestamp,
      finishedAt: timestamp,
    });
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
