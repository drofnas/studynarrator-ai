import { describe, expect, it } from "vitest";
import { LexiconEntrySchema } from "@studynarrator/core";
import { handleParserWorkerRequest } from "./parserWorkerProtocol.js";

describe("script analysis worker protocol", () => {
  it("parses and transforms a validated request", () => {
    const entry = LexiconEntrySchema.parse({
      id: "sql",
      scope: "global",
      entryType: "exactTerm",
      displayText: "SQL",
      spokenText: "sequel",
      caseSensitive: true,
      wholeWord: true,
      priority: 0,
      enabled: true,
      notes: "",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z"
    });
    const response = handleParserWorkerRequest({ requestId: 4, input: { source: "[speaker_teacher] SQL", entries: [entry] } });
    expect(response).toMatchObject({ requestId: 4, ok: true, result: { transformResult: { ttsTranscript: "sequel" } } });
  });

  it("forwards diagnostic suppressions to parsing and transformation", () => {
    const source = "[speaker_Teacher] {{resume|cv}}.\n[speaker_teacher] Again {{resume|cv}}.";
    const response = handleParserWorkerRequest({
      requestId: 5,
      input: {
        source,
        entries: [],
        ignoredDiagnostics: [
          { code: "SPEAKER_ID_CASE_COLLISION", pattern: "[speaker_teacher] Again {{resume|cv}}." },
          { code: "UNRESOLVED_NAMED_SENSE", pattern: "{{resume|cv}}" }
        ]
      }
    });
    expect(response).toMatchObject({
      requestId: 5,
      ok: true,
      result: {
        parseResult: { warnings: [] },
        transformResult: {
          readableTranscript: "{{resume|cv}}.\nAgain {{resume|cv}}.",
          ttsTranscript: "{{resume|cv}}.\nAgain {{resume|cv}}.",
          warnings: [],
          synthesisReady: true
        }
      }
    });
  });

  it("returns a safe error for invalid messages", () => {
    expect(handleParserWorkerRequest({ requestId: 9, input: { source: "text" } })).toMatchObject({ requestId: 9, ok: false });
    expect(handleParserWorkerRequest(null)).toMatchObject({ requestId: -1, ok: false });
  });

  it("analyzes a 100,000-character script without changing its source", () => {
    const source = `[speaker_teacher] ${"a".repeat(99_982)}`;
    expect(source).toHaveLength(100_000);

    const response = handleParserWorkerRequest({ requestId: 12, input: { source, entries: [] } });

    expect(response).toMatchObject({
      requestId: 12,
      ok: true,
      result: {
        parseResult: { source },
        transformResult: { source, readableTranscript: "a".repeat(99_982), ttsTranscript: "a".repeat(99_982) }
      }
    });
  });
});
