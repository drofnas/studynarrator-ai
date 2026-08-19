import { z } from "zod";

export const SCRIPT_GRAMMAR_VERSION = 1;
export const CIR_SCHEMA_VERSION = 1;
export const LEXICON_TRANSFORM_VERSION = 1;
export const PARAGRAPH_PACING_VERSION = 1;
export const SYSTEM_DEFAULT_SPEAKER_ID = "narrator";
export const DEFAULT_PARAGRAPH_PAUSE_ID = "pause_medium";
export const DEFAULT_PARAGRAPH_PAUSE_DURATION_MS = 750;
export const SUPPORTED_PAUSE_IDS = [
  "pause_short",
  "pause_medium",
  "pause_long",
] as const;

export const SpeakerIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
export const PauseIdSchema = z.string().regex(/^pause_[A-Za-z0-9_-]*$/u);
export const SupportedPauseIdSchema = z.enum(SUPPORTED_PAUSE_IDS);
export type SupportedPauseId = z.infer<typeof SupportedPauseIdSchema>;

export const IgnoredDiagnosticSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    pattern: z.string().min(1),
  })
  .strict();
export type IgnoredDiagnostic = z.infer<typeof IgnoredDiagnosticSchema>;

export const ParseScriptInputSchema = z
  .object({
    source: z.string(),
    defaultSpeakerId: SpeakerIdSchema.optional(),
    ignoredDiagnostics: z.array(IgnoredDiagnosticSchema).optional(),
  })
  .strict();
export type ParseScriptInput = z.infer<typeof ParseScriptInputSchema>;

const SourcePositionSchema = z
  .object({
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  })
  .strict();

export const SourceRangeSchema = z
  .object({
    start: SourcePositionSchema,
    end: SourcePositionSchema,
  })
  .strict();
export type SourceRange = z.infer<typeof SourceRangeSchema>;

const PronunciationAnnotationSchema = z
  .object({
    displayText: z.string().min(1),
    senseId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    rawText: z.string().min(1),
    range: SourceRangeSchema,
  })
  .strict();
export type PronunciationAnnotation = z.infer<
  typeof PronunciationAnnotationSchema
>;

const NodeBaseSchema = z.object({
  ordinal: z.number().int().positive(),
  range: SourceRangeSchema,
});

const SpeechNodeSchema = NodeBaseSchema.extend({
  type: z.literal("speech"),
  speakerId: SpeakerIdSchema,
  rawText: z.string().min(1),
  readableText: z.string().min(1),
  annotations: z.array(PronunciationAnnotationSchema),
}).strict();

const PauseNodeSchema = NodeBaseSchema.extend({
  type: z.literal("pause"),
  pauseId: PauseIdSchema,
}).strict();

const SectionNodeSchema = NodeBaseSchema.extend({
  type: z.literal("section"),
  title: z.string().min(1),
}).strict();

const ParagraphBreakNodeSchema = NodeBaseSchema.extend({
  type: z.literal("paragraphBreak"),
  lineCount: z.number().int().positive(),
}).strict();

const CirNodeSchema = z.discriminatedUnion("type", [
  SpeechNodeSchema,
  PauseNodeSchema,
  SectionNodeSchema,
  ParagraphBreakNodeSchema,
]);
export type CirNode = z.infer<typeof CirNodeSchema>;

const DiagnosticSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    message: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    offendingText: z.string(),
    ignorePattern: z.string().min(1),
    suggestion: z.string().min(1),
  })
  .strict();
export type ParseDiagnostic = z.infer<typeof DiagnosticSchema>;

const DiscoveryOccurrenceSchema = z
  .object({
    range: SourceRangeSchema,
  })
  .strict();

const NamedDiscoverySchema = z
  .object({
    id: z.string().min(1),
    occurrences: z.array(DiscoveryOccurrenceSchema).min(1),
  })
  .strict();

const SectionDiscoverySchema = z
  .object({
    title: z.string().min(1),
    occurrences: z.array(DiscoveryOccurrenceSchema).min(1),
  })
  .strict();

const PronunciationDiscoverySchema = PronunciationAnnotationSchema.extend({
  nodeOrdinal: z.number().int().positive(),
}).strict();

