import { z } from "zod";
import {
  ProjectIdSchema,
  VoiceTimingCalibrationSchema,
} from "./persistence.js";
import { RenderPlanIdSchema } from "./renderPlan.js";

export const RENDER_CONTRACT_VERSION = 1;
export const RENDER_CHANNELS = Object.freeze({
  startProject: "renders.startProject",
  getEstimateContext: "renders.getEstimateContext",
  list: "renders.list",
  get: "renders.get",
  cancel: "renders.cancel",
  retry: "renders.retry",
  artifacts: "renders.artifacts",
  exportArtifact: "renders.exportArtifact",
  exportAudio: "renders.exportAudio",
  exportDetails: "renders.exportDetails",
  segments: "renders.segments",
  waveform: "renders.waveform",
  exportSegment: "renders.exportSegment",
} as const);

export const RenderIdSchema = z.uuid();
export const RenderArtifactIdSchema = z.uuid();

export const RENDER_DISK_HARD_RESERVE_PERCENT = 10;
/** A render warns when its peak estimate enters the final 25% of free space. */
export const RENDER_DISK_SOFT_RESERVE_PERCENT = 25;
export const DEFAULT_RENDER_START_OPTIONS = Object.freeze({
  diskSpaceCheckEnabled: true,
});

export const RenderStartOptionsSchema = z
  .object({ diskSpaceCheckEnabled: z.boolean().default(true) })
  .strict()
  .default(DEFAULT_RENDER_START_OPTIONS);
export type RenderStartOptions = z.infer<typeof RenderStartOptionsSchema>;

