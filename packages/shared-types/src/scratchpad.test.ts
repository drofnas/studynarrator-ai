import { describe, expect, it } from "vitest";
import { ScratchpadPreviewInputSchema, ScratchpadPreviewResultSchema } from "./scratchpad.js";

describe("scratchpad contracts", () => {
  it("preserves source whitespace while enforcing the short-passage limits", () => {
    const text = "  SQL indexes.  ";
    expect(ScratchpadPreviewInputSchema.parse({
      modelId: "model",
      voiceId: "voice",
      speed: 1,
      text,
      applyGlobalLexicon: true
    }).text).toBe(text);
    expect(() => ScratchpadPreviewInputSchema.parse({ modelId: "model", voiceId: "voice", speed: 0, text: "x", applyGlobalLexicon: false })).toThrow();
    expect(() => ScratchpadPreviewInputSchema.parse({ modelId: "model", voiceId: "voice", speed: 1, text: "x".repeat(1_201), applyGlobalLexicon: false })).toThrow();
  });

  it("validates portable base64 audio and its decoded byte count", () => {
    const result = {
      schemaVersion: 1,
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-12T12:00:00.000Z",
      modelId: "model",
      voiceId: "voice",
      voiceLabel: "Friendly Voice",
      speed: 1,
      originalText: "SQL",
      readableText: "SQL",
      transformedText: "sequel",
      lexiconApplied: true,
      warnings: [],
      cache: {
        key: "a".repeat(64), status: "miss", byteLength: 3,
        createdAt: "2026-08-12T12:00:00.000Z", lastUsedAt: "2026-08-12T12:00:00.000Z"
      },
      audio: { mimeType: "audio/wav", base64: "AQID", byteLength: 3 }
    };
    expect(ScratchpadPreviewResultSchema.parse(result)).toEqual(result);
    expect(() => ScratchpadPreviewResultSchema.parse({ ...result, audio: { ...result.audio, byteLength: 2 } })).toThrow();
  });
});
