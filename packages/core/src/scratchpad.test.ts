import { describe, expect, it } from "vitest";
import type { LexiconEntry } from "./index.js";
import { ScratchpadPassageError, transformScratchpadPassage } from "./scratchpad.js";

const globalSql: LexiconEntry = {
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
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z"
};

describe("transformScratchpadPassage", () => {
  it("preserves original text and applies only enabled global entries when requested", () => {
    const text = "  SQL indexes improve reads.\nSecond paragraph.  ";
    expect(transformScratchpadPassage({ text, entries: [globalSql], applyGlobalLexicon: false })).toMatchObject({
      originalText: text,
      transformedText: "SQL indexes improve reads.\nSecond paragraph.  "
    });
    expect(transformScratchpadPassage({ text, entries: [globalSql], applyGlobalLexicon: true })).toMatchObject({
      originalText: text,
      readableText: "SQL indexes improve reads.\nSecond paragraph.  ",
      transformedText: "sequel indexes improve reads.\nSecond paragraph.  "
    });
  });

  it("keeps unresolved named senses literal and returns their actionable warning", () => {
    const result = transformScratchpadPassage({ text: "Review {{resume|cv}}.", entries: [], applyGlobalLexicon: true });
    expect(result.transformedText).toBe("Review {{resume|cv}}.");
    expect(result.warnings).toEqual([expect.objectContaining({ code: "UNRESOLVED_NAMED_SENSE", line: 1 })]);
  });

  it.each([
    "[speaker_teacher] Read this.",
    "Read this. [pause_short] Then continue.",
    "[section: Topic]\nRead this."
  ])("rejects structured control text: %s", (text) => {
    expect(() => transformScratchpadPassage({ text, entries: [], applyGlobalLexicon: false }))
      .toThrow(ScratchpadPassageError);
  });

  it("enforces nonblank and 1,200-character passages", () => {
    expect(() => transformScratchpadPassage({ text: "   ", entries: [], applyGlobalLexicon: false })).toThrow();
    expect(() => transformScratchpadPassage({ text: "a".repeat(1_201), entries: [], applyGlobalLexicon: false })).toThrow();
  });
});
