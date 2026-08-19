import { z } from "zod";
import {
  ParseScriptResultSchema,
  PauseIdSchema,
  ResolveParagraphPausesResultSchema,
  SourceRangeSchema,
  SpeakerIdSchema,
  TransformScriptResultSchema,
  type ParseScriptResult,
  type ResolveParagraphPausesResult,
  type TransformScriptResult,
} from "./schemas.js";

const AUTHORING_SCHEMA_VERSION = 1;

const AuthoringSpeakerConfigurationSchema = z
  .object({
    speakerId: SpeakerIdSchema,
    displayName: z.string().trim().min(1).max(200),
    voiceId: z.string().max(500).nullable(),
    speed: z.number().positive().max(4),
    gainDb: z.number().min(-60).max(24),
    roleDescription: z.string().max(5_000),
    sampleText: z.string().max(5_000),
  })
  .strict();
export type AuthoringSpeakerConfiguration = z.infer<
  typeof AuthoringSpeakerConfigurationSchema
>;

const AuthoringPauseConfigurationSchema = z
  .object({
    pauseId: PauseIdSchema,
    durationMs: z.number().int().min(0).max(30_000),
    description: z.string().max(500),
  })
  .strict();
export type AuthoringPauseConfiguration = z.infer<
  typeof AuthoringPauseConfigurationSchema
>;

const AuthoringSpeakerRowSchema = AuthoringSpeakerConfigurationSchema.extend({
  discovered: z.boolean(),
  occurrenceCount: z.number().int().nonnegative(),
}).strict();
export type AuthoringSpeakerRow = z.infer<typeof AuthoringSpeakerRowSchema>;

const AuthoringPauseRowSchema = z
  .object({
    pauseId: PauseIdSchema,
    durationMs: z.number().int().min(0).max(30_000).nullable(),
    description: z.string().max(500),
    discovered: z.boolean(),
    occurrenceCount: z.number().int().nonnegative(),
  })
  .strict();
export type AuthoringPauseRow = z.infer<typeof AuthoringPauseRowSchema>;

const AuthoringSectionRowSchema = z
  .object({
    title: z.string().min(1),
    sourceLine: z.number().int().positive(),
    speechSegmentCount: z.number().int().nonnegative(),
  })
  .strict();
type AuthoringSectionRow = z.infer<typeof AuthoringSectionRowSchema>;

const ReconciledAuthoringConfigurationSchema = z
  .object({
    schemaVersion: z.literal(AUTHORING_SCHEMA_VERSION),
    speakers: z.array(AuthoringSpeakerRowSchema),
    pauses: z.array(AuthoringPauseRowSchema),
    sections: z.array(AuthoringSectionRowSchema),
  })
  .strict();
type ReconciledAuthoringConfiguration = z.infer<
  typeof ReconciledAuthoringConfigurationSchema
>;

type PauseDurationParseResult =
  | { ok: true; durationMs: number; normalized: string }
  | {
      ok: false;
      code:
        | "EMPTY"
        | "NEGATIVE"
        | "INVALID_FORMAT"
        | "SUB_MILLISECOND_PRECISION"
        | "OUT_OF_RANGE";
      message: string;
    };

export function parsePauseDuration(value: string): PauseDurationParseResult {
  const source = value.trim();
  if (!source)
    return { ok: false, code: "EMPTY", message: "Enter a pause duration." };
  if (source.startsWith("-"))
    return {
      ok: false,
      code: "NEGATIVE",
      message: "Pause duration cannot be negative.",
    };
  if (/^\d+(?:\.\d{4,})\s*s$/iu.test(source)) {
    return {
      ok: false,
      code: "SUB_MILLISECOND_PRECISION",
      message: "Seconds may use at most three decimal places.",
    };
  }
  const match = /^(\d+)(?:\.(\d{1,3}))?\s*(ms|s)?$/iu.exec(source);
  if (!match) {
    return {
      ok: false,
      code: "INVALID_FORMAT",
      message: "Use whole milliseconds or seconds, such as 350 ms or 1.5 s.",
    };
  }
  const whole = Number(match[1]);
  const fraction = match[2];
  const unit = match[3]?.toLowerCase() ?? "ms";
  if (unit === "ms" && fraction !== undefined) {
    return {
      ok: false,
      code: "INVALID_FORMAT",
      message: "Millisecond values must be whole numbers.",
    };
  }
  const durationMs =
    unit === "s"
      ? whole * 1_000 + Number((fraction ?? "").padEnd(3, "0") || "0")
      : whole;
  if (!Number.isSafeInteger(durationMs) || durationMs > 30_000) {
    return {
      ok: false,
      code: "OUT_OF_RANGE",
      message: "Pause duration must be between 0 and 30,000 ms.",
    };
  }
  return { ok: true, durationMs, normalized: `${String(durationMs)} ms` };
}

