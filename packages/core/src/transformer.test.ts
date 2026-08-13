import { describe, expect, it } from "vitest";
import {
  LexiconEntrySchema,
  TransformScriptResultSchema,
  parseScript,
  transformScript,
  type LexiconEntry
} from "./index.js";

const timestamp = "2026-08-11T00:00:00.000Z";
const studyGuideSource = `[section: Resumes and background processing]

[speaker_teacher] Today we will compare two meanings of the word {{resume|cv}}.
[pause_short]
[speaker_student] That is the document I send with a job application.
[pause_short]
[speaker_teacher] Correct. A paused job can {{resume|continue}} after a restart.
[pause_long]

[section: SQL pronunciation]

[speaker_teacher] SQL indexes can speed up database reads.
[pause_short]
[speaker_student] In this project, SQL is pronounced using the project lexicon.
`;

function entry(overrides: Partial<LexiconEntry> & Pick<LexiconEntry, "id" | "displayText" | "spokenText">): LexiconEntry {
  return LexiconEntrySchema.parse({
    scope: "global",
    entryType: "exactTerm",
    caseSensitive: true,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

function transform(source: string, entries: LexiconEntry[], defaultSpeakerId = "narrator") {
  return transformScript({ parsedScript: parseScript({ source, defaultSpeakerId }), entries });
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

describe("lexicon transformation", () => {
  it("transforms a representative study guide while preserving its readable transcript and source", () => {
    const parsedScript = parseScript({ source: studyGuideSource });
    const entries = [
      entry({ id: "global-sql", displayText: "SQL", spokenText: "sequel" }),
      entry({ id: "project-resume-cv", scope: "project", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "rez-oo-may" }),
      entry({ id: "project-resume-continue", scope: "project", entryType: "namedSense", displayText: "resume", senseId: "continue", spokenText: "ree-zoom" })
    ];

    const result = transformScript({ parsedScript, entries });

    expect(result.source).toBe(studyGuideSource);
    expect(result.readableTranscript).toBe("Today we will compare two meanings of the word resume.\nThat is the document I send with a job application.\nCorrect. A paused job can resume after a restart.\nSQL indexes can speed up database reads.\nIn this project, SQL is pronounced using the project lexicon.");
    expect(result.ttsTranscript).toBe("Today we will compare two meanings of the word rez-oo-may.\nThat is the document I send with a job application.\nCorrect. A paused job can ree-zoom after a restart.\nsequel indexes can speed up database reads.\nIn this project, sequel is pronounced using the project lexicon.");
    expect(result.matches.map((match) => ({
      entryId: match.entryId,
      originalText: match.originalText,
      replacement: match.replacement,
      nodeOrdinal: match.nodeOrdinal,
      sourceStartOffset: match.sourceStartOffset,
      sourceEndOffset: match.sourceEndOffset,
      line: match.range.start.line,
      column: match.range.start.column
    }))).toEqual([
      { entryId: "project-resume-cv", originalText: "resume", replacement: "rez-oo-may", nodeOrdinal: 3, sourceStartOffset: 113, sourceEndOffset: 119, line: 3, column: 68 },
      { entryId: "project-resume-continue", originalText: "resume", replacement: "ree-zoom", nodeOrdinal: 7, sourceStartOffset: 270, sourceEndOffset: 276, line: 7, column: 47 },
      { entryId: "global-sql", originalText: "SQL", replacement: "sequel", nodeOrdinal: 12, sourceStartOffset: 367, sourceEndOffset: 370, line: 12, column: 19 },
      { entryId: "global-sql", originalText: "SQL", replacement: "sequel", nodeOrdinal: 14, sourceStartOffset: 457, sourceEndOffset: 460, line: 14, column: 36 }
    ]);
    expect(result.matches.every((match) => studyGuideSource.slice(match.sourceStartOffset, match.sourceEndOffset) === match.originalText)).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.synthesisReady).toBe(true);
    expect(TransformScriptResultSchema.parse(result)).toEqual(result);
  });

  it("applies whole-word and case-sensitive rules exactly", () => {
    const result = transform("SQL SQLish sql SQL", [
      entry({ id: "sql", displayText: "SQL", spokenText: "sequel" })
    ]);
    expect(result.ttsTranscript).toBe("sequel SQLish sql sequel");

    const insensitive = transform("SQL sql Sql", [
      entry({ id: "sql", displayText: "SQL", spokenText: "sequel", caseSensitive: false })
    ]);
    expect(insensitive.ttsTranscript).toBe("sequel sequel sequel");
  });

  it("uses the required scope and entry-type precedence", () => {
    const sameTerm = transform("SQL", [
      entry({ id: "global", displayText: "SQL", spokenText: "global" }),
      entry({ id: "project", scope: "project", displayText: "SQL", spokenText: "project" })
    ]);
    expect(sameTerm.ttsTranscript).toBe("project");

    const phraseBeforeTerm = transform("data base", [
      entry({ id: "project-term", scope: "project", displayText: "data", spokenText: "term", wholeWord: false }),
      entry({ id: "global-phrase", entryType: "exactPhrase", displayText: "data base", spokenText: "phrase" })
    ]);
    expect(phraseBeforeTerm.ttsTranscript).toBe("phrase");
  });

  it("breaks same-level ties by priority, length, and stable ID", () => {
    const priority = transform("database", [
      entry({ id: "long", displayText: "database", spokenText: "long", wholeWord: false, priority: 1 }),
      entry({ id: "short", displayText: "data", spokenText: "high", wholeWord: false, priority: 2 })
    ]);
    expect(priority.ttsTranscript).toBe("highbase");

    const length = transform("database", [
      entry({ id: "short", displayText: "data", spokenText: "short", wholeWord: false }),
      entry({ id: "long", displayText: "database", spokenText: "long", wholeWord: false })
    ]);
    expect(length.ttsTranscript).toBe("long");

    const stableId = transform("SQL", [
      entry({ id: "b-entry", displayText: "SQL", spokenText: "bee" }),
      entry({ id: "a-entry", displayText: "SQL", spokenText: "aye" })
    ]);
    expect(stableId.ttsTranscript).toBe("aye");
    expect(stableId.warnings[0]?.code).toBe("LEXICON_MATCH_CONFLICT");
  });

  it("resolves named senses before ordinary rules and preserves missing senses literally", () => {
    const source = "[speaker_teacher] {{resume|cv}} and resume.";
    const ordinary = entry({ id: "ordinary-resume", displayText: "resume", spokenText: "ordinary" });
    const unresolved = transformScript({ parsedScript: parseScript({ source }), entries: [ordinary] });
    expect(unresolved.readableTranscript).toBe("{{resume|cv}} and resume.");
    expect(unresolved.ttsTranscript).toBe("{{resume|cv}} and ordinary.");
    expect(unresolved.errors).toEqual([]);
    expect(unresolved.warnings).toMatchObject([{
      code: "UNRESOLVED_NAMED_SENSE",
      offendingText: "{{resume|cv}}",
      ignorePattern: "{{resume|cv}}",
      sourceStartOffset: source.indexOf("{{resume|cv}}"),
      sourceEndOffset: source.indexOf("{{resume|cv}}") + "{{resume|cv}}".length
    }]);
    expect(unresolved.synthesisReady).toBe(true);

    const ignored = transformScript({
      parsedScript: parseScript({ source }),
      entries: [ordinary],
      ignoredDiagnostics: [{ code: "UNRESOLVED_NAMED_SENSE", pattern: "{{resume|cv}}" }]
    });
    expect(ignored.warnings).toEqual([]);
    expect(ignored.readableTranscript).toBe(unresolved.readableTranscript);
    expect(ignored.ttsTranscript).toBe(unresolved.ttsTranscript);
    expect(ignored.synthesisReady).toBe(true);

    const resolved = transformScript({
      parsedScript: parseScript({ source }),
      entries: [
        ordinary,
        entry({ id: "global-cv", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "global-cv" }),
        entry({ id: "project-cv", scope: "project", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "project-cv" })
      ]
    });
    expect(resolved.ttsTranscript).toBe("project-cv and ordinary.");
    expect(resolved.matches.map(({ entryId }) => entryId)).toEqual(["project-cv", "ordinary-resume"]);
  });

  it("uses the literal fallback for every ineligible named-sense entry", () => {
    const source = "[speaker_teacher] {{resume|cv}} {{Resume|cv}} {{resume|missing}}";
    const result = transformScript({
      parsedScript: parseScript({ source }),
      entries: [
        entry({ id: "disabled", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "disabled", enabled: false }),
        entry({ id: "empty", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "   " }),
        entry({ id: "case-mismatch", entryType: "namedSense", displayText: "RESUME", senseId: "cv", spokenText: "wrong case" })
      ]
    });
    expect(result.readableTranscript).toBe("{{resume|cv}} {{Resume|cv}} {{resume|missing}}");
    expect(result.ttsTranscript).toBe(result.readableTranscript);
    expect(result.matches).toEqual([]);
    expect(result.warnings).toHaveLength(3);
    expect(result.synthesisReady).toBe(true);
  });

  it("suppresses repeated transformation warnings by exact code and pattern", () => {
    const source = "[speaker_teacher] {{resume|cv}} and {{resume|cv}}.";
    const ignored = transformScript({
      parsedScript: parseScript({ source }),
      entries: [],
      ignoredDiagnostics: [{ code: "UNRESOLVED_NAMED_SENSE", pattern: "{{resume|cv}}" }]
    });
    expect(ignored.warnings).toEqual([]);
    expect(ignored.ttsTranscript).toBe("{{resume|cv}} and {{resume|cv}}.");

    const conflict = transformScript({
      parsedScript: parseScript({ source: "[speaker_teacher] SQL" }),
      entries: [
        entry({ id: "b-entry", displayText: "SQL", spokenText: "bee" }),
        entry({ id: "a-entry", displayText: "SQL", spokenText: "aye" })
      ],
      ignoredDiagnostics: [{ code: "LEXICON_MATCH_CONFLICT", pattern: "SQL" }]
    });
    expect(conflict.warnings).toEqual([]);
    expect(conflict.ttsTranscript).toBe("aye");
  });

  it("never applies ordinary replacement to directives or metadata", () => {
    const source = "[section: SQL]\n[speaker_SQL] Spoken SQL.\n[pause_SQL]";
    const result = transform(source, [entry({ id: "sql", displayText: "SQL", spokenText: "sequel" })]);
    expect(result.readableTranscript).toBe("Spoken SQL.");
    expect(result.ttsTranscript).toBe("Spoken sequel.");
    expect(result.matches).toHaveLength(1);
  });

  it("produces deterministic non-overlapping audits with exact UTF-16 source offsets", () => {
    const source = "[speaker_teacher] SQL 😀 SQLish SQL";
    const parsedScript = parseScript({ source });
    const entries = [entry({ id: "sql", displayText: "SQL", spokenText: "sequel" })];
    const first = transformScript({ parsedScript, entries });
    const second = transformScript({ parsedScript, entries });
    expect(second).toEqual(first);
    expect(first.matches.map(({ sourceStartOffset, sourceEndOffset }) => [sourceStartOffset, sourceEndOffset])).toEqual([
      [source.indexOf("SQL"), source.indexOf("SQL") + 3],
      [source.lastIndexOf("SQL"), source.lastIndexOf("SQL") + 3]
    ]);
    expect(first.matches.map(({ range }) => range.start.column)).toEqual([19, 33]);
  });

  it("does not mutate a deeply frozen parse result or lexicon entries", () => {
    const parsedScript = parseScript({ source: "[speaker_teacher] SQL" });
    const entries = [entry({ id: "sql", displayText: "SQL", spokenText: "sequel" })];
    const before = JSON.stringify({ parsedScript, entries });
    deepFreeze(parsedScript);
    deepFreeze(entries);
    expect(transformScript({ parsedScript, entries }).ttsTranscript).toBe("sequel");
    expect(JSON.stringify({ parsedScript, entries })).toBe(before);
  });

  it("keeps parser failures blocking even when lexicon transformation itself succeeds", () => {
    const parsedScript = parseScript({ source: "[section Missing colon]" });
    const result = transformScript({ parsedScript, entries: [] });
    expect(parsedScript.errors).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.synthesisReady).toBe(false);
  });

  it("transforms a bare script under the system narrator", () => {
    const source = "SQL introduction.\n\nContinue {{resume|process}}.";
    const parsedScript = parseScript({ source });
    const result = transformScript({
      parsedScript,
      entries: [
        entry({ id: "sql", displayText: "SQL", spokenText: "sequel" }),
        entry({ id: "resume-process", entryType: "namedSense", displayText: "resume", senseId: "process", spokenText: "ree-zoom" })
      ]
    });

    expect(parsedScript.errors).toEqual([]);
    expect(result.segments.map(({ speakerId }) => speakerId)).toEqual(["narrator", "narrator"]);
    expect(result.readableTranscript).toBe("SQL introduction.\nContinue resume.");
    expect(result.ttsTranscript).toBe("sequel introduction.\nContinue ree-zoom.");
    expect(result.synthesisReady).toBe(true);
  });

  it("validates named-sense fields and ignores empty replacements", () => {
    expect(() => entry({ id: "missing-sense", entryType: "namedSense", displayText: "resume", spokenText: "spoken" })).toThrow();
    expect(() => entry({ id: "term-with-sense", displayText: "resume", senseId: "cv", spokenText: "spoken" })).toThrow();
    const result = transform("SQL", [entry({ id: "empty", displayText: "SQL", spokenText: "   " })]);
    expect(result.ttsTranscript).toBe("SQL");
    expect(result.matches).toEqual([]);
  });
});
