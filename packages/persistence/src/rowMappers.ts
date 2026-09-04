import { createHash } from "node:crypto";
import { LexiconEntrySchema, type LexiconEntry } from "@studynarrator/core";
import {
  RENDER_CONTRACT_VERSION,
  RetentionSettingsSchema,
  SpeechBackendConnectionSchema,
  VoiceTimingCalibrationSchema,
  RenderArtifactSchema,
  RenderJobSchema,
  RenderSegmentSchema,
  type RetentionSettings,
  type SpeechBackendConnection,
  type SystemTransitionPauseConfiguration,
  type SystemTransitionPauseSetting,
  type VoiceTimingCalibration,
  type RenderArtifact,
  type RenderJob,
  type RenderSegment,
} from "@studynarrator/shared-types";

export const VoiceTimingCalibrationKeySchema =
  VoiceTimingCalibrationSchema.pick({
    modelId: true,
    voiceId: true,
  });

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  script_source: string;
  script_hash: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectSummaryRow extends Pick<
  ProjectRow,
  "id" | "name" | "description" | "script_hash" | "created_at" | "updated_at"
> {
  script_line_count: number | null;
  audio_duration_ms: number | null;
}

export interface SpeakerRow {
  speaker_id: string;
  display_name: string;
  voice_id: string | null;
  speed: number;
  gain_db: number;
  role_description: string;
  sample_text: string;
}

export interface PauseRow {
  pause_id: "pause_short" | "pause_medium" | "pause_long";
  duration_ms: number;
  description: string;
}

export interface SystemTimingRow {
  paragraph_transition_mode: "none" | "preset" | "duration";
  paragraph_transition_pause_id: string | null;
  paragraph_transition_duration_ms: number | null;
  speaker_change_transition_mode: "none" | "preset" | "duration";
  speaker_change_transition_pause_id: string | null;
  speaker_change_transition_duration_ms: number | null;
  section_transition_mode: "none" | "preset" | "duration";
  section_transition_pause_id: string | null;
  section_transition_duration_ms: number | null;
}

