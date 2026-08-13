import { z } from "zod";

export const SCRATCHPAD_SCHEMA_VERSION = 1;
export const SCRATCHPAD_MAX_CHARACTERS = 1_200;
export const SCRATCHPAD_MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const SCRATCHPAD_CHANNELS = Object.freeze({ preview: "scratchpad.preview" } as const);

export const ScratchpadPreviewInputSchema = z.object({
  connectionProfileId: z.string().min(1).max(128),
  modelId: z.string().trim().min(1).max(500),
  voiceId: z.string().trim().min(1).max(500),
  speed: z.number().positive().max(4),
  text: z.string().max(SCRATCHPAD_MAX_CHARACTERS).refine((value) => value.trim().length > 0, "Enter a passage to synthesize."),
  applyGlobalLexicon: z.boolean()
}).strict();
export type ScratchpadPreviewInput = z.infer<typeof ScratchpadPreviewInputSchema>;

export const ScratchpadWarningSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  message: z.string().min(1).max(1_000),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional()
}).strict();
export type ScratchpadWarning = z.infer<typeof ScratchpadWarningSchema>;

const ScratchpadAudioSchema = z.object({
  mimeType: z.literal("audio/wav"),
  base64: z.string().min(1).max(7_100_000).regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  byteLength: z.number().int().positive().max(SCRATCHPAD_MAX_AUDIO_BYTES)
}).strict().superRefine((audio, context) => {
  const padding = audio.base64.endsWith("==") ? 2 : audio.base64.endsWith("=") ? 1 : 0;
  const decodedLength = Math.floor(audio.base64.length * 3 / 4) - padding;
  if (decodedLength !== audio.byteLength) {
    context.addIssue({ code: "custom", message: "Audio byte length does not match its encoded data.", path: ["byteLength"] });
  }
});

export const ScratchpadPreviewResultSchema = z.object({
  schemaVersion: z.literal(SCRATCHPAD_SCHEMA_VERSION),
  id: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  connectionProfileId: z.string().min(1).max(128),
  connectionProfileName: z.string().min(1).max(200),
  modelId: z.string().min(1).max(500),
  voiceId: z.string().min(1).max(500),
  speed: z.number().positive().max(4),
  originalText: z.string().max(SCRATCHPAD_MAX_CHARACTERS),
  readableText: z.string().min(1).max(SCRATCHPAD_MAX_CHARACTERS * 2),
  transformedText: z.string().min(1).max(SCRATCHPAD_MAX_CHARACTERS * 2),
  lexiconApplied: z.boolean(),
  warnings: z.array(ScratchpadWarningSchema).max(100),
  audio: ScratchpadAudioSchema
}).strict();
export type ScratchpadPreviewResult = z.infer<typeof ScratchpadPreviewResultSchema>;

export interface ScratchpadClient {
  preview(input: ScratchpadPreviewInput, signal?: AbortSignal): Promise<ScratchpadPreviewResult>;
}
