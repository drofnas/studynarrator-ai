import { readFileSync } from "node:fs";
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
  type Migration
} from "./index.js";

const DatabaseAdapter = Database as unknown as DatabaseConstructor;
const projectId = "00000000-0000-4000-8000-000000000001";
const secondProjectId = "00000000-0000-4000-8000-000000000002";
const lexiconId = "00000000-0000-4000-8000-000000000003";
const profileId = "00000000-0000-4000-8000-000000000004";

async function temporaryDatabase(name: string) {
  return join(await mkdtemp(join(tmpdir(), name)), "studynarrator.sqlite");
}

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? "00000000-0000-4000-8000-ffffffffffff";
}

describe("G04 migrations", () => {
  it("creates schema version 2 and reruns without duplicate migrations or backups", async () => {
    const databasePath = await temporaryDatabase("studynarrator-g04-fresh-");
    const first = await migrateDatabase({ Database: DatabaseAdapter, databasePath, now: () => new Date("2026-08-12T12:00:00.000Z") });
    expect(first.appliedVersions).toEqual([1, 2]);
    expect(first.backupPath).toBeNull();
    first.database.close();

    const second = await migrateDatabase({ Database: DatabaseAdapter, databasePath, now: () => new Date("2026-08-13T12:00:00.000Z") });
    expect(second.appliedVersions).toEqual([]);
    expect(second.backupPath).toBeNull();
    expect(second.database.prepare("SELECT count(*) AS count FROM schema_migrations").get()).toEqual({ count: 2 });
    second.database.close();
  });

  it("backs up an existing v1 database before upgrading", async () => {
    const databasePath = await temporaryDatabase("studynarrator-g04-upgrade-");
    const old = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 1)
    });
    old.database.prepare("INSERT INTO diagnostic_kv (key, value, created_at) VALUES (?, ?, ?)")
      .run("fixture", "preserved", "2026-08-11T12:00:00.000Z");
    old.database.close();

    const upgraded = await migrateDatabase({ Database: DatabaseAdapter, databasePath, now: () => new Date("2026-08-12T12:00:00.000Z") });
    expect(upgraded.appliedVersions).toEqual([2]);
    expect(upgraded.backupPath).toContain("-v1-to-v2-");
    expect((await stat(upgraded.backupPath!)).mode & 0o777).toBe(0o600);
    expect(upgraded.database.prepare("SELECT value FROM diagnostic_kv WHERE key = 'fixture'").get()).toEqual({ value: "preserved" });
    const backup = new Database(upgraded.backupPath!, { readonly: true });
    expect(backup.prepare("SELECT value FROM diagnostic_kv WHERE key = 'fixture'").get()).toEqual({ value: "preserved" });
    expect(backup.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 1 });
    backup.close();
    upgraded.database.close();
  });

  it("rolls back a failed migration and retains a recoverable v1 backup", async () => {
    const databasePath = await temporaryDatabase("studynarrator-g04-failure-");
    const old = await migrateDatabase({ Database: DatabaseAdapter, databasePath, migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 1) });
    old.database.prepare("INSERT INTO diagnostic_kv (key, value, created_at) VALUES ('fixture', 'safe', '2026-08-11T00:00:00.000Z')").run();
    old.database.close();
    const failing: Migration = {
      version: 2,
      name: "intentional-test-failure",
      up(database) {
        database.exec("CREATE TABLE must_rollback (id TEXT); INSERT INTO missing_table VALUES (1);");
      }
    };

    let failure: MigrationFailureError | undefined;
    try {
      await migrateDatabase({ Database: DatabaseAdapter, databasePath, migrations: [STUDYNARRATOR_MIGRATIONS[0]!, failing] });
    } catch (error) {
      failure = error as MigrationFailureError;
    }
    expect(failure).toBeInstanceOf(MigrationFailureError);
    expect(failure?.message).not.toContain("missing_table");
    expect(failure?.backupPath).toContain("-v1-to-v2-");

    const original = new Database(databasePath, { readonly: true });
    expect(original.prepare("SELECT value FROM diagnostic_kv WHERE key = 'fixture'").get()).toEqual({ value: "safe" });
    expect(original.prepare("SELECT name FROM sqlite_master WHERE name = 'must_rollback'").get()).toBeUndefined();
    original.close();
    const backupBytes = readFileSync(failure!.backupPath!);
    expect(backupBytes.byteLength).toBeGreaterThan(0);
  });
});

