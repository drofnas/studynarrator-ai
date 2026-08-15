import { describe, expect, it, vi } from "vitest";
import { diagnoseSpeaches, discoverSpeachesSpeechCatalog, MAX_AUDIO_BYTES, normalizeSpeachesUrl, probeAudioWithFfprobe, synthesizeSpeech } from "./index.js";
import type { SpeachesSynthesisError } from "./index.js";

describe("normalizeSpeachesUrl", () => {
  it.each([
    ["http://127.0.0.1:8000", "http://127.0.0.1:8000", "root"],
    ["http://127.0.0.1:8000/", "http://127.0.0.1:8000", "root"],
    ["https://speech.example.test/v1", "https://speech.example.test", "v1"],
    ["https://speech.example.test/v1/", "https://speech.example.test", "v1"]
  ])("normalizes %s without duplicating v1", (input, rootUrl, suppliedForm) => {
    expect(normalizeSpeachesUrl(input)).toMatchObject({ rootUrl, suppliedForm });
  });

  it.each([
    "ftp://speech.example.test",
    "http://user:secret@speech.example.test",
    "http://speech.example.test/api",
    "http://speech.example.test/v1/models",
    "http://speech.example.test?key=value",
    "http://speech.example.test#fragment",
    "speech.example.test"
  ])("rejects unsafe or unsupported URL %s", (input) => {
    expect(() => normalizeSpeachesUrl(input)).toThrow();
  });
});

describe("probeAudioWithFfprobe", () => {
  it("accepts a large valid WAV when ffprobe closes stdin after reading its header", async () => {
    const dataSize = 4 * 1024 * 1024;
    const wav = new Uint8Array(44 + dataSize);
    const header = new DataView(wav.buffer);
    wav.set(new TextEncoder().encode("RIFF"), 0);
    header.setUint32(4, 36 + dataSize, true);
    wav.set(new TextEncoder().encode("WAVEfmt "), 8);
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true);
    header.setUint16(22, 1, true);
    header.setUint32(24, 8_000, true);
    header.setUint32(28, 16_000, true);
    header.setUint16(32, 2, true);
    header.setUint16(34, 16, true);
    wav.set(new TextEncoder().encode("data"), 36);
    header.setUint32(40, dataSize, true);

    await expect(probeAudioWithFfprobe(wav)).resolves.toMatchObject({ decodable: true, formatName: "wav" });
  });
});

describe("diagnoseSpeaches failure boundaries", () => {
  it("uses model-scoped voices and parses the top-level voices fallback", async () => {
    const scopedResponses = [
      new Response("{}", { status: 200 }),
      new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 }),
      new Response(JSON.stringify({ models: [{ id: "model", voices: [{ id: "voice" }] }] }), { status: 200 }),
      new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/wav" } })
    ];
    const scoped = await diagnoseSpeaches(
      { baseUrl: "http://127.0.0.1:8000", modelId: "model", voiceId: "voice", timeoutSeconds: 1 },
      {
        connect: vi.fn().mockResolvedValue(undefined),
        fetch: vi.fn(async () => scopedResponses.shift() ?? new Response(null, { status: 500 })),
        probeAudio: vi.fn(async () => ({ decodable: true, formatName: "wav" }))
      }
    );
    expect(scoped.summary.availableVoiceIds).toEqual(["voice"]);
    expect(scoped.summary.stages[6]).toMatchObject({ code: "voice-listed-for-model" });

    const responses = [
      new Response("{}", { status: 200 }),
      new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 }),
      new Response(null, { status: 404 }),
      new Response(JSON.stringify({ voices: [{ id: "voice" }] }), { status: 200 }),
      new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/wav" } })
    ];
    const fallback = await diagnoseSpeaches(
      { baseUrl: "http://127.0.0.1:8000", modelId: "model", voiceId: "voice", timeoutSeconds: 1 },
      {
        connect: vi.fn().mockResolvedValue(undefined),
        fetch: vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 })),
        probeAudio: vi.fn(async () => ({ decodable: true, formatName: "wav" }))
      }
    );
    expect(fallback.summary.availableVoiceIds).toEqual(["voice"]);
  });
  it("classifies DNS failures and skips later stages", async () => {
    const output = await diagnoseSpeaches(
      { baseUrl: "http://does-not-resolve.invalid", modelId: "model", voiceId: "voice", timeoutSeconds: 1 },
      { lookup: vi.fn().mockRejectedValue(Object.assign(new Error("secret host detail"), { code: "ENOTFOUND" })) }
    );
    expect(output.summary.overall).toBe("disconnected");
    expect(output.summary.stages[1]).toMatchObject({ stage: "dns", status: "fail", code: "enotfound" });
    expect(output.summary.stages.slice(2).every(({ status }) => status === "skipped")).toBe(true);
    expect(JSON.stringify(output)).not.toContain("secret host detail");
  });

  it("classifies TLS/HTTP failures without leaking exception details", async () => {
    const output = await diagnoseSpeaches(
      { baseUrl: "https://127.0.0.1", modelId: "model", voiceId: "voice", timeoutSeconds: 1 },
      {
        connect: vi.fn().mockResolvedValue(undefined),
        fetch: vi.fn().mockRejectedValue(Object.assign(new Error("certificate for private.example"), { code: "CERT_HAS_EXPIRED" }))
      }
    );
    expect(output.summary.overall).toBe("disconnected");
    expect(output.summary.stages[2]).toMatchObject({ status: "pass" });
    expect(output.summary.stages[3]).toMatchObject({ status: "fail", code: "cert_has_expired" });
    expect(JSON.stringify(output)).not.toContain("private.example");
  });

  it("reports a pre-aborted check with stable stages", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const output = await diagnoseSpeaches({
      baseUrl: "http://127.0.0.1:9",
      modelId: "model",
      voiceId: "voice",
      timeoutSeconds: 1,
      signal: controller.signal
    });
    expect(output.summary.overall).toBe("disconnected");
    expect(output.summary.stages).toHaveLength(8);
    expect(output.summary.stages[2]).toMatchObject({ status: "fail", code: "request-aborted" });
  });

  it("bounds diagnostic audio before probing it", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    const responses = [
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 }),
      new Response(JSON.stringify({ data: [{ id: "voice" }] }), { status: 200 }),
      new Response(oversized, { status: 200, headers: { "content-type": "audio/wav" } })
    ];
    const probeAudio = vi.fn();
    const output = await diagnoseSpeaches(
      { baseUrl: "http://127.0.0.1:8000", modelId: "model", voiceId: "voice", timeoutSeconds: 1 },
      {
        connect: vi.fn().mockResolvedValue(undefined),
        fetch: vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 })),
        probeAudio
      }
    );
    expect(output.summary.overall).toBe("invalidAudio");
    expect(output.summary.stages[7]).toMatchObject({ status: "fail", code: "audio-too-large" });
    expect(probeAudio).not.toHaveBeenCalled();
  });
});

