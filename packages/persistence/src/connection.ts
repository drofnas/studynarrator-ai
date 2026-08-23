import {
  ConnectionTestSummarySchema,
  CONNECTION_DIAGNOSTIC_SCHEMA_VERSION,
  RetentionSettingsAuthoringSchema,
  SpeechBackendConnectionAuthoringSchema,
  VoiceCatalogSchema,
  VoiceTimingCalibrationSchema,
} from "@studynarrator/shared-types";
import { PersistenceNotFoundError } from "./errors.js";
import type { DatabaseLike } from "./migrations.js";
import type { StudyNarratorRepository } from "./repository.js";
import {
  booleanFromSql,
  booleanToSql,
  connectionFromRow,
  type ConnectionRow,
  type ConnectionSetupRow,
  retentionSettingsFromRow,
  type RetentionSettingsRow,
  VoiceTimingCalibrationKeySchema,
  voiceTimingCalibrationFromRow,
  type VoiceCatalogOverrideRow,
  type VoiceTimingCalibrationRow,
} from "./rowMappers.js";

export interface ConnectionSetupRecord {
  onboardingCompletedAt: string | null;
}

type ConnectionRepositoryMethods = Pick<
  StudyNarratorRepository,
  | "getSpeechBackendConnection"
  | "replaceSpeechBackendConnection"
  | "recordConnectionTest"
  | "getConnectionSetup"
  | "completeConnectionOnboarding"
  | "getVoiceCatalogOverrides"
  | "replaceVoiceCatalogOverrides"
  | "getVoiceTimingCalibration"
  | "upsertVoiceTimingCalibration"
  | "getRetentionSettings"
  | "updateRetentionSettings"
>;

