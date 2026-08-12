import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LexiconEntrySchema,
  TransformScriptResultSchema,
  parseScript,
  transformScript,
  type LexiconEntry
} from "./index.js";

const timestamp = "2026-08-11T00:00:00.000Z";

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

describe("G03 lexicon transformation", () => {
  it("transforms the canonical fixture while preserving its readable transcript and source", () => {
    const source = readFileSync(resolve(process.cwd(), "fixtures/gates/study-guide-valid.txt"), "utf8");
    const parsedScript = parseScript({ source });
    const entries = [
      entry({ id: "global-sql", displayText: "SQL", spokenText: "sequel" }),
      entry({ id: "project-resume-cv", scope: "project", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "rez-oo-may" }),
      entry({ id: "project-resume-continue", scope: "project", entryType: "namedSense", displayText: "resume", senseId: "continue", spokenText: "ree-zoom" })
    ];

    const result = transformScript({ parsedScript, entries });

    expect(result.source).toBe(source);
    expect(result.readableTranscript).toContain("word resume.");
    expect(result.readableTranscript).toContain("SQL indexes");
    expect(result.ttsTranscript).toContain("word rez-oo-may.");
    expect(result.ttsTranscript).toContain("job can ree-zoom after");
    expect(result.ttsTranscript.match(/sequel/gu)).toHaveLength(2);
    expect(result.matches.map(({ entryId }) => entryId)).toEqual([
      "project-resume-cv",
      "project-resume-continue",
      "global-sql",
      "global-sql"
    ]);
    expect(result.matches.every((match) => source.slice(match.sourceStartOffset, match.sourceEndOffset) === match.originalText)).toBe(true);
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

  it("resolves named senses before ordinary rules and blocks missing senses", () => {
    const source = "[speaker_teacher] {{resume|cv}} and resume.";
    const ordinary = entry({ id: "ordinary-resume", displayText: "resume", spokenText: "ordinary" });
    const unresolved = transformScript({ parsedScript: parseScript({ source }), entries: [ordinary] });
    expect(unresolved.readableTranscript).toBe("resume and resume.");
    expect(unresolved.ttsTranscript).toBe("resume and ordinary.");
    expect(unresolved.errors).toMatchObject([{ code: "UNRESOLVED_NAMED_SENSE", offendingText: "{{resume|cv}}" }]);
    expect(unresolved.synthesisReady).toBe(false);

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
    const parsedScript = parseScript({ source: "Unassigned speech." });
    const result = transformScript({ parsedScript, entries: [] });
    expect(parsedScript.errors).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.synthesisReady).toBe(false);
  });

  it("validates named-sense fields and rejects empty replacements", () => {
    expect(() => entry({ id: "missing-sense", entryType: "namedSense", displayText: "resume", spokenText: "spoken" })).toThrow();
    expect(() => entry({ id: "term-with-sense", displayText: "resume", senseId: "cv", spokenText: "spoken" })).toThrow();
    expect(() => entry({ id: "empty", displayText: "SQL", spokenText: "   " })).toThrow();
  });
});
