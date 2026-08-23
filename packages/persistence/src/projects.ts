import {
  PERSISTENCE_CONTRACT_VERSION,
  ProjectCreateInputSchema,
  ProjectDetailSchema,
  ProjectDuplicateInputSchema,
  ProjectIdSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  SystemTimingConfigurationSchema,
} from "@studynarrator/shared-types";
import { PersistenceNotFoundError } from "./errors.js";
import type { createLexiconRepository } from "./lexicon.js";
import type { DatabaseLike } from "./migrations.js";
import type { StudyNarratorRepository } from "./repository.js";
import {
  type PauseRow,
  type ProjectRow,
  type ProjectSummaryRow,
  scriptHash,
  type SpeakerRow,
  type SystemTimingRow,
  transitionConfiguration,
  transitionParameters,
} from "./rowMappers.js";

type ProjectRepositoryMethods = Pick<
  StudyNarratorRepository,
  | "listProjects"
  | "createProject"
  | "getProject"
  | "replaceProject"
  | "listSpeechCacheDeletionQueue"
  | "acknowledgeSpeechCacheDeletion"
  | "duplicateProject"
  | "deleteProject"
  | "getSystemPacing"
  | "updateSystemPacing"
>;

export function createProjectRepository(dependencies: {
  database: DatabaseLike;
  now: () => Date;
  assertOpen: () => void;
  transaction: <T>(operation: () => T) => T;
  nextId: () => string;
  readLexicon: ReturnType<typeof createLexiconRepository>["readLexicon"];
  replaceLexicon: ReturnType<typeof createLexiconRepository>["replaceLexicon"];
}): ProjectRepositoryMethods {
  const {
    database,
    now,
    assertOpen,
    transaction,
    nextId,
    readLexicon,
    replaceLexicon,
  } = dependencies;

  const getProject = (projectIdInput: string) => {
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

  return {
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
      const timestamp = now().toISOString();
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
      const timestamp = now().toISOString();
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
      const timestamp = now().toISOString();
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
          .run(...paragraph, ...speakerChange, ...section, now().toISOString());
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
  };
}
