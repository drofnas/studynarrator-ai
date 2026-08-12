import { describe, expect, it } from "vitest";
import { handleParserWorkerRequest } from "./parser-worker-protocol.js";

describe("parser worker protocol", () => {
  it("parses a 100,000-character script through the worker handler", () => {
    const source = `[speaker_teacher] ${"a".repeat(99_982)}`;
    expect(source).toHaveLength(100_000);
    const response = handleParserWorkerRequest({ requestId: 7, input: { source } });
    expect(response).toMatchObject({ requestId: 7, ok: true });
    if (response.ok) {
      expect(response.result.source).toBe(source);
      expect(response.result.summary).toMatchObject({ characterCount: 100_000, speechSegmentCount: 1 });
    }
  });

  it("returns a serializable failure for invalid API input", () => {
    const response = handleParserWorkerRequest({ requestId: 9, input: { source: "text", defaultSpeakerId: "bad speaker" } });
    expect(response).toMatchObject({ requestId: 9, ok: false });
  });
});
