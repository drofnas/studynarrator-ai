import { CIR_SCHEMA_VERSION, LEXICON_TRANSFORM_VERSION, PARAGRAPH_PACING_VERSION, SCRIPT_GRAMMAR_VERSION, SourceRangeSchema } from "@studynarrator/core";
import { z } from "zod";
import {
  DurableIdSchema,
  GlobalLexiconEntryCollectionSchema,
  IgnoredDiagnosticCollectionSchema,
  ProjectDetailSchema,
  ProjectIdSchema
} from "./persistence.js";

export const PROJECT_SNAPSHOT_SCHEMA_VERSION = 1;
export const RENDER_PLAN_SCHEMA_VERSION = 1;
export const RENDER_PLAN_CHANNELS = Object.freeze({
  create: "renderPlans.create",
  list: "renderPlans.list",
  get: "renderPlans.get"
} as const);

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const RenderPlanIdSchema = z.uuid();
export const RenderPlanIdInputSchema = z.object({ planId: RenderPlanIdSchema }).strict();
export const RenderPlanProjectInputSchema = z.object({ projectId: ProjectIdSchema }).strict();

export const ProjectSnapshotSchema = z.object({
  schemaVersion: z.literal(PROJECT_SNAPSHOT_SCHEMA_VERSION),
  snapshotHash: HashSchema,
  capturedAt: z.iso.datetime({ offset: true }),
  project: ProjectDetailSchema,
  globalLexiconEntries: GlobalLexiconEntryCollectionSchema,
  ignoredDiagnostics: IgnoredDiagnosticCollectionSchema,
  connection: z.object({
    profileId: DurableIdSchema,
    profileName: z.string().min(1),
    profileSource: z.enum(["saved", "environment"]),
    modelId: z.string().min(1),
    serverIdentityHash: HashSchema
  }).strict(),
  versions: z.object({
    scriptGrammar: z.literal(SCRIPT_GRAMMAR_VERSION),
    cirSchema: z.literal(CIR_SCHEMA_VERSION),
    lexiconTransform: z.literal(LEXICON_TRANSFORM_VERSION),
    pacing: z.literal(PARAGRAPH_PACING_VERSION),
    speechCacheSchema: z.number().int().positive(),
    speechNormalization: z.number().int().positive(),
    speechChunking: z.number().int().positive(),
    speechAdapter: z.number().int().positive()
  }).strict()
}).strict();
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

const RenderEntryBaseSchema = z.object({
  ordinal: z.number().int().positive(),
  sectionTitle: z.string().min(1).nullable(),
  sourceRange: SourceRangeSchema.nullable()
});

export const RenderSectionEntrySchema = RenderEntryBaseSchema.extend({
  type: z.literal("section"),
  nodeOrdinal: z.number().int().positive(),
  title: z.string().min(1)
}).strict();

export const RenderSpeechChunkSchema = z.object({
  ordinal: z.number().int().positive(),
  text: z.string().min(1),
  cacheKey: HashSchema,
  cacheStatus: z.enum(["hit", "miss"])
}).strict();

export const RenderSpeechEntrySchema = RenderEntryBaseSchema.extend({
  type: z.literal("speech"),
  nodeOrdinal: z.number().int().positive(),
  speakerId: z.string().min(1),
  voiceId: z.string().min(1),
  speed: z.number().positive().max(4),
  gainDb: z.number().min(-60).max(24),
  originalText: z.string().min(1),
  readableText: z.string().min(1),
  ttsText: z.string().min(1),
  chunks: z.array(RenderSpeechChunkSchema).length(1)
}).strict();

export const SilenceAssetSchema = z.object({
  relativePath: z.string().regex(/^silence\/[a-f0-9]{64}\.wav$/u),
  checksum: HashSchema,
  byteLength: z.number().int().positive(),
  sampleRate: z.literal(24_000),
  channels: z.literal(1),
  bitsPerSample: z.literal(16),
  frameCount: z.number().int().positive()
}).strict();
export type SilenceAsset = z.infer<typeof SilenceAssetSchema>;

export const RenderPauseEntrySchema = RenderEntryBaseSchema.extend({
  type: z.literal("pause"),
  pauseKind: z.enum(["explicit", "automatic"]),
  reason: z.enum(["explicit", "paragraph", "speakerChange", "section"]),
  pauseId: z.string().regex(/^pause_[A-Za-z0-9_-]*$/u).nullable(),
  durationMs: z.number().int().min(0).max(30_000),
  silence: SilenceAssetSchema.nullable()
}).strict();

export const RenderPlanEntrySchema = z.discriminatedUnion("type", [
  RenderSectionEntrySchema,
  RenderSpeechEntrySchema,
  RenderPauseEntrySchema
]);
export type RenderPlanEntry = z.infer<typeof RenderPlanEntrySchema>;

export const RenderPlanSchema = z.object({
  schemaVersion: z.literal(RENDER_PLAN_SCHEMA_VERSION),
  id: RenderPlanIdSchema,
  projectId: ProjectIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  snapshotHash: HashSchema,
  planHash: HashSchema,
  scriptHash: HashSchema,
  entries: z.array(RenderPlanEntrySchema),
  summary: z.object({
    sectionCount: z.number().int().nonnegative(),
    speechCount: z.number().int().nonnegative(),
    pauseCount: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    cacheMisses: z.number().int().nonnegative(),
    silenceDurationMs: z.number().int().nonnegative()
  }).strict()
}).strict().superRefine((plan, context) => {
  plan.entries.forEach((entry, index) => {
    if (entry.type === "pause" && (entry.durationMs === 0) !== (entry.silence === null)) {
      context.addIssue({ code: "custom", message: "Zero-duration pauses must omit silence; audible pauses must reference it.", path: ["entries", index, "silence"] });
    }
  });
});
export type RenderPlan = z.infer<typeof RenderPlanSchema>;

export const RenderPlanSummarySchema = z.object({
  id: RenderPlanIdSchema,
  projectId: ProjectIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  snapshotHash: HashSchema,
  planHash: HashSchema,
  scriptHash: HashSchema,
  summary: z.object({
    sectionCount: z.number().int().nonnegative(),
    speechCount: z.number().int().nonnegative(),
    pauseCount: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    cacheMisses: z.number().int().nonnegative(),
    silenceDurationMs: z.number().int().nonnegative()
  }).strict()
}).strict();
export const RenderPlanSummaryCollectionSchema = z.array(RenderPlanSummarySchema);
export type RenderPlanSummary = z.infer<typeof RenderPlanSummarySchema>;

export interface RenderPlanClient {
  create(projectId: string): Promise<RenderPlan>;
  list(projectId: string): Promise<RenderPlanSummary[]>;
  get(planId: string): Promise<RenderPlan>;
}