export const ParseScriptResultSchema = z
  .object({
    grammarVersion: z.literal(SCRIPT_GRAMMAR_VERSION),
    cirSchemaVersion: z.literal(CIR_SCHEMA_VERSION),
    source: z.string(),
    nodes: z.array(CirNodeSchema),
    discoveries: z
      .object({
        speakers: z.array(NamedDiscoverySchema),
        pauses: z.array(NamedDiscoverySchema),
        sections: z.array(SectionDiscoverySchema),
        pronunciations: z.array(PronunciationDiscoverySchema),
      })
      .strict(),
    summary: z
      .object({
        speakerCount: z.number().int().nonnegative(),
        pauseIdCount: z.number().int().nonnegative(),
        sectionCount: z.number().int().nonnegative(),
        speechSegmentCount: z.number().int().nonnegative(),
        explicitPauseSegmentCount: z.number().int().nonnegative(),
        pronunciationAnnotationCount: z.number().int().nonnegative(),
        paragraphBreakCount: z.number().int().nonnegative(),
        characterCount: z.number().int().nonnegative(),
      })
      .strict(),
    errors: z.array(DiagnosticSchema),
    warnings: z.array(DiagnosticSchema),
  })
  .strict();
export type ParseScriptResult = z.infer<typeof ParseScriptResultSchema>;

export const ParagraphPauseConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    pauseId: PauseIdSchema,
    durationMs: z.number().int().min(0).max(30_000),
  })
  .strict();
export type ParagraphPauseConfiguration = z.infer<
  typeof ParagraphPauseConfigurationSchema
>;

export const ResolveParagraphPausesInputSchema = z
  .object({
    parsedScript: ParseScriptResultSchema,
    configuration: ParagraphPauseConfigurationSchema,
  })
  .strict();
export type ResolveParagraphPausesInput = z.infer<
  typeof ResolveParagraphPausesInputSchema
>;

const ParagraphBreakAuditSchema = z
  .object({
    nodeOrdinal: z.number().int().positive(),
    range: SourceRangeSchema,
  })
  .strict();

const ResolvedParagraphPauseAuditSchema = z
  .object({
    status: z.enum(["applied", "suppressedByExplicitPause"]),
    pauseId: PauseIdSchema,
    durationMs: z.number().int().min(0).max(30_000),
    previousSpeechNodeOrdinal: z.number().int().positive(),
    nextSpeechNodeOrdinal: z.number().int().positive(),
    paragraphBreaks: z.array(ParagraphBreakAuditSchema).min(1),
    explicitPauseNodeOrdinals: z.array(z.number().int().positive()),
  })
  .strict()
  .superRefine((audit, context) => {
    if (
      audit.status === "applied" &&
      audit.explicitPauseNodeOrdinals.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Applied paragraph pauses cannot cite an explicit pause.",
        path: ["explicitPauseNodeOrdinals"],
      });
    }
    if (
      audit.status === "suppressedByExplicitPause" &&
      audit.explicitPauseNodeOrdinals.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Suppressed paragraph pauses must cite an explicit pause.",
        path: ["explicitPauseNodeOrdinals"],
      });
    }
  });
export type ResolvedParagraphPauseAudit = z.infer<
  typeof ResolvedParagraphPauseAuditSchema
>;

export const ResolveParagraphPausesResultSchema = z
  .object({
    pacingVersion: z.literal(PARAGRAPH_PACING_VERSION),
    configuration: ParagraphPauseConfigurationSchema,
    audits: z.array(ResolvedParagraphPauseAuditSchema),
  })
  .strict();
export type ResolveParagraphPausesResult = z.infer<
  typeof ResolveParagraphPausesResultSchema
>;

const LexiconScopeSchema = z.enum(["global", "project"]);
const LexiconEntryTypeSchema = z.enum([
  "exactTerm",
  "exactPhrase",
  "namedSense",
]);

export const LexiconEntryAuthoringSchema = z
  .object({
    id: z.string().min(1).optional(),
    scope: LexiconScopeSchema,
    entryType: LexiconEntryTypeSchema,
    displayText: z.string().min(1),
    senseId: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/u)
      .optional(),
    spokenText: z.string(),
    caseSensitive: z.boolean().default(true),
    wholeWord: z.boolean().default(true),
    priority: z.number().int().default(0),
    enabled: z.boolean().default(true),
    notes: z.string().default(""),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.entryType === "namedSense" && !entry.senseId) {
      context.addIssue({
        code: "custom",
        message: "Named-sense entries require a sense ID.",
        path: ["senseId"],
      });
    }
    if (entry.entryType !== "namedSense" && entry.senseId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only named-sense entries may define a sense ID.",
        path: ["senseId"],
      });
    }
  });
