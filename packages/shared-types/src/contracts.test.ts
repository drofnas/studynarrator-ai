import { describe, expect, it } from "vitest";
import {
  CIR_SCHEMA_VERSION,
  DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
  DEFAULT_PARAGRAPH_PAUSE_ID,
  IgnoredDiagnosticSchema,
  LEXICON_TRANSFORM_VERSION,
  LexiconEntrySchema,
  PARAGRAPH_PACING_VERSION,
  PauseIdSchema,
  SCRIPT_GRAMMAR_VERSION,
  ScriptPromptKindSchema,
  SourceRangeSchema,
  SpeakerIdSchema,
  SupportedPauseIdSchema,
  SUPPORTED_PAUSE_IDS,
} from "./contracts.js";

const validLexiconEntry = {
  id: "global-sql",
  scope: "global",
  entryType: "exactTerm",
  displayText: "SQL",
  spokenText: "sequel",
  caseSensitive: true,
  wholeWord: true,
  priority: 0,
  enabled: true,
  notes: "",
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

describe("dependency-free transport contracts", () => {
  it("preserves schema versions and paragraph pause defaults", () => {
    expect({
      scriptGrammar: SCRIPT_GRAMMAR_VERSION,
      cirSchema: CIR_SCHEMA_VERSION,
      lexiconTransform: LEXICON_TRANSFORM_VERSION,
      paragraphPacing: PARAGRAPH_PACING_VERSION,
      defaultPauseId: DEFAULT_PARAGRAPH_PAUSE_ID,
      defaultPauseDurationMs: DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
    }).toEqual({
      scriptGrammar: 1,
      cirSchema: 1,
      lexiconTransform: 1,
      paragraphPacing: 1,
      defaultPauseId: "pause_medium",
      defaultPauseDurationMs: 750,
    });
  });

  it("enforces speaker and pause identifier boundaries", () => {
    expect(SpeakerIdSchema.parse("Teacher_01")).toBe("Teacher_01");
    expect(SpeakerIdSchema.safeParse("_teacher").success).toBe(false);
    expect(SpeakerIdSchema.safeParse("teacher name").success).toBe(false);

    expect(PauseIdSchema.parse("pause_announcement-01")).toBe(
      "pause_announcement-01",
    );
    expect(PauseIdSchema.parse("pause_")).toBe("pause_");
    expect(PauseIdSchema.safeParse("announcement").success).toBe(false);
    expect(SUPPORTED_PAUSE_IDS).toEqual([
      "pause_short",
      "pause_medium",
      "pause_long",
    ]);
    expect(SupportedPauseIdSchema.parse("pause_medium")).toBe("pause_medium");
    expect(SupportedPauseIdSchema.safeParse("pause_custom").success).toBe(
      false,
    );
  });

  it("keeps ignored diagnostics strict and constrained", () => {
    expect(
      IgnoredDiagnosticSchema.parse({
        code: "UNKNOWN_DIRECTIVE",
        pattern: "legacy directive",
      }),
    ).toEqual({ code: "UNKNOWN_DIRECTIVE", pattern: "legacy directive" });
    expect(
      IgnoredDiagnosticSchema.safeParse({
        code: "unknown_directive",
        pattern: "legacy directive",
      }).success,
    ).toBe(false);
    expect(
      IgnoredDiagnosticSchema.safeParse({
        code: "UNKNOWN_DIRECTIVE",
        pattern: "",
      }).success,
    ).toBe(false);
    expect(
      IgnoredDiagnosticSchema.safeParse({
        code: "UNKNOWN_DIRECTIVE",
        pattern: "legacy directive",
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("keeps source ranges positive, integral, and strict", () => {
    const sourceRange = {
      start: { line: 1, column: 1 },
      end: { line: 2, column: 4 },
    };
    expect(SourceRangeSchema.parse(sourceRange)).toEqual(sourceRange);
    expect(
      SourceRangeSchema.safeParse({
        ...sourceRange,
        start: { line: 0, column: 1 },
      }).success,
    ).toBe(false);
    expect(
      SourceRangeSchema.safeParse({
        ...sourceRange,
        end: { line: 2, column: 1.5 },
      }).success,
    ).toBe(false);
    expect(
      SourceRangeSchema.safeParse({
        ...sourceRange,
        start: { ...sourceRange.start, offset: 0 },
      }).success,
    ).toBe(false);
  });

  it("preserves lexicon entry strictness and named-sense refinements", () => {
    expect(LexiconEntrySchema.parse(validLexiconEntry)).toEqual(
      validLexiconEntry,
    );
    expect(
      LexiconEntrySchema.parse({ ...validLexiconEntry, spokenText: "" })
        .spokenText,
    ).toBe("");
    expect(
      LexiconEntrySchema.safeParse({
        ...validLexiconEntry,
        entryType: "namedSense",
      }).success,
    ).toBe(false);
    expect(
      LexiconEntrySchema.safeParse({
        ...validLexiconEntry,
        senseId: "sql",
      }).success,
    ).toBe(false);
    expect(
      LexiconEntrySchema.safeParse({
        ...validLexiconEntry,
        entryType: "namedSense",
        senseId: "sql!",
      }).success,
    ).toBe(false);
    expect(
      LexiconEntrySchema.safeParse({
        ...validLexiconEntry,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("accepts only creation and update script prompt kinds", () => {
    expect(ScriptPromptKindSchema.options).toEqual(["creation", "update"]);
    expect(ScriptPromptKindSchema.parse("creation")).toBe("creation");
    expect(ScriptPromptKindSchema.parse("update")).toBe("update");
    expect(ScriptPromptKindSchema.safeParse("rewrite").success).toBe(false);
  });
});
