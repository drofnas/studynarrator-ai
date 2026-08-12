import { z } from "zod";

export const SCRIPT_GRAMMAR_VERSION = 1;
export const CIR_SCHEMA_VERSION = 1;

export const SpeakerIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);

export const IgnoredDiagnosticSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  pattern: z.string().min(1)
}).strict();
export type IgnoredDiagnostic = z.infer<typeof IgnoredDiagnosticSchema>;

export const ParseScriptInputSchema = z.object({
  source: z.string(),
  defaultSpeakerId: SpeakerIdSchema.optional(),
  ignoredDiagnostics: z.array(IgnoredDiagnosticSchema).optional()
}).strict();
export type ParseScriptInput = z.infer<typeof ParseScriptInputSchema>;

export const SourcePositionSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive()
}).strict();

export const SourceRangeSchema = z.object({
  start: SourcePositionSchema,
  end: SourcePositionSchema
}).strict();
export type SourceRange = z.infer<typeof SourceRangeSchema>;

export const PronunciationAnnotationSchema = z.object({
  displayText: z.string().min(1),
  senseId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  rawText: z.string().min(1),
  range: SourceRangeSchema
}).strict();
export type PronunciationAnnotation = z.infer<typeof PronunciationAnnotationSchema>;

const NodeBaseSchema = z.object({
  ordinal: z.number().int().positive(),
  range: SourceRangeSchema
});

export const SpeechNodeSchema = NodeBaseSchema.extend({
  type: z.literal("speech"),
  speakerId: SpeakerIdSchema,
  rawText: z.string().min(1),
  readableText: z.string().min(1),
  annotations: z.array(PronunciationAnnotationSchema)
}).strict();

export const PauseNodeSchema = NodeBaseSchema.extend({
  type: z.literal("pause"),
  pauseId: z.string().regex(/^pause_[A-Za-z0-9_-]*$/u)
}).strict();

export const SectionNodeSchema = NodeBaseSchema.extend({
  type: z.literal("section"),
  title: z.string().min(1)
}).strict();

export const ParagraphBreakNodeSchema = NodeBaseSchema.extend({
  type: z.literal("paragraphBreak"),
  lineCount: z.number().int().positive()
}).strict();

export const CirNodeSchema = z.discriminatedUnion("type", [
  SpeechNodeSchema,
  PauseNodeSchema,
  SectionNodeSchema,
  ParagraphBreakNodeSchema
]);
export type CirNode = z.infer<typeof CirNodeSchema>;

export const DiagnosticSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  message: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  offendingText: z.string(),
  ignorePattern: z.string().min(1),
  suggestion: z.string().min(1)
}).strict();
export type ParseDiagnostic = z.infer<typeof DiagnosticSchema>;

const DiscoveryOccurrenceSchema = z.object({
  range: SourceRangeSchema
}).strict();

const NamedDiscoverySchema = z.object({
  id: z.string().min(1),
  occurrences: z.array(DiscoveryOccurrenceSchema).min(1)
}).strict();

const SectionDiscoverySchema = z.object({
  title: z.string().min(1),
  occurrences: z.array(DiscoveryOccurrenceSchema).min(1)
}).strict();

export const PronunciationDiscoverySchema = PronunciationAnnotationSchema.extend({
  nodeOrdinal: z.number().int().positive()
}).strict();

export const ParseScriptResultSchema = z.object({
  grammarVersion: z.literal(SCRIPT_GRAMMAR_VERSION),
  cirSchemaVersion: z.literal(CIR_SCHEMA_VERSION),
  source: z.string(),
  nodes: z.array(CirNodeSchema),
  discoveries: z.object({
    speakers: z.array(NamedDiscoverySchema),
    pauses: z.array(NamedDiscoverySchema),
    sections: z.array(SectionDiscoverySchema),
    pronunciations: z.array(PronunciationDiscoverySchema)
  }).strict(),
  summary: z.object({
    speakerCount: z.number().int().nonnegative(),
    pauseIdCount: z.number().int().nonnegative(),
    sectionCount: z.number().int().nonnegative(),
    speechSegmentCount: z.number().int().nonnegative(),
    explicitPauseSegmentCount: z.number().int().nonnegative(),
    pronunciationAnnotationCount: z.number().int().nonnegative(),
    paragraphBreakCount: z.number().int().nonnegative(),
    characterCount: z.number().int().nonnegative()
  }).strict(),
  errors: z.array(DiagnosticSchema),
  warnings: z.array(DiagnosticSchema)
}).strict();
export type ParseScriptResult = z.infer<typeof ParseScriptResultSchema>;
