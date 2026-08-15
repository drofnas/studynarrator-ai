import { describe, expect, it, vi } from "vitest";
import { createRestScratchpadClient, resolveScratchpadClient } from "./scratchpadClient.js";

const result = {
  schemaVersion: 1 as const,
  id: "00000000-0000-4000-8000-000000000099",
  createdAt: "2026-08-12T12:00:00.000Z",
  modelId: "model",
  voiceId: "voice",
  voiceLabel: "Voice",
  speed: 1,
  originalText: "Speech.",
  readableText: "Speech.",
  transformedText: "Speech.",
  lexiconApplied: false,
  warnings: [],
  cache: {
    key: "a".repeat(64), status: "hit" as const, byteLength: 3,
    createdAt: "2026-08-12T12:00:00.000Z", lastUsedAt: "2026-08-12T12:00:00.000Z"
  },
  audio: { mimeType: "audio/wav" as const, base64: "AQID", byteLength: 3 }
};

describe("Scratchpad client", () => {
  it("posts the validated request and forwards cancellation", async () => {
    const fetchInput = vi.fn(async () => new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } }));
    const controller = new AbortController();
    const input = { modelId: "model", voiceId: "voice", speed: 1, text: "Speech.", applyGlobalLexicon: false };
    await expect(createRestScratchpadClient(fetchInput as typeof fetch).preview(input, controller.signal)).resolves.toEqual(result);
    expect(fetchInput).toHaveBeenCalledWith("/api/scratchpad/preview", expect.objectContaining({ method: "POST", body: JSON.stringify(input), signal: controller.signal }));
  });

  it("uses sanitized boundary errors and rejects malformed success output", async () => {
    const failure = vi.fn(async () => new Response(JSON.stringify({ error: { code: "SCRATCHPAD_UNAVAILABLE", message: "Check the connection and retry." } }), { status: 503 }));
    await expect(createRestScratchpadClient(failure as typeof fetch).preview({ modelId: "m", voiceId: "v", speed: 1, text: "x", applyGlobalLexicon: false }))
      .rejects.toMatchObject({ code: "SCRATCHPAD_UNAVAILABLE", status: 503 });
    const malformed = vi.fn(async () => new Response(JSON.stringify({ ...result, secret: true }), { status: 200 }));
    await expect(createRestScratchpadClient(malformed as typeof fetch).preview({ modelId: "m", voiceId: "v", speed: 1, text: "x", applyGlobalLexicon: false })).rejects.toThrow();
  });

  it("prefers the Electron preload bridge", () => {
    const scratchpad = { preview: vi.fn() };
    expect(resolveScratchpadClient({ studyNarrator: { scratchpad } } as unknown as Window)).toBe(scratchpad);
  });
});