describe("StudyNarratorRepository", () => {
  it("persists a complete project aggregate exactly across two reopen cycles", async () => {
    const databasePath = await temporaryDatabase("studynarrator-g04-project-");
    const first = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      idFactory: ids(projectId, lexiconId)
    });
    const created = first.createProject({ name: "Gate 04 Persistence", description: "Restart proof" });
    expect(created.paragraphPause).toEqual({ enabled: true, pauseId: "pause_medium", durationMs: 750 });
    expect(created.pausePresets).toEqual([{ pauseId: "pause_medium", durationMs: 750, description: "Paragraph or subtopic separation." }]);
    const source = "Résumé line\r\n\r\nSQL line 🧠";
    first.replaceProject(created.id, {
      name: created.name,
      description: created.description,
      scriptSource: source,
      connectionProfileId: null,
      speakerMappings: [{
        speakerId: "narrator", displayName: "Narrator", voiceId: null, speed: 1,
        gainDb: 0, roleDescription: "", sampleText: "Preview"
      }],
      pausePresets: [
        { pauseId: "pause_medium", durationMs: 750, description: "Paragraph" },
        { pauseId: "pause_short", durationMs: 350, description: "Brief" }
      ],
      paragraphPause: { enabled: true, pauseId: "pause_medium", durationMs: 750 },
      lexiconEntries: [{ id: lexiconId, scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }]
    });
    first.close();

    const second = await openStudyNarratorRepository({ Database: DatabaseAdapter, databasePath, now: () => new Date("2026-08-13T12:00:00.000Z") });
    const reopened = second.getProject(projectId);
    expect(reopened.scriptSource).toBe(source);
    expect(reopened.scriptHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(reopened.speakerMappings.map((item) => item.speakerId)).toEqual(["narrator"]);
    expect(reopened.pausePresets.map((item) => item.pauseId)).toEqual(["pause_medium", "pause_short"]);
    expect(reopened.lexiconEntries[0]).toMatchObject({ id: lexiconId, createdAt: "2026-08-12T12:00:00.000Z" });
    second.close();

    const third = await openStudyNarratorRepository({ Database: DatabaseAdapter, databasePath });
    expect(third.listProjects()).toHaveLength(1);
    expect(third.getProject(projectId).scriptSource).toBe(source);
    third.close();
  });

  it("copies changed system defaults only into later projects", async () => {
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath: await temporaryDatabase("studynarrator-g04-defaults-"),
      idFactory: ids(projectId, secondProjectId)
    });
    const first = repository.createProject({ name: "First" });
    repository.updateSystemPacing({ enabled: false, durationMs: 1200 });
    const second = repository.createProject({ name: "Second" });
    expect(repository.getProject(first.id).paragraphPause).toEqual({ enabled: true, pauseId: "pause_medium", durationMs: 750 });
    expect(second.paragraphPause).toEqual({ enabled: false, pauseId: "pause_medium", durationMs: 1200 });
    repository.close();
  });

  it("keeps installation data when deleting a project and nulls deleted profile references", async () => {
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath: await temporaryDatabase("studynarrator-g04-boundaries-"),
      idFactory: ids(profileId, projectId, lexiconId)
    });
    const profile = repository.createConnectionProfile({ id: profileId, name: "Placeholder", baseUrl: "http://127.0.0.1:8000", defaultModelId: null, defaultVoiceId: null });
    const project = repository.createProject({ name: "Owned" });
    repository.replaceGlobalLexicon([{ id: lexiconId, scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }]);
    repository.replaceProject(project.id, {
      name: project.name, description: "", scriptSource: "SQL", connectionProfileId: profile.id,
      speakerMappings: [], pausePresets: project.pausePresets, paragraphPause: project.paragraphPause, lexiconEntries: []
    });
    repository.deleteConnectionProfile(profile.id);
    expect(repository.getProject(project.id).connectionProfileId).toBeNull();
    repository.deleteProject(project.id);
    expect(repository.listProjects()).toEqual([]);
    expect(repository.listGlobalLexicon()).toHaveLength(1);
    repository.close();
  });

  it("preserves ordered personal preferences and rejects mismatched paragraph presets atomically", async () => {
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath: await temporaryDatabase("studynarrator-g04-atomic-"),
      idFactory: ids(projectId)
    });
    repository.replaceIgnoredDiagnostics([
      { code: "SECOND", pattern: "two" },
      { code: "FIRST", pattern: "one" }
    ]);
    expect(repository.getIgnoredDiagnostics().map((item) => item.code)).toEqual(["SECOND", "FIRST"]);
    const project = repository.createProject({ name: "Atomic" });
    expect(() => repository.replaceProject(project.id, {
      name: "Changed", description: "", scriptSource: "lost", connectionProfileId: null,
      speakerMappings: [], pausePresets: project.pausePresets,
      paragraphPause: { ...project.paragraphPause, durationMs: 999 }, lexiconEntries: []
    })).toThrow();
    expect(repository.getProject(project.id)).toMatchObject({ name: "Atomic", scriptSource: "" });
    repository.close();
  });
});