export interface LexiconRow {
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

export interface ConnectionRow {
  backend_id: "speaches";
  base_url: string | null;
  default_model_id: string | null;
  default_voice_id: string | null;
  timeout_seconds: number;
  retry_count: number;
  response_format: "wav";
  supplied_url_form: "root" | "v1" | "unconfigured";
  last_tested_at: string | null;
  last_successful_test_at: string | null;
  last_test_summary_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceTimingCalibrationRow {
  model_id: string;
  voice_id: string;
  milliseconds_per_normalized_character: number;
  sample_count: number;
  updated_at: string;
}

export interface RetentionSettingsRow {
  speech_cache_ttl: RetentionSettings["speechCacheTtl"];
  job_snapshot_ttl: RetentionSettings["jobSnapshotTtl"];
  render_artifact_ttl: RetentionSettings["renderArtifactTtl"];
  speech_cache_size_cap_bytes: number;
  updated_at: string;
}

export interface ConnectionSetupRow {
  onboarding_completed_at: string | null;
}

export interface VoiceCatalogOverrideRow {
  voice_id: string;
  label: string;
  enabled: number;
  favorite: number;
  language: string | null;
  locale: string | null;
  accent: string | null;
  category: string | null;
  style: string | null;
  sample_text: string | null;
}

export interface MarkerRow {
  key: string;
  value: string;
  created_at: string;
}
export interface VersionRow {
  version: string;
}

export interface RenderJobRow {
  id: string;
  project_id: string;
  // Vestigial. Render plans are computed per render and no longer have a
  // user-visible identity, so this value is generated and never looked up.
  // Scheduled for removal; see docs/technical-debt.md.
  plan_id: string;
  retry_of_render_id: string | null;
  pinned: number;
  state: RenderJob["state"];
  progress_json: string;
  error_json: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface RenderArtifactRow {
  id: string;
  render_id: string;
  artifact_type: RenderArtifact["type"];
  file_name: string;
  path: string;
  size_bytes: number;
  duration_ms: number | null;
  created_at: string;
}

export interface RenderSegmentRow {
  render_id: string;
  ordinal: number;
  segment_type: RenderSegment["type"];
  state: RenderSegment["state"];
  cache_status: RenderSegment["cacheStatus"];
  audio_duration_ms: number | null;
  error_json: string | null;
  audio_file_name: string | null;
  audio_path: string | null;
  audio_size_bytes: number | null;
  audio_checksum: string | null;
}

export function renderJobFromRow(row: RenderJobRow): RenderJob {
  return RenderJobSchema.parse({
    contractVersion: RENDER_CONTRACT_VERSION,
    id: row.id,
    projectId: row.project_id,
    planId: row.plan_id,
    retryOfRenderId: row.retry_of_render_id,
    pinned: booleanFromSql(row.pinned),
    state: row.state,
    progress: JSON.parse(row.progress_json) as unknown,
    error:
      row.error_json === null ? null : (JSON.parse(row.error_json) as unknown),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
}

export function renderArtifactFromRow(row: RenderArtifactRow): RenderArtifact {
  return RenderArtifactSchema.parse({
    contractVersion: RENDER_CONTRACT_VERSION,
    id: row.id,
    renderId: row.render_id,
    type: row.artifact_type,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  });
}

export function renderSegmentFromRow(row: RenderSegmentRow): RenderSegment {
  return RenderSegmentSchema.parse({
    renderId: row.render_id,
    ordinal: row.ordinal,
    type: row.segment_type,
    state: row.state,
    cacheStatus: row.cache_status,
    audioDurationMs: row.audio_duration_ms,
    audioFileName: row.audio_file_name,
    audioSizeBytes: row.audio_size_bytes,
    audioChecksum: row.audio_checksum,
    error:
      row.error_json === null ? null : (JSON.parse(row.error_json) as unknown),
  });
}

export function scriptHash(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function booleanFromSql(value: number): boolean {
  return value === 1;
}
export function booleanToSql(value: boolean): number {
  return value ? 1 : 0;
}

function transitionFromRow(
  mode: SystemTimingRow["paragraph_transition_mode"],
  pauseId: string | null,
  durationMs: number | null,
): SystemTransitionPauseSetting {
  if (mode === "none") return { mode };
  if (
    mode === "preset" &&
    (pauseId === "pause_short" ||
      pauseId === "pause_medium" ||
      pauseId === "pause_long")
  )
    return { mode, pauseId };
  if (mode === "duration" && durationMs !== null) return { mode, durationMs };
  throw new Error("Stored transition pause configuration is invalid.");
}

export function transitionParameters(
  setting: SystemTransitionPauseSetting,
): [string, string | null, number | null] {
  if (setting.mode === "none") return [setting.mode, null, null];
  if (setting.mode === "preset") return [setting.mode, setting.pauseId, null];
  return [setting.mode, null, setting.durationMs];
}

export function transitionConfiguration(
  row: SystemTimingRow,
): SystemTransitionPauseConfiguration {
  return {
    paragraph: transitionFromRow(
      row.paragraph_transition_mode,
      row.paragraph_transition_pause_id,
      row.paragraph_transition_duration_ms,
    ),
    speakerChange: transitionFromRow(
      row.speaker_change_transition_mode,
      row.speaker_change_transition_pause_id,
      row.speaker_change_transition_duration_ms,
    ),
    section: transitionFromRow(
      row.section_transition_mode,
      row.section_transition_pause_id,
      row.section_transition_duration_ms,
    ),
  };
}

export function lexiconFromRow(row: LexiconRow): LexiconEntry {
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
    updatedAt: row.updated_at,
  });
}

export function connectionFromRow(row: ConnectionRow): SpeechBackendConnection {
  return SpeechBackendConnectionSchema.parse({
    backendId: row.backend_id,
    baseUrl: row.base_url,
    configured:
      row.base_url !== null &&
      row.default_model_id !== null &&
      row.default_voice_id !== null,
    defaultModelId: row.default_model_id,
    defaultVoiceId: row.default_voice_id,
    timeoutSeconds: row.timeout_seconds,
    retryCount: row.retry_count,
    responseFormat: row.response_format,
    suppliedUrlForm: row.supplied_url_form,
    lastTestedAt: row.last_tested_at,
    lastSuccessfulTestAt: row.last_successful_test_at,
    lastTestSummary:
      row.last_test_summary_json === null
        ? null
        : (JSON.parse(row.last_test_summary_json) as unknown),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function voiceTimingCalibrationFromRow(
  row: VoiceTimingCalibrationRow,
): VoiceTimingCalibration {
  return VoiceTimingCalibrationSchema.parse({
    modelId: row.model_id,
    voiceId: row.voice_id,
    millisecondsPerNormalizedCharacter:
      row.milliseconds_per_normalized_character,
    sampleCount: row.sample_count,
    updatedAt: row.updated_at,
  });
}

export function retentionSettingsFromRow(
  row: RetentionSettingsRow,
): RetentionSettings {
  return RetentionSettingsSchema.parse({
    speechCacheTtl: row.speech_cache_ttl,
    jobSnapshotTtl: row.job_snapshot_ttl,
    renderArtifactTtl: row.render_artifact_ttl,
    speechCacheSizeCapBytes: row.speech_cache_size_cap_bytes,
    updatedAt: row.updated_at,
  });
}
