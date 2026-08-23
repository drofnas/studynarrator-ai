import { z } from "zod";

export const SCRIPT_GRAMMAR_VERSION = 1;
export const CIR_SCHEMA_VERSION = 1;
export const LEXICON_TRANSFORM_VERSION = 1;
export const PARAGRAPH_PACING_VERSION = 1;
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

export const IgnoredDiagnosticSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    pattern: z.string().min(1),
  })
  .strict();

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

const LexiconScopeSchema = z.enum(["global", "project"]);
const LexiconEntryTypeSchema = z.enum([
  "exactTerm",
  "exactPhrase",
  "namedSense",
]);

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

export const ScriptPromptKindSchema = z.enum(["creation", "update"]);
export type ScriptPromptKind = z.infer<typeof ScriptPromptKindSchema>;
