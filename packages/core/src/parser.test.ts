import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ParseScriptInputSchema, ParseScriptResultSchema, parseScript } from "./index.js";

const fixture = (name: string) => readFileSync(resolve(process.cwd(), "fixtures/gates", name), "utf8");
const expected = (name: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/gates/expected", name), "utf8"));

function goldenProjection(result: ReturnType<typeof parseScript>) {
  return {
    grammarVersion: result.grammarVersion,
    cirSchemaVersion: result.cirSchemaVersion,
    nodes: result.nodes.map((node) => ({
      ordinal: node.ordinal,
      type: node.type,
      line: node.range.start.line,
      value: node.type === "speech" ? `${node.speakerId}: ${node.readableText}`
        : node.type === "pause" ? node.pauseId
          : node.type === "section" ? node.title
            : String(node.lineCount)
    })),
    speakers: result.discoveries.speakers.map(({ id }) => id),
    pauses: result.discoveries.pauses.map(({ id }) => id),
    sections: result.discoveries.sections.map(({ title }) => title),
    pronunciations: result.discoveries.pronunciations.map(({ displayText, senseId, range }) => `${displayText}|${senseId}@${String(range.start.line)}:${String(range.start.column)}`),
    summary: result.summary,
    errors: result.errors.map(({ code, line, column }) => `${code}@${String(line)}:${String(column)}`),
    warnings: result.warnings.map(({ code, line, column }) => `${code}@${String(line)}:${String(column)}`)
  };
}

describe("G02 script parser", () => {
  it("parses the canonical valid fixture with exact discoveries", () => {
    const result = parseScript({ source: fixture("study-guide-valid.txt") });

    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      speakerCount: 2,
      pauseIdCount: 2,
      sectionCount: 2,
      speechSegmentCount: 5,
      explicitPauseSegmentCount: 4,
      pronunciationAnnotationCount: 2
    });
    expect(result.discoveries.speakers.map(({ id }) => id)).toEqual(["teacher", "student"]);
    expect(result.discoveries.pauses.map(({ id }) => id)).toEqual(["pause_short", "pause_long"]);
    expect(result.nodes.map(({ type }) => type)).toEqual([
      "section", "paragraphBreak", "speech", "pause", "speech", "pause", "speech", "pause",
      "paragraphBreak", "section", "paragraphBreak", "speech", "pause", "speech"
    ]);
    expect(ParseScriptResultSchema.parse(result)).toEqual(result);
  });

  it("returns stable errors while preserving recoverable invalid fixture lines as speech", () => {
    const result = parseScript({ source: fixture("study-guide-invalid.txt") });

    expect(result.errors.map(({ code, line }) => ({ code, line }))).toEqual([
      { code: "MALFORMED_SECTION_DIRECTIVE", line: 2 },
      { code: "UNCLOSED_PRONUNCIATION_ANNOTATION", line: 3 },
      { code: "MALFORMED_SECTION_DIRECTIVE", line: 4 },
      { code: "UNCLOSED_PRONUNCIATION_ANNOTATION", line: 5 }
    ]);
    expect(result.nodes.map(({ type }) => type)).toEqual([
      "speech", "speech", "pause", "speech", "pause", "speech", "speech", "speech", "speech"
    ]);
    expect(result.discoveries.speakers.map(({ id }) => id)).toEqual(["1bad", "teacher"]);
    expect(result.errors.every(({ offendingText, suggestion }) => offendingText.length > 0 && suggestion.length > 0)).toBe(true);
  });

  it.each([
    ["study-guide-valid.txt", "study-guide-valid.parse.json"],
    ["study-guide-invalid.txt", "study-guide-invalid.parse.json"]
  ])("matches the reviewable golden result for %s", (sourceName, expectedName) => {
    expect(goldenProjection(parseScript({ source: fixture(sourceName) }))).toEqual(expected(expectedName));
  });

  it("supports standalone, inline, multiple, and consecutive speaker directives", () => {
    const result = parseScript({ source: "[speaker_teacher]\nHello.\n[speaker_student] Hi.\n[speaker_teacher]\n[speaker_student]\nStill student." });
    const speech = result.nodes.filter((node) => node.type === "speech");

    expect(speech.map(({ speakerId, readableText }) => [speakerId, readableText])).toEqual([
      ["teacher", "Hello."],
      ["student", "Hi."],
      ["student", "Still student."]
    ]);
    expect(result.discoveries.speakers.map(({ id, occurrences }) => [id, occurrences.length])).toEqual([
      ["teacher", 2],
      ["student", 2]
    ]);
  });

  it("requires the speaker_ namespace and never mistakes unknown directives for speakers", () => {
    const result = parseScript({ source: "[speaker_sectioned] This is a speaker.\n[section Database indexes]", defaultSpeakerId: "narrator" });
    expect(result.errors.map(({ code }) => code)).toEqual(["MALFORMED_SECTION_DIRECTIVE"]);
    expect(result.discoveries.speakers.map(({ id }) => id)).toEqual(["sectioned"]);
    expect(result.nodes[1]).toMatchObject({ type: "speech", speakerId: "sectioned", readableText: "[section Database indexes]" });
  });

  it("warns when speaker IDs differ only by case", () => {
    const result = parseScript({ source: "[speaker_Teacher] First.\n[speaker_teacher] Second." });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("SPEAKER_ID_CASE_COLLISION");
  });

  it("parses sections, multiple pauses, consecutive pauses, and edge pauses", () => {
    const result = parseScript({ source: "[pause_short]\n[section: Topic]\n[pause_long]\n[pause_short]" });
    expect(result.errors).toEqual([]);
    expect(result.nodes.map((node) => node.type)).toEqual(["pause", "section", "pause", "pause"]);
    expect(result.summary).toMatchObject({ pauseIdCount: 2, explicitPauseSegmentCount: 3, sectionCount: 1 });
  });

  it("collapses blank-line runs into paragraph boundaries", () => {
    const result = parseScript({ source: "[speaker_teacher] One.\n\n  \nTwo." });
    const paragraph = result.nodes.find((node) => node.type === "paragraphBreak");
    expect(paragraph).toMatchObject({ type: "paragraphBreak", lineCount: 2 });
    expect(result.summary.paragraphBreakCount).toBe(1);
  });

  it("returns no nodes for an empty document", () => {
    const result = parseScript({ source: "" });
    expect(result.nodes).toEqual([]);
    expect(result.summary.paragraphBreakCount).toBe(0);
  });

  it("treats escaped beginning brackets and middle brackets as readable speech", () => {
    const result = parseScript({
      source: "\\[not_a_speaker] spoken literally\nA sentence with [brackets] in its middle.",
      defaultSpeakerId: "narrator"
    });
    const speech = result.nodes.filter((node) => node.type === "speech");
    expect(result.errors).toEqual([]);
    expect(speech.map(({ rawText, readableText }) => [rawText, readableText])).toEqual([
      ["\\[not_a_speaker] spoken literally", "[not_a_speaker] spoken literally"],
      ["A sentence with [brackets] in its middle.", "A sentence with [brackets] in its middle."]
    ]);
  });

  it("escapes inline bracket tokens instead of treating them as directives", () => {
    const result = parseScript({ source: "[speaker_teacher] Keep \\[pause_short] literal." });
    expect(result.nodes[0]).toMatchObject({ readableText: "Keep [pause_short] literal." });
    expect(result.summary.explicitPauseSegmentCount).toBe(0);
  });

  it("extracts annotations and preserves escaped literal annotation markup", () => {
    const result = parseScript({ source: "[speaker_teacher] Read {{resume|cv}} and \\{{example|literal}}." });
    const speech = result.nodes.find((node) => node.type === "speech");
    expect(speech).toMatchObject({
      readableText: "Read resume and {{example|literal}}.",
      annotations: [{ displayText: "resume", senseId: "cv", rawText: "{{resume|cv}}" }]
    });
    expect(result.summary.pronunciationAnnotationCount).toBe(1);
  });

  it.each([
    ["[speaker_teacher] {{|cv}}", "INVALID_PRONUNCIATION_ANNOTATION"],
    ["[speaker_teacher] {{resume|bad sense}}", "INVALID_PRONUNCIATION_SENSE"],
    ["[speaker_teacher] {{resume|cv|extra}}", "INVALID_PRONUNCIATION_ANNOTATION"],
    ["[speaker_teacher] resume}}", "UNMATCHED_PRONUNCIATION_CLOSE"]
  ])("diagnoses malformed pronunciation markup but retains it as literal speech in %s", (source, code) => {
    const result = parseScript({ source });
    expect(result.errors[0]?.code).toBe(code);
    expect(result.nodes[0]).toMatchObject({ type: "speech", readableText: source.slice(source.indexOf("]") + 2), annotations: [] });
  });

  it("uses an optional default speaker and blocks unassigned leading text", () => {
    const withoutDefault = parseScript({ source: "Opening text.\n[speaker_teacher] Assigned." });
    expect(withoutDefault.errors[0]?.code).toBe("MISSING_DEFAULT_SPEAKER");
    expect(withoutDefault.nodes.filter((node) => node.type === "speech")).toHaveLength(1);

    const withDefault = parseScript({ source: "Opening text.", defaultSpeakerId: "narrator" });
    expect(withDefault.errors).toEqual([]);
    expect(withDefault.discoveries.speakers.map(({ id }) => id)).toEqual(["narrator"]);
  });

  it("preserves Unicode speech", () => {
    const result = parseScript({ source: "[speaker_teacher] Καλημέρα 世界 — résumé." });
    expect(result.nodes[0]).toMatchObject({ readableText: "Καλημέρα 世界 — résumé." });
  });

  it.each([
    ["[speaker_] text", "INVALID_SPEAKER_DIRECTIVE"],
    ["[speaker", "UNCLOSED_DIRECTIVE"],
    ["[section:]", "MALFORMED_SECTION_DIRECTIVE"],
    ["[section Topic]", "MALFORMED_SECTION_DIRECTIVE"],
    ["[pause_bad!]", "MALFORMED_PAUSE_DIRECTIVE"]
  ])("diagnoses malformed directive %s and keeps it as literal speech", (source, code) => {
    const result = parseScript({ source, defaultSpeakerId: "narrator" });
    expect(result.errors[0]?.code).toBe(code);
    expect(result.nodes[0]).toMatchObject({ type: "speech", readableText: source });
  });

  it("accepts numeric-leading speaker names and emits inline pause speech after the pause", () => {
    const result = parseScript({ source: "[speaker_1bad] Before.\n[pause_short] After." });
    expect(result.errors).toEqual([]);
    expect(result.discoveries.speakers.map(({ id }) => id)).toEqual(["1bad"]);
    expect(result.nodes.map((node) => node.type === "speech" ? `${node.speakerId}: ${node.readableText}` : node.type)).toEqual([
      "1bad: Before.",
      "pause",
      "1bad: After."
    ]);
  });

  it("recognizes pause and speaker directives anywhere in speech and carries the speaker forward", () => {
    const source = [
      "[speaker_1bad] This speaker name begins with a number and can be mapped later.",
      "[section Database indexes]",
      "[pause_short] This speech follows the pause on [pause_short] {{resume|cv the same line.",
      "[section Database indexes]",
      "[speaker_1bad] This annotation [speaker_teacher] is not closed: {{resume|cv",
      "Still the teacher."
    ].join("\n");
    const result = parseScript({
      source,
      ignoredDiagnostics: [
        { code: "MALFORMED_SECTION_DIRECTIVE", pattern: "[section Database indexes]" },
        { code: "UNCLOSED_PRONUNCIATION_ANNOTATION", pattern: "{{resume|cv" }
      ]
    });

    expect(result.errors).toEqual([]);
    expect(result.nodes.map(({ type }) => type)).toEqual([
      "speech", "speech", "pause", "speech", "pause", "speech", "speech", "speech", "speech", "speech"
    ]);
    expect(result.nodes.filter((node) => node.type === "speech").map(({ speakerId, readableText }) => [speakerId, readableText])).toEqual([
      ["1bad", "This speaker name begins with a number and can be mapped later."],
      ["1bad", "[section Database indexes]"],
      ["1bad", "This speech follows the pause on"],
      ["1bad", "{{resume|cv the same line."],
      ["1bad", "[section Database indexes]"],
      ["1bad", "This annotation"],
      ["teacher", "is not closed: {{resume|cv"],
      ["teacher", "Still the teacher."]
    ]);
    expect(result.discoveries.pauses[0]?.occurrences).toHaveLength(2);
    expect(result.discoveries.speakers.map(({ id, occurrences }) => [id, occurrences.length])).toEqual([
      ["1bad", 2],
      ["teacher", 1]
    ]);
  });

  it("diagnoses malformed inline control tokens without removing them from speech", () => {
    const result = parseScript({
      source: "[speaker_teacher] Keep [speaker_bad name] and [pause_bad!] literal."
    });
    expect(result.errors.map(({ code, ignorePattern }) => [code, ignorePattern])).toEqual([
      ["INVALID_SPEAKER_DIRECTIVE", "[speaker_bad name]"],
      ["MALFORMED_PAUSE_DIRECTIVE", "[pause_bad!]"]
    ]);
    expect(result.nodes[0]).toMatchObject({
      type: "speech",
      speakerId: "teacher",
      readableText: "Keep [speaker_bad name] and [pause_bad!] literal."
    });
  });

  it("suppresses only an exact ignored diagnostic without changing literal recovery", () => {
    const source = "[speaker_teacher] Ready.\n[section Database indexes]";
    const first = parseScript({ source });
    const ignored = parseScript({
      source,
      ignoredDiagnostics: [{ code: "MALFORMED_SECTION_DIRECTIVE", pattern: "[section Database indexes]" }]
    });
    expect(first.errors).toHaveLength(1);
    expect(ignored.errors).toEqual([]);
    expect(ignored.nodes).toEqual(first.nodes);
  });

  it("suppresses every malformed annotation occurrence with the same token pattern", () => {
    const source = [
      "[speaker_teacher] First use: {{resume|cv in this sentence.",
      "Second use in different context: {{resume|cv"
    ].join("\n");
    const first = parseScript({ source });
    const ignored = parseScript({
      source,
      ignoredDiagnostics: [{ code: "UNCLOSED_PRONUNCIATION_ANNOTATION", pattern: "{{resume|cv" }]
    });

    expect(first.errors).toHaveLength(2);
    expect(first.errors.map(({ offendingText }) => offendingText)).not.toEqual([first.errors[0]?.offendingText, first.errors[0]?.offendingText]);
    expect(first.errors.map(({ ignorePattern }) => ignorePattern)).toEqual(["{{resume|cv", "{{resume|cv"]);
    expect(ignored.errors).toEqual([]);
    expect(ignored.nodes).toEqual(first.nodes);
  });

  it("keeps malformed annotation text literal while still parsing valid annotations on the same line", () => {
    const result = parseScript({
      source: "[speaker_teacher] {{resume|cv}} then {{broken}} then {{job|continue}}."
    });
    expect(result.errors.map(({ code }) => code)).toEqual(["INVALID_PRONUNCIATION_ANNOTATION"]);
    expect(result.nodes[0]).toMatchObject({
      type: "speech",
      readableText: "resume then {{broken}} then job.",
      annotations: [
        { displayText: "resume", senseId: "cv" },
        { displayText: "job", senseId: "continue" }
      ]
    });
  });

  it("is deterministic and line-ending equivalent while preserving exact source", () => {
    const lf = "[speaker_teacher] One.\n\n[speaker_student] Two {{two|number}}.";
    const crlf = lf.replaceAll("\n", "\r\n");
    const first = parseScript({ source: lf });
    const repeated = parseScript({ source: lf });
    const windows = parseScript({ source: crlf });

    expect(repeated).toEqual(first);
    expect(first.source).toBe(lf);
    expect(windows.source).toBe(crlf);
    expect({ ...windows, source: lf, summary: { ...windows.summary, characterCount: first.summary.characterCount } }).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/timestamp|createdAt|random|uuid/ui);
  });

  it("validates public parser input instead of returning syntax diagnostics", () => {
    expect(() => ParseScriptInputSchema.parse({ source: "text", defaultSpeakerId: "bad speaker" })).toThrow();
    expect(() => parseScript({ source: "text", ignoredDiagnostics: [{ code: "bad", pattern: "text" }] })).toThrow();
  });
});
