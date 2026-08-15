import { z } from "zod";
import { PreviewAudioSchema, PreviewCacheMetadataSchema } from "./preview.js";

export const SCRATCHPAD_SCHEMA_VERSION = 1;
const SCRATCHPAD_MAX_CHARACTERS = 1_200;
export const SCRATCHPAD_CHANNELS = Object.freeze({ preview: "scratchpad.preview" } as const);

export const ScratchpadPreviewInputSchema = z.object({
  modelId: z.string().trim().min(1).max(500),
  voiceId: z.string().trim().min(1).max(500),
  speed: z.number().positive().max(4),
  text: z.string().max(SCRATCHPAD_MAX_CHARACTERS).refine((value) => value.trim().length > 0, "Enter a passage to synthesize."),
  applyGlobalLexicon: z.boolean()
}).strict();
type ScratchpadPreviewInput = z.infer<typeof ScratchpadPreviewInputSchema>;

const ScratchpadWarningSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  message: z.string().min(1).max(1_000),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional()
}).strict();

export const ScratchpadPreviewResultSchema = z.object({
  schemaVersion: z.literal(SCRATCHPAD_SCHEMA_VERSION),
  id: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  modelId: z.string().min(1).max(500),
  voiceId: z.string().min(1).max(500),
  voiceLabel: z.string().min(1).max(500),
  speed: z.number().positive().max(4),
  originalText: z.string().max(SCRATCHPAD_MAX_CHARACTERS),
  readableText: z.string().min(1).max(SCRATCHPAD_MAX_CHARACTERS * 2),
  transformedText: z.string().min(1).max(SCRATCHPAD_MAX_CHARACTERS * 2),
  lexiconApplied: z.boolean(),
  warnings: z.array(ScratchpadWarningSchema).max(100),
  cache: PreviewCacheMetadataSchema,
  audio: PreviewAudioSchema
}).strict();
export type ScratchpadPreviewResult = z.infer<typeof ScratchpadPreviewResultSchema>;

export interface ScratchpadClient {
  preview(input: ScratchpadPreviewInput, signal?: AbortSignal): Promise<ScratchpadPreviewResult>;
}
