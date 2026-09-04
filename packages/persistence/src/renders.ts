import {
  ProjectIdSchema,
  RenderArtifactCollectionSchema,
  RenderArtifactSchema,
  RenderIdSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  RenderSegmentSchema,
} from "@studynarrator/shared-types";
import { PersistenceNotFoundError } from "./errors.js";
import type { DatabaseLike } from "./migrations.js";
import type { StudyNarratorRepository } from "./repository.js";
import {
  booleanToSql,
  renderArtifactFromRow,
  type RenderArtifactRow,
  renderJobFromRow,
  type RenderJobRow,
  renderSegmentFromRow,
  type RenderSegmentRow,
} from "./rowMappers.js";

type RenderRepositoryMethods = Pick<
  StudyNarratorRepository,
  | "createRenderJob"
  | "getRenderJob"
  | "listRenderJobs"
  | "listRecoverableRenderJobs"
  | "listRetentionRenderJobs"
  | "listPinnedRenderProjectIds"
  | "clearRenderMedia"
  | "updateRenderJob"
  | "updateRenderSegment"
  | "listRenderSegments"
  | "getRenderSegmentPath"
  | "replaceRenderArtifacts"
  | "listRenderArtifacts"
  | "getRenderArtifactPath"
>;

export function createRenderRepository(dependencies: {
  database: DatabaseLike;
  assertOpen: () => void;
  transaction: <T>(operation: () => T) => T;
}): RenderRepositoryMethods {
  const { database, assertOpen, transaction } = dependencies;

  return {
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
            id, project_id, plan_id, retry_of_render_id, pinned, state, progress_json, error_json,
            created_at, started_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            job.id,
            job.projectId,
            job.planId,
            job.retryOfRenderId,
            booleanToSql(job.pinned),
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
    listRetentionRenderJobs() {
      assertOpen();
      return RenderJobCollectionSchema.parse(
        (
          database
            .prepare(
              "SELECT * FROM render_jobs ORDER BY created_at ASC, id ASC",
            )
            .all() as RenderJobRow[]
        ).map(renderJobFromRow),
      );
    },
    listPinnedRenderProjectIds() {
      assertOpen();
      return (
        database
          .prepare(
            "SELECT DISTINCT project_id FROM render_jobs WHERE pinned = 1 ORDER BY project_id ASC",
          )
          .all() as Array<{ project_id: string }>
      ).map(({ project_id: projectId }) => ProjectIdSchema.parse(projectId));
    },
    clearRenderMedia(renderId) {
      assertOpen();
      database
        .prepare("DELETE FROM render_artifacts WHERE render_id = ?")
        .run(RenderIdSchema.parse(renderId));
      database
        .prepare(
          "UPDATE render_segments SET audio_path = NULL, audio_file_name = NULL, audio_size_bytes = NULL, audio_checksum = NULL WHERE render_id = ?",
        )
        .run(renderId);
    },
    updateRenderJob(jobValue) {
      assertOpen();
      const job = RenderJobSchema.parse(jobValue);
      const result = database
        .prepare(
          `
        UPDATE render_jobs SET pinned = ?, state = ?, progress_json = ?, error_json = ?, started_at = ?, finished_at = ? WHERE id = ?
      `,
        )
        .run(
          booleanToSql(job.pinned),
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
          INSERT INTO render_artifacts (id, render_id, artifact_type, file_name, path, size_bytes, duration_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const { artifact, path } of artifacts)
          insert.run(
            artifact.id,
            artifact.renderId,
            artifact.type,
            artifact.fileName,
            path,
            artifact.sizeBytes,
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
  };
}