export type LexiconEntryAuthoring = z.infer<typeof LexiconEntryAuthoringSchema>;

export const LexiconEntryAuthoringCollectionSchema = z
  .array(LexiconEntryAuthoringSchema)
  .superRefine((entries, context) => {
    const seenIds = new Set<string>();
    entries.forEach((entry, index) => {
      if (!entry.id) return;
      if (seenIds.has(entry.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate lexicon entry ID: ${entry.id}.`,
          path: [index, "id"],
        });
      }
      seenIds.add(entry.id);
    });
  });

export const LexiconEntrySchema = z
  .object({
    id: z.string().min(1),
    scope: LexiconScopeSchema,
    entryType: LexiconEntryTypeSchema,
    displayText: z.string().min(1),
    senseId: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/u)
      .optional(),
    spokenText: z.string(),
    caseSensitive: z.boolean(),
    wholeWord: z.boolean(),
    priority: z.number().int(),
    enabled: z.boolean(),
    notes: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.entryType === "namedSense" && !entry.senseId) {
      context.addIssue({
        code: "custom",
        message: "Named-sense entries require a sense ID.",
        path: ["senseId"],
      });
    }
    if (entry.entryType !== "namedSense" && entry.senseId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only named-sense entries may define a sense ID.",
        path: ["senseId"],
      });
    }
  });
export type LexiconEntry = z.infer<typeof LexiconEntrySchema>;

export const TransformScriptInputSchema = z
  .object({
    parsedScript: ParseScriptResultSchema,
    entries: z.array(LexiconEntrySchema),
    ignoredDiagnostics: z.array(IgnoredDiagnosticSchema).optional(),
  })
  .strict();
export type TransformScriptInput = z.infer<typeof TransformScriptInputSchema>;

const TransformDiagnosticSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    message: z.string().min(1),
    nodeOrdinal: z.number().int().positive(),
    range: SourceRangeSchema,
    sourceStartOffset: z.number().int().nonnegative(),
    sourceEndOffset: z.number().int().nonnegative(),
    offendingText: z.string().min(1),
    ignorePattern: z.string().min(1),
    suggestion: z.string().min(1),
  })
  .strict();
export type TransformDiagnostic = z.infer<typeof TransformDiagnosticSchema>;

const LexiconMatchAuditSchema = z
  .object({
    entryId: z.string().min(1),
    scope: LexiconScopeSchema,
    entryType: LexiconEntryTypeSchema,
    displayText: z.string().min(1),
    senseId: z.string().optional(),
    originalText: z.string().min(1),
    replacement: z.string().min(1),
    nodeOrdinal: z.number().int().positive(),
    range: SourceRangeSchema,
    sourceStartOffset: z.number().int().nonnegative(),
    sourceEndOffset: z.number().int().positive(),
  })
  .strict();
export type LexiconMatchAudit = z.infer<typeof LexiconMatchAuditSchema>;

const TransformedSpeechSegmentSchema = z
  .object({
    nodeOrdinal: z.number().int().positive(),
    speakerId: SpeakerIdSchema,
    sourceRange: SourceRangeSchema,
    readableText: z.string().min(1),
    ttsText: z.string().min(1),
    matches: z.array(LexiconMatchAuditSchema),
  })
  .strict();

export const TransformScriptResultSchema = z
  .object({
    transformVersion: z.literal(LEXICON_TRANSFORM_VERSION),
    source: z.string(),
    segments: z.array(TransformedSpeechSegmentSchema),
    readableTranscript: z.string(),
    ttsTranscript: z.string(),
    matches: z.array(LexiconMatchAuditSchema),
    errors: z.array(TransformDiagnosticSchema),
    warnings: z.array(TransformDiagnosticSchema),
    synthesisReady: z.boolean(),
  })
  .strict();
export type TransformScriptResult = z.infer<typeof TransformScriptResultSchema>;
