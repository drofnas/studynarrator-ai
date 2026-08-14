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
const duplicateProjectId = "00000000-0000-4000-8000-000000000005";
const duplicateLexiconId = "00000000-0000-4000-8000-000000000006";
const legacySchemaSql = `
  PRAGMA user_version = 1;
  CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  CREATE TABLE diagnostic_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
  INSERT INTO schema_migrations (version, applied_at) VALUES (1, '2026-08-11T12:00:00.000Z');
  INSERT INTO diagnostic_kv (key, value, created_at) VALUES ('fixture', 'preserved', '2026-08-11T12:00:00.000Z');
`;

async function temporaryDatabase(name: string) {
  return join(await mkdtemp(join(tmpdir(), name)), "studynarrator.sqlite");
}

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? "00000000-0000-4000-8000-ffffffffffff";
}

describe("database migrations", () => {
  it("uses feature-based names without changing migration versions", () => {
    expect(STUDYNARRATOR_MIGRATIONS.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 1, name: "runtime-diagnostics" },
      { version: 2, name: "project-authoring" },
      { version: 3, name: "speaches-connections" },
      { version: 4, name: "project-transition-pauses" },
      { version: 5, name: "render-execution" },
      { version: 6, name: "render-review-media" },
      { version: 7, name: "single-speaches-connection" }
    ]);
  });

  it("creates schema version 7 and reruns without duplicate migrations or backups", async () => {
    const databasePath = await temporaryDatabase("studynarrator-migration-fresh-");
    const first = await migrateDatabase({ Database: DatabaseAdapter, databasePath, now: () => new Date("2026-08-12T12:00:00.000Z") });
    expect(first.appliedVersions).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(first.backupPath).toBeNull();
    first.database.close();

    const second = await migrateDatabase({ Database: DatabaseAdapter, databasePath, now: () => new Date("2026-08-13T12:00:00.000Z") });
    expect(second.appliedVersions).toEqual([]);
    expect(second.backupPath).toBeNull();
    expect(second.database.prepare("SELECT count(*) AS count FROM schema_migrations").get()).toEqual({ count: 7 });
    second.database.close();
  });

  it("backs up an existing v1 database before upgrading", async () => {
    const databasePath = await temporaryDatabase("studynarrator-migration-upgrade-");
    const old = new Database(databasePath);
    old.exec(legacySchemaSql);
    old.close();

    const upgraded = await migrateDatabase({ Database: DatabaseAdapter, databasePath, now: () => new Date("2026-08-12T12:00:00.000Z") });
    expect(upgraded.appliedVersions).toEqual([2, 3, 4, 5, 6, 7]);
    expect(upgraded.backupPath).toContain("-v1-to-v7-");
    expect((await stat(upgraded.backupPath!)).mode & 0o777).toBe(0o600);
    expect(upgraded.database.prepare("SELECT value FROM diagnostic_kv WHERE key = 'fixture'").get()).toEqual({ value: "preserved" });
    const backup = new Database(upgraded.backupPath!, { readonly: true });
    expect(backup.prepare("SELECT value FROM diagnostic_kv WHERE key = 'fixture'").get()).toEqual({ value: "preserved" });
    expect(backup.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 1 });
    backup.close();
    upgraded.database.close();
  });

  it("backs up and upgrades a complete v2 database without losing projects", async () => {
    const databasePath = await temporaryDatabase("studynarrator-migration-v2-");
    const previous = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 2),
      now: () => new Date("2026-08-12T12:00:00.000Z")
    });
    previous.database.prepare(`
      INSERT INTO projects (
        id, config_version, name, description, script_source, script_hash, connection_profile_id,
        paragraph_pause_enabled, paragraph_pause_id, paragraph_pause_duration_ms, created_at, updated_at
      ) VALUES (?, 1, 'V2 project', '', 'SQL', ?, NULL, 1, 'pause_medium', 750, ?, ?)
    `).run(projectId, "a".repeat(64), "2026-08-12T12:00:00.000Z", "2026-08-12T12:00:00.000Z");
    previous.database.close();

    const upgraded = await migrateDatabase({ Database: DatabaseAdapter, databasePath, now: () => new Date("2026-08-13T12:00:00.000Z") });
    expect(upgraded.appliedVersions).toEqual([3, 4, 5, 6, 7]);
    expect(upgraded.backupPath).toContain("-v2-to-v7-");
    expect(upgraded.database.prepare("SELECT name, model_id, paragraph_transition_mode, paragraph_transition_pause_id FROM projects WHERE id = ?").get(projectId))
      .toEqual({ name: "V2 project", model_id: null, paragraph_transition_mode: "preset", paragraph_transition_pause_id: "pause_medium" });
    upgraded.database.close();
  });

  it("collapses legacy profiles to the configured active connection and remaps projects", async () => {
    const databasePath = await temporaryDatabase("studynarrator-migration-single-connection-");
    const legacy = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
      migrations: STUDYNARRATOR_MIGRATIONS.slice(0, 6),
      now: () => new Date("2026-08-12T12:00:00.000Z")
    });
    const insertProfile = legacy.database.prepare(`
      INSERT INTO connection_profiles (
        id, ordinal, name, base_url, default_model_id, default_voice_id, source,
        api_key_reference, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertProfile.run("saved-first", 0, "Saved first", "http://127.0.0.1:8001", "model-a", "voice-a", "saved", "safe-storage:saved-first", "2026-08-12T12:00:00.000Z", "2026-08-12T12:00:00.000Z");
    insertProfile.run("active-environment", 1, "Environment Speaches", "http://127.0.0.1:8002", "model-b", "voice-b", "environment", "environment:SPEACHES_API_KEY", "2026-08-12T12:00:00.000Z", "2026-08-12T12:00:00.000Z");
    legacy.database.prepare("INSERT INTO connection_setup (singleton_id, active_profile_id, onboarding_completed_at, updated_at) VALUES (1, ?, ?, ?)")
      .run("active-environment", "2026-08-12T12:00:00.000Z", "2026-08-12T12:00:00.000Z");
    legacy.database.prepare(`
      INSERT INTO projects (
        id, config_version, name, description, script_source, script_hash, connection_profile_id,
        paragraph_pause_enabled, paragraph_pause_id, paragraph_pause_duration_ms, created_at, updated_at
      ) VALUES (?, 1, 'Legacy project', '', 'SQL', ?, ?, 1, 'pause_medium', 750, ?, ?)
    `).run(projectId, "a".repeat(64), "saved-first", "2026-08-12T12:00:00.000Z", "2026-08-12T12:00:00.000Z");
    legacy.database.close();

    const upgraded = await migrateDatabase({ Database: DatabaseAdapter, databasePath, now: () => new Date("2026-08-13T12:00:00.000Z") });
    expect(upgraded.appliedVersions).toEqual([7]);
    expect(upgraded.database.prepare("SELECT id, name, source, api_key_reference FROM connection_profiles").all()).toEqual([
      { id: "active-environment", name: "Speaches", source: "saved", api_key_reference: null }
    ]);
    expect(upgraded.database.prepare("SELECT active_profile_id, onboarding_completed_at FROM connection_setup WHERE singleton_id = 1").get())
      .toEqual({ active_profile_id: "active-environment", onboarding_completed_at: "2026-08-12T12:00:00.000Z" });
    expect(upgraded.database.prepare("SELECT connection_profile_id FROM projects WHERE id = ?").get(projectId))
      .toEqual({ connection_profile_id: "active-environment" });
    upgraded.database.close();
  });

  it("rolls back a failed migration and retains a recoverable v1 backup", async () => {
    const databasePath = await temporaryDatabase("studynarrator-migration-failure-");
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
  it("replaces obsolete diagnostic markers with the current storage self-test", async () => {
    const databasePath = await temporaryDatabase("studynarrator-storage-self-test-");
    const migrated = await migrateDatabase({ Database: DatabaseAdapter, databasePath });
    migrated.database.prepare("INSERT INTO diagnostic_kv (key, value, created_at) VALUES (?, ?, ?)")
      .run("obsolete.runtime-marker", "obsolete", "2026-08-11T00:00:00.000Z");
    migrated.database.close();

    const repository = await openStudyNarratorRepository({ Database: DatabaseAdapter, databasePath });
    expect(repository.runMarker()).toMatchObject({
      markerKey: "runtime.storage-self-test",
      markerValue: "study-narrator-storage-ok"
    });
    repository.close();

    const inspected = new Database(databasePath, { readonly: true });
    expect(inspected.prepare("SELECT key, value FROM diagnostic_kv").all()).toEqual([
      { key: "runtime.storage-self-test", value: "study-narrator-storage-ok" }
    ]);
    inspected.close();
  });

  it("persists a complete project aggregate exactly across two reopen cycles", async () => {
    const databasePath = await temporaryDatabase("studynarrator-project-reopen-");
    const first = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath,
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      idFactory: ids(projectId, lexiconId)
    });
    const created = first.createProject({ name: "Persistence restart proof", description: "Restart proof" });
    expect(created.transitionPauses).toEqual({ paragraph: { mode: "preset", pauseId: "pause_medium" }, speakerChange: { mode: "none" }, section: { mode: "none" } });
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
      transitionPauses: { paragraph: { mode: "preset", pauseId: "pause_medium" }, speakerChange: { mode: "duration", durationMs: 350 }, section: { mode: "preset", pauseId: "pause_short" } },
      lexiconEntries: [{ id: lexiconId, scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }]
    });
    first.close();

    const second = await openStudyNarratorRepository({ Database: DatabaseAdapter, databasePath, now: () => new Date("2026-08-13T12:00:00.000Z") });
    const reopened = second.getProject(projectId);
    expect(reopened.scriptSource).toBe(source);
    expect(reopened.scriptHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(reopened.speakerMappings.map((item) => item.speakerId)).toEqual(["narrator"]);
    expect(reopened.pausePresets.map((item) => item.pauseId)).toEqual(["pause_medium", "pause_short"]);
    expect(reopened.transitionPauses).toEqual({
      paragraph: { mode: "preset", pauseId: "pause_medium" },
      speakerChange: { mode: "duration", durationMs: 350 },
      section: { mode: "preset", pauseId: "pause_short" }
    });
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
      databasePath: await temporaryDatabase("studynarrator-defaults-"),
      idFactory: ids(projectId, secondProjectId)
    });
    const first = repository.createProject({ name: "First" });
    repository.updateSystemPacing({ enabled: false, durationMs: 1200 });
    const second = repository.createProject({ name: "Second" });
    expect(repository.getProject(first.id).transitionPauses.paragraph).toEqual({ mode: "preset", pauseId: "pause_medium" });
    expect(second.transitionPauses.paragraph).toEqual({ mode: "none" });
    repository.close();
  });

  it("duplicates a complete project atomically with fresh owned IDs", async () => {
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath: await temporaryDatabase("studynarrator-duplicate-"),
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      idFactory: ids(projectId, lexiconId, duplicateProjectId, duplicateLexiconId)
    });
    const source = repository.createProject({ name: "Source", description: "Copy everything" });
    const configured = repository.replaceProject(source.id, {
      name: source.name,
      description: source.description,
      scriptSource: "[speaker_teacher] SQL",
      connectionProfileId: null,
      speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: "voice_teacher", speed: 1, gainDb: 0, roleDescription: "Guide", sampleText: "SQL" }],
      pausePresets: source.pausePresets,
      transitionPauses: source.transitionPauses,
      lexiconEntries: [{ id: lexiconId, scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }]
    });

    const duplicate = repository.duplicateProject(source.id, { name: "Source copy" });
    expect(duplicate).toMatchObject({
      id: duplicateProjectId,
      name: "Source copy",
      description: configured.description,
      scriptSource: configured.scriptSource,
      scriptHash: configured.scriptHash,
      connectionProfileId: configured.connectionProfileId,
      speakerMappings: configured.speakerMappings,
      pausePresets: configured.pausePresets,
      transitionPauses: configured.transitionPauses
    });
    expect(duplicate.lexiconEntries).toHaveLength(1);
    expect(duplicate.lexiconEntries[0]).toMatchObject({ id: duplicateLexiconId, displayText: "SQL", spokenText: "sequel" });
    expect(duplicate.lexiconEntries[0]?.id).not.toBe(configured.lexiconEntries[0]?.id);
    expect(repository.getProject(source.id)).toEqual(configured);
    expect(repository.listProjects()).toHaveLength(2);
    repository.close();
  });

  it("keeps installation data when deleting a project and nulls deleted profile references", async () => {
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath: await temporaryDatabase("studynarrator-boundaries-"),
      idFactory: ids(profileId, projectId, lexiconId)
    });
    const profile = repository.createConnectionProfile({ id: profileId, name: "Placeholder", baseUrl: "http://127.0.0.1:8000", defaultModelId: null, defaultVoiceId: null });
    const project = repository.createProject({ name: "Owned" });
    repository.replaceGlobalLexicon([{ id: lexiconId, scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }]);
    repository.replaceProject(project.id, {
      name: project.name, description: "", scriptSource: "SQL", connectionProfileId: profile.id,
      speakerMappings: [], pausePresets: project.pausePresets, transitionPauses: project.transitionPauses, lexiconEntries: []
    });
    repository.deleteConnectionProfile(profile.id);
    expect(repository.getProject(project.id).connectionProfileId).toBeNull();
    repository.deleteProject(project.id);
    expect(repository.listProjects()).toEqual([]);
    expect(repository.listGlobalLexicon()).toHaveLength(1);
    repository.close();
  });

  it("preserves ordered personal preferences and rejects missing transition presets atomically", async () => {
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath: await temporaryDatabase("studynarrator-atomic-"),
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
      transitionPauses: { ...project.transitionPauses, paragraph: { mode: "preset", pauseId: "pause_missing" } }, lexiconEntries: []
    })).toThrow();
    expect(repository.getProject(project.id)).toMatchObject({ name: "Atomic", scriptSource: "" });
    repository.close();
  });

  it("persists safe connection state and voice overrides without exposing credential values", async () => {
    const repository = await openStudyNarratorRepository({
      Database: DatabaseAdapter,
      databasePath: await temporaryDatabase("studynarrator-connections-"),
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      idFactory: ids(profileId)
    });
    const profile = repository.createConnectionProfile({
      id: profileId,
      name: "LAN Speaches",
      baseUrl: "http://127.0.0.1:18080",
      defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      defaultVoiceId: "af_heart"
    });
    expect(profile).toMatchObject({ timeoutSeconds: 120, retryCount: 2, apiKeyConfigured: false, source: "saved" });
    repository.setConnectionCredentialReference(profile.id, "vault:opaque-reference");
    expect(repository.getConnectionProfile(profile.id).apiKeyConfigured).toBe(true);
    expect(JSON.stringify(repository.getConnectionProfile(profile.id))).not.toContain("opaque-reference");

    repository.setActiveConnectionProfile(profile.id);
    repository.completeConnectionOnboarding();
    expect(repository.getConnectionSetup()).toEqual({
      activeProfileId: profile.id,
      onboardingCompletedAt: "2026-08-12T12:00:00.000Z"
    });

    const catalog = repository.replaceVoiceCatalogOverrides({
      schemaVersion: 1,
      modelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      entries: [{ voiceId: "af_heart", label: "Heart", enabled: false }]
    });
    expect(catalog.entries).toEqual([{
      voiceId: "af_heart", label: "Heart", enabled: false, language: null, locale: null,
      accent: null, category: null, style: null, sampleText: null
    }]);
    repository.close();
  });

  it("persists durable render jobs, segment progress, retry links, and artifact metadata", async () => {
    const databasePath = await temporaryDatabase("studynarrator-render-jobs-");
    const repository = await openStudyNarratorRepository({ Database: DatabaseAdapter, databasePath, idFactory: ids(projectId) });
    const project = repository.createProject({ name: "Rendered" });
    const timestamp = "2026-08-13T12:00:00.000Z";
    const renderId = "00000000-0000-4000-8000-000000000020";
    const planId = "00000000-0000-4000-8000-000000000021";
    const artifactId = "00000000-0000-4000-8000-000000000022";
    const progress = {
      phase: "queued" as const, sectionTitle: null, sectionOrdinal: 0, sectionCount: 0,
      entryOrdinal: null, speechOrdinal: 0, speechCount: 1, chunkOrdinal: null,
      completedChunks: 0, totalChunks: 1, cacheHits: 0, cacheMisses: 0, ttsRequests: 0,
      speakerId: null, voiceId: null, excerpt: null, elapsedMs: 0
    };
    const job = repository.createRenderJob({
      contractVersion: 1, id: renderId, projectId: project.id, planId, retryOfRenderId: null,
      state: "queued", progress, error: null, createdAt: timestamp, startedAt: null, finishedAt: null
    }, [{ renderId, ordinal: 1, type: "speech", state: "pending", cacheStatus: null, audioDurationMs: null, audioFileName: null, audioSizeBytes: null, audioChecksum: null, error: null }]);
    expect(repository.findActiveRenderJob(planId)).toEqual(job);
    expect(repository.listRecoverableRenderJobs()).toEqual([job]);
    repository.updateRenderSegment({ renderId, ordinal: 1, type: "speech", state: "complete", cacheStatus: "miss", audioDurationMs: 1_000, audioFileName: "000001.wav", audioSizeBytes: 24_044, audioChecksum: "a".repeat(64), error: null }, "/tmp/render/segments/000001.wav");
    const complete = repository.updateRenderJob({ ...job, state: "complete", progress: { ...progress, phase: "complete", completedChunks: 1, cacheMisses: 1, ttsRequests: 1 }, startedAt: timestamp, finishedAt: timestamp });
    const artifacts = repository.replaceRenderArtifacts(renderId, [{
      contractVersion: 1, id: artifactId, renderId, type: "mp3", fileName: "rendered.mp3", path: "/scoped/rendered.mp3",
      sizeBytes: 12, checksum: "a".repeat(64), durationMs: 1_000, createdAt: timestamp
    }]);
    expect(repository.findActiveRenderJob(planId)).toBeNull();
    expect(repository.listRenderJobs(project.id)).toEqual([complete]);
    expect(repository.listRenderArtifacts(renderId)).toEqual(artifacts);
    expect(repository.getRenderArtifactPath(artifactId)).toMatchObject({ path: "/scoped/rendered.mp3", artifact: artifacts[0] });
    expect(repository.listRenderSegments(renderId)).toEqual([expect.objectContaining({ ordinal: 1, audioFileName: "000001.wav", audioSizeBytes: 24_044 })]);
    expect(repository.getRenderSegmentPath(renderId, 1)).toMatchObject({ path: "/tmp/render/segments/000001.wav" });
    repository.close();

    const reopened = await openStudyNarratorRepository({ Database: DatabaseAdapter, databasePath });
    expect(reopened.getRenderJob(renderId)).toEqual(complete);
    expect(reopened.listRenderArtifacts(renderId)).toEqual(artifacts);
    expect(reopened.getRenderSegmentPath(renderId, 1)).toMatchObject({ path: "/tmp/render/segments/000001.wav" });
    reopened.close();
  });
});