const starterPauses = new Map<
  string,
  { durationMs: number; description: string }
>([
  [
    "pause_short",
    { durationMs: 350, description: "Brief thinking beat or speaker handoff." },
  ],
  [
    "pause_medium",
    { durationMs: 750, description: "Paragraph or subtopic separation." },
  ],
  [
    "pause_long",
    { durationMs: 1_500, description: "Major subject or section separation." },
  ],
]);

function displayNameForSpeaker(speakerId: string): string {
  return speakerId
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function reconcileDiscoveredConfiguration(input: {
  parseResult: ParseScriptResult;
  speakerMappings: readonly AuthoringSpeakerConfiguration[];
  pausePresets: readonly AuthoringPauseConfiguration[];
}): ReconciledAuthoringConfiguration {
  const parseResult = ParseScriptResultSchema.parse(input.parseResult);
  const existingSpeakers = new Map(
    input.speakerMappings.map((item) => {
      const parsed = AuthoringSpeakerConfigurationSchema.parse(item);
      return [parsed.speakerId, parsed] as const;
    }),
  );
  const existingPauses = new Map(
    input.pausePresets.map((item) => {
      const parsed = AuthoringPauseConfigurationSchema.parse(item);
      return [parsed.pauseId, parsed] as const;
    }),
  );

  const speakers: AuthoringSpeakerRow[] = parseResult.discoveries.speakers.map(
    (discovery) => ({
      ...(existingSpeakers.get(discovery.id) ?? {
        speakerId: discovery.id,
        displayName: displayNameForSpeaker(discovery.id),
        voiceId: null,
        speed: 1,
        gainDb: 0,
        roleDescription: "",
        sampleText: "",
      }),
      discovered: true,
      occurrenceCount: discovery.occurrences.length,
    }),
  );
  const discoveredSpeakers = new Set(
    speakers.map(({ speakerId }) => speakerId),
  );
  for (const speaker of existingSpeakers.values()) {
    if (!discoveredSpeakers.has(speaker.speakerId))
      speakers.push({ ...speaker, discovered: false, occurrenceCount: 0 });
  }

  const pauses: AuthoringPauseRow[] = parseResult.discoveries.pauses.map(
    (discovery) => {
      const existing = existingPauses.get(discovery.id);
      const starter = starterPauses.get(discovery.id);
      return {
        pauseId: discovery.id,
        durationMs: existing?.durationMs ?? starter?.durationMs ?? null,
        description: existing?.description ?? starter?.description ?? "",
        discovered: true,
        occurrenceCount: discovery.occurrences.length,
      };
    },
  );
  const discoveredPauses = new Set(pauses.map(({ pauseId }) => pauseId));
  for (const pause of existingPauses.values()) {
    if (!discoveredPauses.has(pause.pauseId))
      pauses.push({ ...pause, discovered: false, occurrenceCount: 0 });
  }

  const sections: AuthoringSectionRow[] = [];
  let currentSection: AuthoringSectionRow | undefined;
  for (const node of parseResult.nodes) {
    if (node.type === "section") {
      currentSection = {
        title: node.title,
        sourceLine: node.range.start.line,
        speechSegmentCount: 0,
      };
      sections.push(currentSection);
    } else if (node.type === "speech" && currentSection) {
      currentSection.speechSegmentCount += 1;
    }
  }

  return ReconciledAuthoringConfigurationSchema.parse({
    schemaVersion: AUTHORING_SCHEMA_VERSION,
    speakers,
    pauses,
    sections,
  });
}

const AuthoringValidationIssueSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    severity: z.enum(["error", "warning"]),
    message: z.string().min(1),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    target: z
      .object({
        kind: z.enum(["script", "speaker", "pause", "lexicon"]),
        id: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
type AuthoringValidationIssue = z.infer<typeof AuthoringValidationIssueSchema>;

const AuthoringValidationResultSchema = z
  .object({
    schemaVersion: z.literal(AUTHORING_SCHEMA_VERSION),
    status: z.enum(["ready", "readyWithWarnings", "blocked"]),
    issues: z.array(AuthoringValidationIssueSchema),
  })
  .strict();
type AuthoringValidationResult = z.infer<
  typeof AuthoringValidationResultSchema
>;

export function validateAuthoringConfiguration(input: {
  parseResult: ParseScriptResult;
  transformResult: TransformScriptResult;
  speakers: readonly AuthoringSpeakerRow[];
  pauses: readonly AuthoringPauseRow[];
}): AuthoringValidationResult {
  const parseResult = ParseScriptResultSchema.parse(input.parseResult);
  const transformResult = TransformScriptResultSchema.parse(
    input.transformResult,
  );
  const speakers = input.speakers.map((item) =>
    AuthoringSpeakerRowSchema.parse(item),
  );
  const pauses = input.pauses.map((item) =>
    AuthoringPauseRowSchema.parse(item),
  );
  const issues: AuthoringValidationIssue[] = [];
  if (parseResult.summary.speechSegmentCount === 0) {
    issues.push({
      code: "EMPTY_SCRIPT",
      severity: "error",
      message: "Add at least one speech segment before rendering.",
      target: { kind: "script", id: "source" },
    });
  }
  for (const item of parseResult.errors)
    issues.push({
      code: item.code,
      severity: "error",
      message: item.message,
      line: item.line,
      column: item.column,
      target: { kind: "script", id: item.ignorePattern },
    });
  for (const item of parseResult.warnings)
    issues.push({
      code: item.code,
      severity: "warning",
      message: item.message,
      line: item.line,
      column: item.column,
      target: { kind: "script", id: item.ignorePattern },
    });
  for (const item of transformResult.errors)
    issues.push({
      code: item.code,
      severity: "error",
      message: item.message,
      line: item.range.start.line,
      column: item.range.start.column,
      target: { kind: "lexicon", id: item.ignorePattern },
    });
  for (const item of transformResult.warnings)
    issues.push({
      code: item.code,
      severity: "warning",
      message: item.message,
      line: item.range.start.line,
      column: item.range.start.column,
      target: { kind: "lexicon", id: item.ignorePattern },
    });
  for (const speaker of speakers.filter(({ discovered }) => discovered)) {
    if (!speaker.voiceId?.trim())
      issues.push({
        code: "MISSING_VOICE_MAPPING",
        severity: "error",
        message: `Speaker ${speaker.speakerId} needs a voice ID.`,
        target: { kind: "speaker", id: speaker.speakerId },
      });
  }
  for (const pause of pauses.filter(({ discovered }) => discovered)) {
    if (pause.durationMs === null)
      issues.push({
        code: "MISSING_PAUSE_CONFIGURATION",
        severity: "error",
        message: `Pause ${pause.pauseId} needs a duration.`,
        target: { kind: "pause", id: pause.pauseId },
      });
  }
  const hasErrors = issues.some(({ severity }) => severity === "error");
  const status = hasErrors
    ? "blocked"
    : issues.length > 0
      ? "readyWithWarnings"
      : "ready";
  return AuthoringValidationResultSchema.parse({
    schemaVersion: AUTHORING_SCHEMA_VERSION,
    status,
    issues,
  });
}

const DryRunBaseSchema = z.object({
  rowNumber: z.number().int().positive(),
  sourceRange: SourceRangeSchema,
  validationStatus: z.enum(["valid", "error"]),
});

const DryRunSectionRowSchema = DryRunBaseSchema.extend({
  type: z.literal("section"),
  nodeOrdinal: z.number().int().positive(),
  title: z.string().min(1),
}).strict();
const DryRunSpeechRowSchema = DryRunBaseSchema.extend({
  type: z.literal("speech"),
  nodeOrdinal: z.number().int().positive(),
  speakerId: SpeakerIdSchema,
  voiceId: z.string().min(1).nullable(),
  originalText: z.string().min(1),
  readableText: z.string().min(1),
  ttsText: z.string().min(1),
  durationMs: z.null(),
}).strict();
const DryRunPauseRowSchema = DryRunBaseSchema.extend({
  type: z.literal("pause"),
  nodeOrdinal: z.number().int().positive().optional(),
  pauseId: PauseIdSchema,
  origin: z.enum(["explicit", "paragraph"]),
  durationMs: z.number().int().min(0).max(30_000).nullable(),
}).strict();
const DryRunRowSchema = z.discriminatedUnion("type", [
  DryRunSectionRowSchema,
  DryRunSpeechRowSchema,
  DryRunPauseRowSchema,
]);
type DryRunRow = z.infer<typeof DryRunRowSchema>;
type WithoutRowNumber<T> = T extends unknown ? Omit<T, "rowNumber"> : never;
type DryRunRowInput = WithoutRowNumber<DryRunRow>;

export const AuthoringDryRunResultSchema = z
  .object({
    schemaVersion: z.literal(AUTHORING_SCHEMA_VERSION),
    status: z.enum(["ready", "readyWithWarnings", "blocked"]),
    issues: z.array(AuthoringValidationIssueSchema),
    rows: z.array(DryRunRowSchema),
  })
  .strict();
export type AuthoringDryRunResult = z.infer<typeof AuthoringDryRunResultSchema>;

export function buildAuthoringDryRun(input: {
  parseResult: ParseScriptResult;
  pacingResult: ResolveParagraphPausesResult;
  transformResult: TransformScriptResult;
  speakers: readonly AuthoringSpeakerRow[];
  pauses: readonly AuthoringPauseRow[];
}): AuthoringDryRunResult {
  const parseResult = ParseScriptResultSchema.parse(input.parseResult);
  const pacingResult = ResolveParagraphPausesResultSchema.parse(
    input.pacingResult,
  );
  const transformResult = TransformScriptResultSchema.parse(
    input.transformResult,
  );
  const speakers = input.speakers.map((item) =>
    AuthoringSpeakerRowSchema.parse(item),
  );
  const pauses = input.pauses.map((item) =>
    AuthoringPauseRowSchema.parse(item),
  );
  const validation = validateAuthoringConfiguration({
    parseResult,
    transformResult,
    speakers,
    pauses,
  });
  const speakerById = new Map(speakers.map((item) => [item.speakerId, item]));
  const pauseById = new Map(pauses.map((item) => [item.pauseId, item]));
  const transformedByOrdinal = new Map(
    transformResult.segments.map((item) => [item.nodeOrdinal, item]),
  );
  const automaticByParagraphOrdinal = new Map<
    number,
    ResolveParagraphPausesResult["audits"][number]
  >();
  for (const audit of pacingResult.audits) {
    const firstBreak = audit.paragraphBreaks[0];
    if (audit.status === "applied" && firstBreak)
      automaticByParagraphOrdinal.set(firstBreak.nodeOrdinal, audit);
  }

  const rows: DryRunRow[] = [];
  const push = (row: DryRunRowInput) =>
    rows.push({ ...row, rowNumber: rows.length + 1 });
  for (const node of parseResult.nodes) {
    if (node.type === "section") {
      push({
        type: "section",
        nodeOrdinal: node.ordinal,
        title: node.title,
        sourceRange: node.range,
        validationStatus: "valid",
      });
    } else if (node.type === "speech") {
      const speaker = speakerById.get(node.speakerId);
      const transformed = transformedByOrdinal.get(node.ordinal);
      const voiceId = speaker?.voiceId?.trim() || null;
      push({
        type: "speech",
        nodeOrdinal: node.ordinal,
        speakerId: node.speakerId,
        voiceId,
        originalText: node.rawText,
        readableText: transformed?.readableText ?? node.readableText,
        ttsText: transformed?.ttsText ?? node.readableText,
        durationMs: null,
        sourceRange: node.range,
        validationStatus: voiceId ? "valid" : "error",
      });
    } else if (node.type === "pause") {
      const configured = pauseById.get(node.pauseId);
      push({
        type: "pause",
        nodeOrdinal: node.ordinal,
        pauseId: node.pauseId,
        origin: "explicit",
        durationMs: configured?.durationMs ?? null,
        sourceRange: node.range,
        validationStatus:
          configured?.durationMs === null || configured === undefined
            ? "error"
            : "valid",
      });
    } else {
      const automatic = automaticByParagraphOrdinal.get(node.ordinal);
      if (automatic)
        push({
          type: "pause",
          pauseId: automatic.pauseId,
          origin: "paragraph",
          durationMs: automatic.durationMs,
          sourceRange: node.range,
          validationStatus: "valid",
        });
    }
  }
  return AuthoringDryRunResultSchema.parse({
    schemaVersion: AUTHORING_SCHEMA_VERSION,
    status: validation.status,
    issues: validation.issues,
    rows,
  });
}