export function createConnectionRepository(dependencies: {
  database: DatabaseLike;
  now: () => Date;
  assertOpen: () => void;
  transaction: <T>(operation: () => T) => T;
}): ConnectionRepositoryMethods {
  const { database, now, assertOpen, transaction } = dependencies;

  const getSpeechBackendConnection = () => {
    assertOpen();
    const row = database
      .prepare("SELECT * FROM speech_backend_connection WHERE singleton_id = 1")
      .get() as ConnectionRow | undefined;
    if (!row)
      throw new PersistenceNotFoundError(
        "The Speaches connection was not found.",
      );
    return connectionFromRow(row);
  };

  const getConnectionSetup = (): ConnectionSetupRecord => {
    assertOpen();
    const row = database
      .prepare(
        "SELECT onboarding_completed_at FROM connection_setup WHERE singleton_id = 1",
      )
      .get() as ConnectionSetupRow;
    return { onboardingCompletedAt: row.onboarding_completed_at };
  };

  const getVoiceCatalogOverrides = (modelId: string) => {
    assertOpen();
    const rows = database
      .prepare(
        `
      SELECT voice_id, label, enabled, favorite, language, locale, accent, category, style, sample_text
      FROM voice_catalog_overrides WHERE model_id = ? ORDER BY ordinal ASC, voice_id ASC
    `,
      )
      .all(modelId) as VoiceCatalogOverrideRow[];
    return VoiceCatalogSchema.parse({
      schemaVersion: CONNECTION_DIAGNOSTIC_SCHEMA_VERSION,
      modelId,
      entries: rows.map((row) => ({
        voiceId: row.voice_id,
        label: row.label,
        enabled: booleanFromSql(row.enabled),
        favorite: booleanFromSql(row.favorite),
        language: row.language,
        locale: row.locale,
        accent: row.accent,
        category: row.category,
        style: row.style,
        sampleText: row.sample_text,
      })),
    });
  };

  const getVoiceTimingCalibration = (
    modelIdInput: string,
    voiceIdInput: string,
  ) => {
    assertOpen();
    const { modelId, voiceId } = VoiceTimingCalibrationKeySchema.parse({
      modelId: modelIdInput,
      voiceId: voiceIdInput,
    });
    const row = database
      .prepare(
        "SELECT * FROM voice_timing_calibration WHERE model_id = ? AND voice_id = ?",
      )
      .get(modelId, voiceId) as VoiceTimingCalibrationRow | undefined;
    return row === undefined ? null : voiceTimingCalibrationFromRow(row);
  };

  const getRetentionSettings = () => {
    assertOpen();
    const row = database
      .prepare("SELECT * FROM retention_settings WHERE singleton_id = 1")
      .get() as RetentionSettingsRow | undefined;
    if (!row)
      throw new PersistenceNotFoundError(
        "The retention settings were not found.",
      );
    return retentionSettingsFromRow(row);
  };

  return {
    getSpeechBackendConnection,
    replaceSpeechBackendConnection(inputValue, suppliedUrlForm) {
      assertOpen();
      const input = SpeechBackendConnectionAuthoringSchema.parse(inputValue);
      const existing = getSpeechBackendConnection();
      const unchanged =
        existing.baseUrl === input.baseUrl &&
        existing.defaultModelId === input.defaultModelId &&
        existing.defaultVoiceId === input.defaultVoiceId &&
        existing.timeoutSeconds === input.timeoutSeconds &&
        existing.retryCount === input.retryCount &&
        existing.suppliedUrlForm === suppliedUrlForm;
      database
        .prepare(
          `
        UPDATE speech_backend_connection SET base_url = ?, default_model_id = ?, default_voice_id = ?,
          timeout_seconds = ?, retry_count = ?, response_format = ?, supplied_url_form = ?, updated_at = ?
        WHERE singleton_id = 1
      `,
        )
        .run(
          input.baseUrl,
          input.defaultModelId,
          input.defaultVoiceId,
          input.timeoutSeconds,
          input.retryCount,
          input.responseFormat,
          suppliedUrlForm,
          unchanged ? existing.updatedAt : now().toISOString(),
        );
      return getSpeechBackendConnection();
    },
    recordConnectionTest(summaryValue) {
      assertOpen();
      const summary = ConnectionTestSummarySchema.parse(summaryValue);
      const connection = getSpeechBackendConnection();
      const result = database
        .prepare(
          `
        UPDATE speech_backend_connection SET last_tested_at = ?, last_successful_test_at = ?,
          last_test_summary_json = ?, updated_at = ? WHERE singleton_id = 1
      `,
        )
        .run(
          summary.testedAt,
          summary.overall === "connected"
            ? summary.testedAt
            : connection.lastSuccessfulTestAt,
          JSON.stringify(summary),
          now().toISOString(),
        );
      if (Number(result.changes ?? 0) !== 1)
        throw new PersistenceNotFoundError(
          "The Speaches connection was not found.",
        );
      return getSpeechBackendConnection();
    },
    getConnectionSetup,
    completeConnectionOnboarding() {
      assertOpen();
      const timestamp = now().toISOString();
      database
        .prepare(
          "UPDATE connection_setup SET onboarding_completed_at = ?, updated_at = ? WHERE singleton_id = 1",
        )
        .run(timestamp, timestamp);
      return getConnectionSetup();
    },
    getVoiceCatalogOverrides,
    replaceVoiceCatalogOverrides(inputValue) {
      assertOpen();
      const input = VoiceCatalogSchema.parse(inputValue);
      transaction(() => {
        database
          .prepare("DELETE FROM voice_catalog_overrides WHERE model_id = ?")
          .run(input.modelId);
        const insert = database.prepare(`
          INSERT INTO voice_catalog_overrides (
            model_id, voice_id, ordinal, label, enabled, favorite, language, locale, accent, category, style, sample_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        input.entries.forEach((entry, ordinal) =>
          insert.run(
            input.modelId,
            entry.voiceId,
            ordinal,
            entry.label,
            booleanToSql(entry.enabled),
            booleanToSql(entry.favorite),
            entry.language,
            entry.locale,
            entry.accent,
            entry.category,
            entry.style,
            entry.sampleText,
          ),
        );
      });
      return getVoiceCatalogOverrides(input.modelId);
    },
    getVoiceTimingCalibration,
    upsertVoiceTimingCalibration(calibrationValue) {
      assertOpen();
      const calibration = VoiceTimingCalibrationSchema.parse(calibrationValue);
      return transaction(() => {
        database
          .prepare(
            `
          INSERT INTO voice_timing_calibration (
            model_id, voice_id, milliseconds_per_normalized_character, sample_count, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(model_id, voice_id) DO UPDATE SET
            milliseconds_per_normalized_character = excluded.milliseconds_per_normalized_character,
            sample_count = excluded.sample_count,
            updated_at = excluded.updated_at
        `,
          )
          .run(
            calibration.modelId,
            calibration.voiceId,
            calibration.millisecondsPerNormalizedCharacter,
            calibration.sampleCount,
            calibration.updatedAt,
          );
        const persisted = getVoiceTimingCalibration(
          calibration.modelId,
          calibration.voiceId,
        );
        if (persisted === null)
          throw new Error(
            "Stored voice timing calibration was not found after upsert.",
          );
        return persisted;
      });
    },
    getRetentionSettings,
    updateRetentionSettings(settingsValue) {
      assertOpen();
      const settings = RetentionSettingsAuthoringSchema.parse(settingsValue);
      const result = database
        .prepare(
          `
          UPDATE retention_settings SET
            speech_cache_ttl = ?, job_snapshot_ttl = ?, render_artifact_ttl = ?,
            speech_cache_size_cap_bytes = ?, updated_at = ?
          WHERE singleton_id = 1
        `,
        )
        .run(
          settings.speechCacheTtl,
          settings.jobSnapshotTtl,
          settings.renderArtifactTtl,
          settings.speechCacheSizeCapBytes,
          now().toISOString(),
        );
      if (Number(result.changes ?? 0) !== 1)
        throw new PersistenceNotFoundError(
          "The retention settings were not found.",
        );
      return getRetentionSettings();
    },
  };
}
