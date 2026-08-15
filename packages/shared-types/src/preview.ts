import { SourceRangeSchema, SpeakerIdSchema } from "@studynarrator/core";
import { z } from "zod";
import { ProjectIdSchema } from "./persistence.js";

export const PROJECT_PREVIEW_SCHEMA_VERSION = 1;
export const SPEECH_CACHE_CONTRACT_VERSION = 1;
const MAX_PREVIEW_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_PRONUNCIATION_PREVIEW_CHARACTERS = 1_200;
const CACHE_KEY_PATTERN = /^[a-f0-9]{64}$/u;

export const PROJECT_PREVIEW_CHANNELS = Object.freeze({ preview: "projects.preview" } as const);
export const SPEECH_CACHE_CHANNELS = Object.freeze({
  status: "speech-cache.status",
  clearAll: "speech-cache.clear-all",
  clearProject: "speech-cache.clear-project",
  clearEntry: "speech-cache.clear-entry"
} as const);

export const PreviewAudioSchema = z.object({
  mimeType: z.literal("audio/wav"),
  base64: z.string().min(1).max(7_100_000).regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  byteLength: z.number().int().positive().max(MAX_PREVIEW_AUDIO_BYTES)
}).strict().superRefine((audio, context) => {
  const padding = audio.base64.endsWith("==") ? 2 : audio.base64.endsWith("=") ? 1 : 0;
  const decodedLength = Math.floor(audio.base64.length * 3 / 4) - padding;
  if (decodedLength !== audio.byteLength) {
    context.addIssue({ code: "custom", message: "Audio byte length does not match its encoded data.", path: ["byteLength"] });
  }
});

export const PreviewCacheMetadataSchema = z.object({
  key: z.string().regex(CACHE_KEY_PATTERN),
  status: z.enum(["hit", "miss"]),
  byteLength: z.number().int().positive().max(MAX_PREVIEW_AUDIO_BYTES),
  createdAt: z.iso.datetime({ offset: true }),
  lastUsedAt: z.iso.datetime({ offset: true })
}).strict();

const ProjectSegmentPreviewInputSchema = z.object({
  mode: z.literal("segment"),
  nodeOrdinal: z.number().int().positive()
}).strict();

const PronunciationPreviewInputSchema = z.object({
  mode: z.literal("pronunciation"),
  text: z.string().max(MAX_PRONUNCIATION_PREVIEW_CHARACTERS)
    .refine((value) => value.trim().length > 0, "Enter a pronunciation sample."),
  speakerId: SpeakerIdSchema.optional()
}).strict();

export const ProjectPreviewInputSchema = z.discriminatedUnion("mode", [
  ProjectSegmentPreviewInputSchema,
  PronunciationPreviewInputSchema
]);
export type ProjectPreviewInput = z.infer<typeof ProjectPreviewInputSchema>;

export const ProjectPreviewRequestSchema = z.object({
  projectId: ProjectIdSchema,
  preview: ProjectPreviewInputSchema
}).strict();

export const ProjectPreviewResultSchema = z.object({
  schemaVersion: z.literal(PROJECT_PREVIEW_SCHEMA_VERSION),
  id: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  projectId: ProjectIdSchema,
  mode: z.enum(["segment", "pronunciation"]),
  nodeOrdinal: z.number().int().positive().nullable(),
  sourceRange: SourceRangeSchema.nullable(),
  modelId: z.string().min(1).max(500),
  speakerId: SpeakerIdSchema,
  voiceId: z.string().min(1).max(500),
  voiceLabel: z.string().min(1).max(500),
  speed: z.number().positive().max(4),
  originalText: z.string().min(1).max(5_000_000),
  readableText: z.string().min(1).max(5_000_000),
  transformedText: z.string().min(1).max(5_000_000),
  cache: PreviewCacheMetadataSchema,
  audio: PreviewAudioSchema
}).strict();
export type ProjectPreviewResult = z.infer<typeof ProjectPreviewResultSchema>;

export const SpeechCacheStatusSchema = z.object({
  contractVersion: z.literal(SPEECH_CACHE_CONTRACT_VERSION),
  entryCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
  sessionHits: z.number().int().nonnegative(),
  sessionMisses: z.number().int().nonnegative(),
  sessionWrites: z.number().int().nonnegative(),
  sessionCorruptMisses: z.number().int().nonnegative(),
  inFlight: z.number().int().nonnegative()
}).strict();
export type SpeechCacheStatus = z.infer<typeof SpeechCacheStatusSchema>;

export const SpeechCacheCleanupResultSchema = z.object({
  contractVersion: z.literal(SPEECH_CACHE_CONTRACT_VERSION),
  entriesRemoved: z.number().int().nonnegative(),
  bytesFreed: z.number().int().nonnegative()
}).strict();
type SpeechCacheCleanupResult = z.infer<typeof SpeechCacheCleanupResultSchema>;

export const SpeechCacheKeyInputSchema = z.object({ cacheKey: z.string().regex(CACHE_KEY_PATTERN) }).strict();
export const SpeechCacheProjectInputSchema = z.object({ projectId: ProjectIdSchema }).strict();

export interface ProjectPreviewClient {
  preview(projectId: string, input: ProjectPreviewInput, signal?: AbortSignal): Promise<ProjectPreviewResult>;
}

export interface SpeechCacheClient {
  status(): Promise<SpeechCacheStatus>;
  clearAll(): Promise<SpeechCacheCleanupResult>;
  clearProject(projectId: string): Promise<SpeechCacheCleanupResult>;
  clearEntry(cacheKey: string): Promise<SpeechCacheCleanupResult>;
}
