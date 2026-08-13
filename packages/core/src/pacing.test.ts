import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
  DEFAULT_PARAGRAPH_PAUSE_ID,
  ParagraphPauseConfigurationSchema,
  ResolveParagraphPausesResultSchema,
  parseScript,
  resolveParagraphPauses
} from "./index.js";

const defaultConfiguration = {
  enabled: true,
  pauseId: DEFAULT_PARAGRAPH_PAUSE_ID,
  durationMs: DEFAULT_PARAGRAPH_PAUSE_DURATION_MS
};

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

describe("paragraph pacing preview", () => {
  it("resolves one medium pause between bare paragraphs by default", () => {
    const parsedScript = parseScript({ source: "First paragraph.\n\nSecond paragraph." });
    const result = resolveParagraphPauses({ parsedScript, configuration: defaultConfiguration });

    expect(DEFAULT_PARAGRAPH_PAUSE_ID).toBe("pause_medium");
    expect(DEFAULT_PARAGRAPH_PAUSE_DURATION_MS).toBe(750);
    expect(result.audits).toEqual([{
      status: "applied",
      pauseId: "pause_medium",
      durationMs: 750,
      previousSpeechNodeOrdinal: 1,
      nextSpeechNodeOrdinal: 3,
      paragraphBreaks: [{ nodeOrdinal: 2, range: parsedScript.nodes[1]?.range }],
      explicitPauseNodeOrdinals: []
    }]);
    expect(ResolveParagraphPausesResultSchema.parse(result)).toEqual(result);
  });

  it("accepts zero and maximum durations while rejecting invalid configuration", () => {
    expect(ParagraphPauseConfigurationSchema.parse({ ...defaultConfiguration, durationMs: 0 }).durationMs).toBe(0);
    expect(ParagraphPauseConfigurationSchema.parse({ ...defaultConfiguration, durationMs: 30_000 }).durationMs).toBe(30_000);
    expect(() => ParagraphPauseConfigurationSchema.parse({ ...defaultConfiguration, durationMs: -1 })).toThrow();
    expect(() => ParagraphPauseConfigurationSchema.parse({ ...defaultConfiguration, durationMs: 30_001 })).toThrow();
    expect(() => ParagraphPauseConfigurationSchema.parse({ ...defaultConfiguration, durationMs: 1.5 })).toThrow();
    expect(() => ParagraphPauseConfigurationSchema.parse({ ...defaultConfiguration, extra: true })).toThrow();
  });

  it("returns no automatic pauses when disabled", () => {
    const parsedScript = parseScript({ source: "First.\n\nSecond." });
    const result = resolveParagraphPauses({
      parsedScript,
      configuration: { ...defaultConfiguration, enabled: false }
    });

    expect(result.audits).toEqual([]);
  });

  it("collapses multiple contributing paragraph boundaries into one speech transition", () => {
    const parsedScript = parseScript({ source: "First.\n\n[section: Topic]\n\nSecond." });
    const result = resolveParagraphPauses({ parsedScript, configuration: defaultConfiguration });

    expect(result.audits).toHaveLength(1);
    expect(result.audits[0]?.paragraphBreaks.map(({ nodeOrdinal }) => nodeOrdinal)).toEqual([2, 4]);
  });

  it("does not create pauses for leading or trailing blank lines", () => {
    const parsedScript = parseScript({ source: "\n\nOnly speech.\n\n" });
    const result = resolveParagraphPauses({ parsedScript, configuration: defaultConfiguration });

    expect(result.audits).toEqual([]);
  });

  it("audits explicit-pause suppression without removing authored pauses", () => {
    const parsedScript = parseScript({ source: "First.\n[pause_short]\n\n[pause_long]\nSecond." });
    const originalNodes = structuredClone(parsedScript.nodes);
    const result = resolveParagraphPauses({ parsedScript, configuration: defaultConfiguration });

    expect(result.audits).toEqual([expect.objectContaining({
      status: "suppressedByExplicitPause",
      explicitPauseNodeOrdinals: [2, 4]
    })]);
    expect(parsedScript.nodes).toEqual(originalNodes);
    expect(parsedScript.nodes.filter((node) => node.type === "pause").map(({ pauseId }) => pauseId)).toEqual([
      "pause_short",
      "pause_long"
    ]);
  });

  it("is deterministic and accepts deeply frozen parse results without mutation", () => {
    const parsedScript = parseScript({ source: "First.\n\nSecond.\n\nThird." });
    const snapshot = structuredClone(parsedScript);
    deepFreeze(parsedScript);

    const first = resolveParagraphPauses({ parsedScript, configuration: defaultConfiguration });
    const second = resolveParagraphPauses({ parsedScript, configuration: defaultConfiguration });

    expect(first).toEqual(second);
    expect(parsedScript).toEqual(snapshot);
  });
});