describe("discoverSpeachesSpeechCatalog", () => {
  const input = {
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "test-secret-must-not-appear",
    timeoutSeconds: 2,
    retryCount: 1
  };

  it("preserves model-scoped voice metadata and deduplicates identifiers", async () => {
    const fetchInput = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-secret-must-not-appear", Accept: "application/json" });
      return new Response(JSON.stringify({ models: [
        { id: "model-a", voices: [{ id: "voice-a", name: "Voice A", language: "English", gender: "female", ignored: "private" }, "voice-b", { id: "voice-a" }] },
        { id: "model-b", voices: [{ voice_id: "voice-c", name: "Voice C" }] }
      ] }), { status: 200 });
    });
    await expect(discoverSpeachesSpeechCatalog(input, { fetch: fetchInput as typeof fetch })).resolves.toEqual({
      schemaVersion: 1,
      models: [
        { modelId: "model-a", voices: [
          { voiceId: "voice-a", name: "Voice A", language: "English", gender: "female" },
          { voiceId: "voice-b", name: null, language: null, gender: null }
        ] },
        { modelId: "model-b", voices: [{ voiceId: "voice-c", name: "Voice C", language: null, gender: null }] }
      ]
    });
    expect(fetchInput).toHaveBeenCalledWith("http://127.0.0.1:8000/v1/audio/models", expect.any(Object));
  });

  it("retries transient failures but not authentication or invalid metadata", async () => {
    const transient = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    await expect(discoverSpeachesSpeechCatalog(input, { fetch: transient, sleep: vi.fn(async () => undefined) }))
      .resolves.toMatchObject({ models: [] });
    expect(transient).toHaveBeenCalledTimes(2);

    const secretBody = JSON.stringify({ secret: "upstream-private" });
    const authentication = vi.fn(async () => new Response(secretBody, { status: 401 }));
    await expect(discoverSpeachesSpeechCatalog(input, { fetch: authentication })).rejects.toMatchObject({ code: "authenticationRequired", retryable: false });
    expect(authentication).toHaveBeenCalledOnce();
    try { await discoverSpeachesSpeechCatalog(input, { fetch: authentication }); } catch (error) {
      expect(String(error)).not.toContain("upstream-private");
      expect(String(error)).not.toContain(input.apiKey);
    }

    const invalid = vi.fn(async () => new Response(JSON.stringify({ models: [{ id: "model", voices: [null] }] }), { status: 200 }));
    await expect(discoverSpeachesSpeechCatalog(input, { fetch: invalid })).rejects.toMatchObject({ code: "invalidResponse", retryable: false });
    expect(invalid).toHaveBeenCalledOnce();
  });

  it("bounds discovery responses and stops on abort", async () => {
    await expect(discoverSpeachesSpeechCatalog(input, {
      fetch: vi.fn(async () => new Response(JSON.stringify({ models: [], padding: "x".repeat(2_000_001) }), { status: 200 }))
    })).rejects.toMatchObject({ code: "invalidResponse", retryable: false });

    const controller = new AbortController();
    controller.abort();
    const fetchInput = vi.fn();
    await expect(discoverSpeachesSpeechCatalog({ ...input, signal: controller.signal }, { fetch: fetchInput }))
      .rejects.toMatchObject({ code: "aborted", retryable: false });
    expect(fetchInput).not.toHaveBeenCalled();
  });
});