function checkedByteCount(value: number | bigint, name: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new RangeError(`${name} must be nonnegative.`);
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a nonnegative safe integer.`);
  return BigInt(value);
}

export function renderDiskSpaceUsableBytes(
  freeSpaceBytes: number,
  reservePercent:
    | typeof RENDER_DISK_HARD_RESERVE_PERCENT
    | typeof RENDER_DISK_SOFT_RESERVE_PERCENT,
): number {
  const freeBytes = checkedByteCount(freeSpaceBytes, "freeSpaceBytes");
  return Number((freeBytes * BigInt(100 - reservePercent)) / 100n);
}

export function renderDiskSpaceBlockMessage(
  estimatedPeakBytes: number | bigint,
  freeSpaceBytes: number | bigint,
  usableBytes: number | bigint,
): string {
  return `Render blocked: estimated peak disk use is ${checkedByteCount(estimatedPeakBytes, "estimatedPeakBytes").toString()} bytes, but the data volume has ${checkedByteCount(freeSpaceBytes, "freeSpaceBytes").toString()} free bytes and ${checkedByteCount(usableBytes, "usableBytes").toString()} usable bytes after the required 10% reserve.`;
}

export function renderDiskSpaceWarningMessage(
  estimatedPeakBytes: number | bigint,
  freeSpaceBytes: number | bigint,
  usableBytes: number | bigint,
): string {
  return `Disk space warning: estimated peak disk use is ${checkedByteCount(estimatedPeakBytes, "estimatedPeakBytes").toString()} bytes; the data volume has ${checkedByteCount(freeSpaceBytes, "freeSpaceBytes").toString()} free bytes and ${checkedByteCount(usableBytes, "usableBytes").toString()} usable bytes after the recommended 25% reserve. Rendering will continue.`;
}

const RenderStateSchema = z.enum([
  "queued",
  "validating",
  "synthesizing",
  "assembling",
  "normalizing",
  "encoding",
  "writing_artifacts",
  "complete",
  "failed",
  "canceled",
]);

const RenderErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    phase: RenderStateSchema,
    entryOrdinal: z.number().int().positive().nullable(),
    chunkOrdinal: z.number().int().positive().nullable(),
    sourceRange: z
      .object({
        start: z
          .object({
            line: z.number().int().positive(),
            column: z.number().int().positive(),
          })
          .strict(),
        end: z
          .object({
            line: z.number().int().positive(),
            column: z.number().int().positive(),
          })
          .strict(),
      })
      .strict()
      .nullable(),
    speakerId: z.string().min(1).nullable(),
    voiceId: z.string().min(1).nullable(),
  })
  .strict();
export type RenderError = z.infer<typeof RenderErrorSchema>;

const RenderProgressSchema = z
  .object({
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
    elapsedMs: z.number().int().nonnegative(),
  })
  .strict();
export type RenderProgress = z.infer<typeof RenderProgressSchema>;

export const RenderJobSchema = z
  .object({
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
    finishedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export type RenderJob = z.infer<typeof RenderJobSchema>;
export const RenderJobCollectionSchema = z.array(RenderJobSchema);

export const RenderSegmentSchema = z
  .object({
    renderId: RenderIdSchema,
    ordinal: z.number().int().positive(),
    type: z.enum(["section", "speech", "pause"]),
    state: z.enum(["pending", "complete", "failed", "skipped"]),
    cacheStatus: z.enum(["hit", "miss"]).nullable(),
    audioDurationMs: z.number().int().nonnegative().nullable(),
    audioFileName: z.string().min(1).max(255).nullable(),
    audioSizeBytes: z.number().int().positive().nullable(),
    audioChecksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    error: RenderErrorSchema.nullable(),
  })
  .strict()
  .superRefine((segment, context) => {
    const audioFields = [
      segment.audioFileName,
      segment.audioSizeBytes,
      segment.audioChecksum,
    ];
    const populated = audioFields.filter((value) => value !== null).length;
    if (populated !== 0 && populated !== audioFields.length) {
      context.addIssue({
        code: "custom",
        message: "Render segment audio metadata must be complete.",
        path: ["audioFileName"],
      });
    }
    if (populated > 0 && segment.type !== "speech") {
      context.addIssue({
        code: "custom",
        message: "Only speech segments retain review audio.",
        path: ["type"],
      });
    }
  });
export type RenderSegment = z.infer<typeof RenderSegmentSchema>;

const RenderHistorySegmentBaseSchema = z.object({
  renderId: RenderIdSchema,
  ordinal: z.number().int().positive(),
  state: z.enum(["pending", "complete", "failed", "skipped"]),
  sectionTitle: z.string().min(1).nullable(),
  sourceRange: z
    .object({
      start: z
        .object({
          line: z.number().int().positive(),
          column: z.number().int().positive(),
        })
        .strict(),
      end: z
        .object({
          line: z.number().int().positive(),
          column: z.number().int().positive(),
        })
        .strict(),
    })
    .strict()
    .nullable(),
  audioDurationMs: z.number().int().nonnegative().nullable(),
  cacheStatus: z.enum(["hit", "miss"]).nullable(),
  audio: z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("available"),
        mimeType: z.literal("audio/wav"),
        sizeBytes: z.number().int().positive(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ]),
  error: RenderErrorSchema.nullable(),
});

const RenderHistorySegmentSchema = z.discriminatedUnion("type", [
  RenderHistorySegmentBaseSchema.extend({
    type: z.literal("section"),
    title: z.string().min(1),
    audio: z.object({ status: z.literal("unavailable") }).strict(),
  }).strict(),
  RenderHistorySegmentBaseSchema.extend({
    type: z.literal("speech"),
    speakerId: z.string().min(1),
    speakerLabel: z.string().min(1),
    modelId: z.string().min(1),
    voiceId: z.string().min(1),
    readableText: z.string().min(1),
    ttsText: z.string().min(1),
  }).strict(),
  RenderHistorySegmentBaseSchema.extend({
    type: z.literal("pause"),
    pauseId: z.string().min(1).nullable(),
    pauseKind: z.enum(["explicit", "automatic"]),
    reason: z.enum(["explicit", "paragraph", "speakerChange", "section"]),
    durationMs: z.number().int().nonnegative(),
    audio: z.object({ status: z.literal("unavailable") }).strict(),
  }).strict(),
]);
export type RenderHistorySegment = z.infer<typeof RenderHistorySegmentSchema>;
export const RenderHistorySegmentCollectionSchema = z.array(
  RenderHistorySegmentSchema,
);

export const RenderWaveformSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      renderId: RenderIdSchema,
      sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
      durationMs: z.number().int().nonnegative(),
      sampleRate: z.number().int().positive(),
      peaks: z.array(z.number().int().min(0).max(255)).max(1_024),
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      renderId: RenderIdSchema,
      reason: z.enum(["renderIncomplete", "audioMissing", "extractionFailed"]),
    })
    .strict(),
]);
export type RenderWaveform = z.infer<typeof RenderWaveformSchema>;

const RenderArtifactTypeSchema = z.enum([
  "mp3",
  "originalScript",
  "readableTranscript",
  "ttsTranscript",
  "manifest",
  "projectSnapshot",
  "checksums",
]);
export const RenderArtifactSchema = z
  .object({
    contractVersion: z.literal(RENDER_CONTRACT_VERSION),
    id: RenderArtifactIdSchema,
    renderId: RenderIdSchema,
    type: RenderArtifactTypeSchema,
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().positive(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/u),
    durationMs: z.number().int().nonnegative().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type RenderArtifact = z.infer<typeof RenderArtifactSchema>;
export const RenderArtifactCollectionSchema = z.array(RenderArtifactSchema);

const RenderEstimateVoiceIdCollectionSchema = z
  .array(z.string().min(1).max(500))
  .max(100)
  .superRefine((voiceIds, context) => {
    const seen = new Set<string>();
    voiceIds.forEach((voiceId, index) => {
      if (seen.has(voiceId))
        context.addIssue({
          code: "custom",
          message: "Estimate voice IDs must be unique.",
          path: [index],
        });
      seen.add(voiceId);
    });
  });

export const RenderEstimateContextInputSchema = z
  .object({
    modelId: z.string().min(1).max(500).nullable(),
    voiceIds: RenderEstimateVoiceIdCollectionSchema,
  })
  .strict();
export type RenderEstimateContextInput = z.infer<
  typeof RenderEstimateContextInputSchema
>;

export const RenderEstimateContextResultSchema = z
  .object({
    freeSpaceBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    calibrations: z.array(VoiceTimingCalibrationSchema).max(100),
  })
  .strict()
  .superRefine((result, context) => {
    const seen = new Set<string>();
    result.calibrations.forEach((calibration, index) => {
      const key = `${calibration.modelId}\u0000${calibration.voiceId}`;
      if (seen.has(key))
        context.addIssue({
          code: "custom",
          message: "Estimate calibrations must be unique by model and voice.",
          path: ["calibrations", index],
        });
      seen.add(key);
    });
  });
export type RenderEstimateContextResult = z.infer<
  typeof RenderEstimateContextResultSchema
>;

export const RenderProjectInputSchema = z
  .object({ projectId: ProjectIdSchema })
  .strict();
export const RenderProjectStartInputSchema = z
  .object({
    projectId: ProjectIdSchema,
    options: RenderStartOptionsSchema,
  })
  .strict();
export const RenderIdInputSchema = z
  .object({ renderId: RenderIdSchema })
  .strict();
export const RenderSegmentInputSchema = z
  .object({
    renderId: RenderIdSchema,
    ordinal: z.number().int().positive(),
  })
  .strict();
export const RenderArtifactInputSchema = z
  .object({ artifactId: RenderArtifactIdSchema })
  .strict();
export const RenderArtifactExportResultSchema = z
  .object({
    disposition: z.enum(["download", "saved", "canceled"]),
    fileName: z.string().min(1),
  })
  .strict();
type RenderArtifactExportResult = z.infer<
  typeof RenderArtifactExportResultSchema
>;

export interface RenderClient {
  startProject(
    projectId: string,
    options?: RenderStartOptions,
  ): Promise<RenderJob>;
  getEstimateContext(
    input: RenderEstimateContextInput,
  ): Promise<RenderEstimateContextResult>;
  list(projectId: string): Promise<RenderJob[]>;
  get(renderId: string): Promise<RenderJob>;
  cancel(renderId: string): Promise<RenderJob>;
  retry(renderId: string): Promise<RenderJob>;
  listArtifacts(renderId: string): Promise<RenderArtifact[]>;
  exportArtifact(artifactId: string): Promise<RenderArtifactExportResult>;
  exportAudio(renderId: string): Promise<RenderArtifactExportResult>;
  exportDetails(renderId: string): Promise<RenderArtifactExportResult>;
  listSegments(renderId: string): Promise<RenderHistorySegment[]>;
  getWaveform(renderId: string): Promise<RenderWaveform>;
  renderAudioSource(renderId: string): string;
  segmentAudioSource(renderId: string, ordinal: number): string;
  exportSegment(
    renderId: string,
    ordinal: number,
  ): Promise<RenderArtifactExportResult>;
}
