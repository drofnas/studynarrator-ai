import { z } from "zod";
import { ProjectIdSchema } from "./persistence.js";
import { RenderPlanIdSchema } from "./renderPlan.js";

export const RENDER_CONTRACT_VERSION = 1;
export const RENDER_CHANNELS = Object.freeze({
  start: "renders.start",
  list: "renders.list",
  get: "renders.get",
  cancel: "renders.cancel",
  retry: "renders.retry",
  artifacts: "renders.artifacts",
  exportArtifact: "renders.exportArtifact"
} as const);

export const RenderIdSchema = z.uuid();
export const RenderArtifactIdSchema = z.uuid();
export const RenderStateSchema = z.enum([
  "queued", "validating", "synthesizing", "assembling", "normalizing",
  "encoding", "writing_artifacts", "complete", "failed", "canceled"
]);
export type RenderState = z.infer<typeof RenderStateSchema>;
export const RenderTerminalStateSchema = z.enum(["complete", "failed", "canceled"]);

export const RenderErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1).max(500),
  retryable: z.boolean(),
  phase: RenderStateSchema,
  entryOrdinal: z.number().int().positive().nullable(),
  chunkOrdinal: z.number().int().positive().nullable(),
  sourceRange: z.object({
    start: z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict(),
    end: z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict()
  }).strict().nullable(),
  speakerId: z.string().min(1).nullable(),
  voiceId: z.string().min(1).nullable()
}).strict();
export type RenderError = z.infer<typeof RenderErrorSchema>;

export const RenderProgressSchema = z.object({
  phase: RenderStateSchema,
  sectionTitle: z.string().min(1).nullable(),
  sectionOrdinal: z.number().int().nonnegative(),
  sectionCount: z.number().int().nonnegative(),
  entryOrdinal: z.number().int().positive().nullable(),
  speechOrdinal: z.number().int().nonnegative(),
  speechCount: z.number().int().nonnegative(),
  chunkOrdinal: z.number().int().positive().nullable(),
  completedChunks: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  cacheMisses: z.number().int().nonnegative(),
  ttsRequests: z.number().int().nonnegative(),
  speakerId: z.string().min(1).nullable(),
  voiceId: z.string().min(1).nullable(),
  excerpt: z.string().max(160).nullable(),
  elapsedMs: z.number().int().nonnegative()
}).strict();
export type RenderProgress = z.infer<typeof RenderProgressSchema>;

export const RenderJobSchema = z.object({
  contractVersion: z.literal(RENDER_CONTRACT_VERSION),
  id: RenderIdSchema,
  projectId: ProjectIdSchema,
  planId: RenderPlanIdSchema,
  retryOfRenderId: RenderIdSchema.nullable(),
  state: RenderStateSchema,
  progress: RenderProgressSchema,
  error: RenderErrorSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  finishedAt: z.iso.datetime({ offset: true }).nullable()
}).strict();
export type RenderJob = z.infer<typeof RenderJobSchema>;
export const RenderJobCollectionSchema = z.array(RenderJobSchema);

export const RenderSegmentSchema = z.object({
  renderId: RenderIdSchema,
  ordinal: z.number().int().positive(),
  type: z.enum(["section", "speech", "pause"]),
  state: z.enum(["pending", "complete", "failed", "skipped"]),
  cacheStatus: z.enum(["hit", "miss"]).nullable(),
  audioDurationMs: z.number().int().nonnegative().nullable(),
  error: RenderErrorSchema.nullable()
}).strict();
export type RenderSegment = z.infer<typeof RenderSegmentSchema>;

export const RenderArtifactTypeSchema = z.enum([
  "mp3", "originalScript", "readableTranscript", "ttsTranscript",
  "manifest", "projectSnapshot", "checksums"
]);
export const RenderArtifactSchema = z.object({
  contractVersion: z.literal(RENDER_CONTRACT_VERSION),
  id: RenderArtifactIdSchema,
  renderId: RenderIdSchema,
  type: RenderArtifactTypeSchema,
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime({ offset: true })
}).strict();
export type RenderArtifact = z.infer<typeof RenderArtifactSchema>;
export const RenderArtifactCollectionSchema = z.array(RenderArtifactSchema);

export const RenderPlanInputSchema = z.object({ planId: RenderPlanIdSchema }).strict();
export const RenderProjectInputSchema = z.object({ projectId: ProjectIdSchema }).strict();
export const RenderIdInputSchema = z.object({ renderId: RenderIdSchema }).strict();
export const RenderArtifactInputSchema = z.object({ artifactId: RenderArtifactIdSchema }).strict();
export const RenderArtifactExportResultSchema = z.object({
  disposition: z.enum(["download", "saved", "canceled"]),
  fileName: z.string().min(1)
}).strict();
export type RenderArtifactExportResult = z.infer<typeof RenderArtifactExportResultSchema>;

export interface RenderClient {
  start(planId: string): Promise<RenderJob>;
  list(projectId: string): Promise<RenderJob[]>;
  get(renderId: string): Promise<RenderJob>;
  cancel(renderId: string): Promise<RenderJob>;
  retry(renderId: string): Promise<RenderJob>;
  listArtifacts(renderId: string): Promise<RenderArtifact[]>;
  exportArtifact(artifactId: string): Promise<RenderArtifactExportResult>;
}