describe("synthesizeSpeech", () => {
  const input = {
    baseUrl: "http://127.0.0.1:8000/v1",
    modelId: "model",
    voiceId: "voice",
    speed: 1.15,
    text: "sequel indexes improve reads.",
    apiKey: "test-secret-must-not-appear",
    timeoutSeconds: 2,
    retryCount: 2
  };

  it("sends the exact OpenAI-compatible payload and returns only validated WAV bytes", async () => {
    const fetchInput = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-secret-must-not-appear", Accept: "audio/wav" });
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
      expect(JSON.parse(init.body)).toEqual({
        model: "model",
        voice: "voice",
        speed: 1.15,
        input: "sequel indexes improve reads.",
        response_format: "wav"
      });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/wav" } });
    });
    const result = await synthesizeSpeech(input, {
      fetch: fetchInput as typeof fetch,
      probeAudio: vi.fn(async () => ({ decodable: true, formatName: "wav" }))
    });
    expect(result).toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav", attempts: 1 });
    expect(fetchInput).toHaveBeenCalledWith("http://127.0.0.1:8000/v1/audio/speech", expect.any(Object));
  });

  it("retries transient failures and does not retry rejected selections", async () => {
    const transient = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/wav" } }));
    await expect(synthesizeSpeech(input, {
      fetch: transient,
      probeAudio: vi.fn(async () => ({ decodable: true, formatName: "wav" })),
      sleep: vi.fn(async () => undefined)
    })).resolves.toMatchObject({ attempts: 2 });
    expect(transient).toHaveBeenCalledTimes(2);

    const rejected = vi.fn(async () => new Response(JSON.stringify({ secret: "upstream-private" }), { status: 422 }));
    await expect(synthesizeSpeech(input, { fetch: rejected })).rejects.toMatchObject({ code: "selectionRejected", retryable: false });
    expect(rejected).toHaveBeenCalledTimes(1);
    try { await synthesizeSpeech(input, { fetch: rejected }); } catch (error) {
      expect(String(error)).not.toContain("upstream-private");
      expect(String(error)).not.toContain(input.apiKey);
    }
  });

  it.each([
    [new Response(null, { status: 401 }), "authenticationRequired"],
    [new Response("{}", { status: 200, headers: { "content-type": "application/json" } }), "invalidAudio"],
    [new Response(null, { status: 200, headers: { "content-type": "audio/wav" } }), "invalidAudio"]
  ] as const)("classifies an invalid synthesis response", async (response, code) => {
    await expect(synthesizeSpeech({ ...input, retryCount: 0 }, { fetch: vi.fn(async () => response.clone()) }))
      .rejects.toMatchObject({ code });
  });

  it("rejects undecodable and oversized audio without marking a result complete", async () => {
    await expect(synthesizeSpeech({ ...input, retryCount: 0 }, {
      fetch: vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "audio/wav" } })),
      probeAudio: vi.fn(async () => ({ decodable: false, formatName: null }))
    })).rejects.toMatchObject({ code: "invalidAudio" });

    const cancel = vi.fn();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_AUDIO_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel
    });
    await expect(synthesizeSpeech({ ...input, retryCount: 0 }, {
      fetch: vi.fn(async () => new Response(oversized, { status: 200, headers: { "content-type": "audio/wav" } })),
      probeAudio: vi.fn()
    })).rejects.toMatchObject({ code: "audioTooLarge", retryable: false });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("stops before a request when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchInput = vi.fn();
    await expect(synthesizeSpeech({ ...input, signal: controller.signal }, { fetch: fetchInput }))
      .rejects.toEqual(expect.objectContaining<Partial<SpeachesSynthesisError>>({ code: "aborted", retryable: false }));
    expect(fetchInput).not.toHaveBeenCalled();
  });
});
