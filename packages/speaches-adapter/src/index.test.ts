import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ConnectionTestSummarySchema } from "@studynarrator/shared-types";
import { describe, expect, it, vi } from "vitest";
import {
  diagnoseSpeaches,
  discoverSpeachesSpeechCatalog,
  MAX_AUDIO_BYTES,
  normalizeSpeachesUrl,
  probeAudioWithFfprobe,
  synthesizeSpeech,
} from "./index.js";
import type { SpeachesSynthesisError } from "./index.js";

const REDIRECT_STATUSES = [301, 302, 307, 308] as const;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function redirectFixture(
  status: (typeof REDIRECT_STATUSES)[number],
  redirectPath?: string,
) {
  let targetRequests = 0;
  const target = createServer((_request, response) => {
    targetRequests += 1;
    response.end("unexpected target response");
  });
  const targetUrl = await listen(target);
  let redirectRequests = 0;
  const requests: string[] = [];
  const redirect = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (redirectPath && request.url !== redirectPath) {
      if (
        redirectPath === "/v1/audio/voices" &&
        request.url === "/v1/audio/models"
      ) {
        response.writeHead(404).end();
      } else if (request.url === "/v1/audio/speech") {
        response
          .writeHead(200, { "Content-Type": "audio/wav" })
          .end(new Uint8Array([1]));
      } else {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            data: [{ id: "model" }],
            models: [{ id: "model", voices: [{ id: "voice" }] }],
            voices: [{ id: "voice" }],
          }),
        );
      }
      return;
    }
    redirectRequests += 1;
    response.writeHead(status, { Location: `${targetUrl}/private-target` });
    response.end();
  });
  const baseUrl = await listen(redirect);
  return {
    baseUrl,
    requests,
    redirectRequests: () => redirectRequests,
    targetRequests: () => targetRequests,
    close: async () => {
      await close(redirect);
      await close(target);
    },
  };
}

describe("normalizeSpeachesUrl", () => {
  it.each([
    ["http://127.0.0.1:8000", "http://127.0.0.1:8000", "root"],
    ["http://127.0.0.1:8000/", "http://127.0.0.1:8000", "root"],
    ["https://speech.example.test/v1", "https://speech.example.test", "v1"],
    ["https://speech.example.test/v1/", "https://speech.example.test", "v1"],
  ])("normalizes %s without duplicating v1", (input, rootUrl, suppliedForm) => {
    expect(normalizeSpeachesUrl(input)).toMatchObject({
      rootUrl,
      suppliedForm,
    });
  });

  it.each([
    "ftp://speech.example.test",
    "http://user:secret@speech.example.test",
    "http://speech.example.test/api",
    "http://speech.example.test/v1/models",
    "http://speech.example.test?key=value",
    "http://speech.example.test#fragment",
    "speech.example.test",
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

    await expect(probeAudioWithFfprobe(wav)).resolves.toMatchObject({
      decodable: true,
      formatName: "wav",
    });
  });
});

describe("diagnoseSpeaches failure boundaries", () => {
  describe.each([
    ["/health", "http"],
    ["/v1/models", "authentication"],
    ["/v1/audio/models", "voice"],
    ["/v1/audio/voices", "voice"],
    ["/v1/audio/speech", "audio"],
  ])("redirects from %s", (path, failedStage) => {
    it.each(REDIRECT_STATUSES)(
      "reports a sanitized failure for HTTP %i",
      async (status) => {
        const fixture = await redirectFixture(status, path);
        const apiKey = "diagnostic-secret-must-not-appear";
        try {
          const output = await diagnoseSpeaches(
            {
              baseUrl: fixture.baseUrl,
              modelId: "model",
              voiceId: "voice",
              apiKey,
              timeoutSeconds: 2,
            },
            {
              probeAudio: vi.fn(async () => ({
                decodable: true,
                formatName: "wav",
              })),
            },
          );
          expect(
            ConnectionTestSummarySchema.parse(output.summary),
          ).toMatchObject({
            overall: "disconnected",
            httpStatus: null,
          });
          const failureIndex = output.summary.stages.findIndex(
            ({ status }) => status === "fail",
          );
          expect(output.summary.stages[failureIndex]).toMatchObject({
            stage: failedStage,
            status: "fail",
            code: "redirect-rejected",
            message: "The endpoint attempted a redirect, which is not allowed.",
          });
          expect(
            output.summary.stages
              .slice(failureIndex + 1)
              .every(({ status }) => status === "skipped"),
          ).toBe(true);
          expect(JSON.stringify(output.summary)).not.toContain(apiKey);
          expect(JSON.stringify(output.summary)).not.toContain(fixture.baseUrl);
          expect(JSON.stringify(output.summary)).not.toContain(
            "private-target",
          );
          expect(fixture.requests.at(-1)).toBe(
            `${path === "/v1/audio/speech" ? "POST" : "GET"} ${path}`,
          );
          expect(fixture.redirectRequests()).toBe(1);
          expect(fixture.targetRequests()).toBe(0);
        } finally {
          await fixture.close();
        }
      },
    );
  });

  it("uses model-scoped voices and parses the top-level voices fallback", async () => {
    const scopedResponses = [
      new Response("{}", { status: 200 }),
      new Response(JSON.stringify({ data: [{ id: "model" }] }), {
        status: 200,
      }),
      new Response(
        JSON.stringify({
          models: [{ id: "model", voices: [{ id: "voice" }] }],
        }),
        { status: 200 },
      ),
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      }),
    ];
    const scopedFetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        scopedResponses.shift() ?? new Response(null, { status: 500 }),
    );
    const scoped = await diagnoseSpeaches(
      {
        baseUrl: "http://127.0.0.1:8000",
        modelId: "model",
        voiceId: "voice",
        timeoutSeconds: 1,
      },
      {
        connect: vi.fn().mockResolvedValue(undefined),
        fetch: scopedFetch,
        probeAudio: vi.fn(async () => ({ decodable: true, formatName: "wav" })),
      },
    );
    expect(scoped.summary.availableVoiceIds).toEqual(["voice"]);
    expect(scoped.summary.stages[6]).toMatchObject({
      code: "voice-listed-for-model",
    });
    expect(
      scopedFetch.mock.calls.every(([, init]) => init?.redirect === "error"),
    ).toBe(true);

    const responses = [
      new Response("{}", { status: 200 }),
      new Response(JSON.stringify({ data: [{ id: "model" }] }), {
        status: 200,
      }),
      new Response(null, { status: 404 }),
      new Response(JSON.stringify({ voices: [{ id: "voice" }] }), {
        status: 200,
      }),
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      }),
    ];
    const fallbackFetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        responses.shift() ?? new Response(null, { status: 500 }),
    );
    const fallback = await diagnoseSpeaches(
      {
        baseUrl: "http://127.0.0.1:8000",
        modelId: "model",
        voiceId: "voice",
        timeoutSeconds: 1,
      },
      {
        connect: vi.fn().mockResolvedValue(undefined),
        fetch: fallbackFetch,
        probeAudio: vi.fn(async () => ({ decodable: true, formatName: "wav" })),
      },
    );
    expect(fallback.summary.availableVoiceIds).toEqual(["voice"]);
    expect(
      fallbackFetch.mock.calls.every(([, init]) => init?.redirect === "error"),
    ).toBe(true);
  });
  it("classifies DNS failures and skips later stages", async () => {
    const output = await diagnoseSpeaches(
      {
        baseUrl: "http://does-not-resolve.invalid",
        modelId: "model",
        voiceId: "voice",
        timeoutSeconds: 1,
      },
      {
        lookup: vi.fn().mockRejectedValue(
          Object.assign(new Error("secret host detail"), {
            code: "ENOTFOUND",
          }),
        ),
      },
    );
    expect(output.summary.overall).toBe("disconnected");
    expect(output.summary.stages[1]).toMatchObject({
      stage: "dns",
      status: "fail",
      code: "enotfound",
    });
    expect(
      output.summary.stages
        .slice(2)
        .every(({ status }) => status === "skipped"),
    ).toBe(true);
    expect(JSON.stringify(output)).not.toContain("secret host detail");
  });

  it("classifies TLS/HTTP failures without leaking exception details", async () => {
    const output = await diagnoseSpeaches(
      {
        baseUrl: "https://127.0.0.1",
        modelId: "model",
        voiceId: "voice",
        timeoutSeconds: 1,
      },
      {
        connect: vi.fn().mockResolvedValue(undefined),
        fetch: vi.fn().mockRejectedValue(
          Object.assign(new Error("certificate for private.example"), {
            code: "CERT_HAS_EXPIRED",
          }),
        ),
      },
    );
    expect(output.summary.overall).toBe("disconnected");
    expect(output.summary.stages[2]).toMatchObject({ status: "pass" });
    expect(output.summary.stages[3]).toMatchObject({
      status: "fail",
      code: "cert_has_expired",
    });
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
      signal: controller.signal,
    });
    expect(output.summary.overall).toBe("disconnected");
    expect(output.summary.stages).toHaveLength(8);
    expect(output.summary.stages[2]).toMatchObject({
      status: "fail",
      code: "request-aborted",
    });
  });

  it("bounds diagnostic audio before probing it", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    const responses = [
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response(JSON.stringify({ data: [{ id: "model" }] }), {
        status: 200,
      }),
      new Response(JSON.stringify({ data: [{ id: "voice" }] }), {
        status: 200,
      }),
      new Response(oversized, {
        status: 200,
        headers: { "content-type": "audio/wav" },
      }),
    ];
    const probeAudio = vi.fn();
    const output = await diagnoseSpeaches(
      {
        baseUrl: "http://127.0.0.1:8000",
        modelId: "model",
        voiceId: "voice",
        timeoutSeconds: 1,
      },
      {
        connect: vi.fn().mockResolvedValue(undefined),
        fetch: vi.fn(
          async () => responses.shift() ?? new Response(null, { status: 500 }),
        ),
        probeAudio,
      },
    );
    expect(output.summary.overall).toBe("invalidAudio");
    expect(output.summary.stages[7]).toMatchObject({
      status: "fail",
      code: "audio-too-large",
    });
    expect(probeAudio).not.toHaveBeenCalled();
  });
});

describe("discoverSpeachesSpeechCatalog", () => {
  const input = {
    baseUrl: "http://127.0.0.1:8000/v1",
    apiKey: "test-secret-must-not-appear",
    timeoutSeconds: 2,
    retryCount: 1,
  };

  it("preserves model-scoped voice metadata and deduplicates identifiers", async () => {
    const fetchInput = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer test-secret-must-not-appear",
          Accept: "application/json",
        });
        return new Response(
          JSON.stringify({
            models: [
              {
                id: "model-a",
                voices: [
                  {
                    id: "voice-a",
                    name: "Voice A",
                    language: "English",
                    gender: "female",
                    ignored: "private",
                  },
                  "voice-b",
                  { id: "voice-a" },
                ],
              },
              {
                id: "model-b",
                voices: [{ voice_id: "voice-c", name: "Voice C" }],
              },
            ],
          }),
          { status: 200 },
        );
      },
    );
    await expect(
      discoverSpeachesSpeechCatalog(input, {
        fetch: fetchInput as typeof fetch,
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      models: [
        {
          modelId: "model-a",
          voices: [
            {
              voiceId: "voice-a",
              name: "Voice A",
              language: "English",
              gender: "female",
            },
            { voiceId: "voice-b", name: null, language: null, gender: null },
          ],
        },
        {
          modelId: "model-b",
          voices: [
            {
              voiceId: "voice-c",
              name: "Voice C",
              language: null,
              gender: null,
            },
          ],
        },
      ],
    });
    expect(fetchInput).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/v1/audio/models",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each(REDIRECT_STATUSES)(
    "rejects a %i redirect without retrying or contacting its target",
    async (status) => {
      const fixture = await redirectFixture(status);
      try {
        const failure = await discoverSpeachesSpeechCatalog({
          ...input,
          baseUrl: fixture.baseUrl,
        }).catch((error: unknown) => error);
        expect(failure).toMatchObject({
          code: "invalidResponse",
          retryable: false,
        });
        expect(String(failure)).not.toContain("private-target");
        expect(String(failure)).not.toContain(input.apiKey);
        expect(fixture.redirectRequests()).toBe(1);
        expect(fixture.targetRequests()).toBe(0);
      } finally {
        await fixture.close();
      }
    },
  );

  it("retries transient failures but not authentication or invalid metadata", async () => {
    const transient = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      );
    await expect(
      discoverSpeachesSpeechCatalog(input, {
        fetch: transient,
        sleep: vi.fn(async () => undefined),
      }),
    ).resolves.toMatchObject({ models: [] });
    expect(transient).toHaveBeenCalledTimes(2);

    const secretBody = JSON.stringify({ secret: "upstream-private" });
    const authentication = vi.fn(
      async () => new Response(secretBody, { status: 401 }),
    );
    await expect(
      discoverSpeachesSpeechCatalog(input, { fetch: authentication }),
    ).rejects.toMatchObject({
      code: "authenticationRequired",
      retryable: false,
    });
    expect(authentication).toHaveBeenCalledOnce();
    try {
      await discoverSpeachesSpeechCatalog(input, { fetch: authentication });
    } catch (error) {
      expect(String(error)).not.toContain("upstream-private");
      expect(String(error)).not.toContain(input.apiKey);
    }

    const invalid = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ models: [{ id: "model", voices: [null] }] }),
          { status: 200 },
        ),
    );
    await expect(
      discoverSpeachesSpeechCatalog(input, { fetch: invalid }),
    ).rejects.toMatchObject({ code: "invalidResponse", retryable: false });
    expect(invalid).toHaveBeenCalledOnce();
  });

  it("bounds discovery responses and stops on abort", async () => {
    await expect(
      discoverSpeachesSpeechCatalog(input, {
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({ models: [], padding: "x".repeat(2_000_001) }),
              { status: 200 },
            ),
        ),
      }),
    ).rejects.toMatchObject({ code: "invalidResponse", retryable: false });

    const controller = new AbortController();
    controller.abort();
    const fetchInput = vi.fn();
    await expect(
      discoverSpeachesSpeechCatalog(
        { ...input, signal: controller.signal },
        { fetch: fetchInput },
      ),
    ).rejects.toMatchObject({ code: "aborted", retryable: false });
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
    retryCount: 2,
  };

  it("sends the exact OpenAI-compatible payload and returns only validated WAV bytes", async () => {
    const fetchInput = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer test-secret-must-not-appear",
          Accept: "audio/wav",
        });
        if (typeof init?.body !== "string")
          throw new Error("Expected a JSON request body.");
        expect(JSON.parse(init.body)).toEqual({
          model: "model",
          voice: "voice",
          speed: 1.15,
          input: "sequel indexes improve reads.",
          response_format: "wav",
        });
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      },
    );
    const result = await synthesizeSpeech(input, {
      fetch: fetchInput as typeof fetch,
      probeAudio: vi.fn(async () => ({ decodable: true, formatName: "wav" })),
    });
    expect(result).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/wav",
      attempts: 1,
    });
    expect(fetchInput).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/v1/audio/speech",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each(REDIRECT_STATUSES)(
    "rejects a %i speech redirect without retrying or forwarding script text",
    async (status) => {
      const fixture = await redirectFixture(status);
      try {
        const failure = await synthesizeSpeech({
          ...input,
          baseUrl: fixture.baseUrl,
        }).catch((error: unknown) => error);
        expect(failure).toMatchObject({
          code: "selectionRejected",
          retryable: false,
        });
        expect(String(failure)).not.toContain(input.text);
        expect(String(failure)).not.toContain("private-target");
        expect(String(failure)).not.toContain(input.apiKey);
        expect(fixture.redirectRequests()).toBe(1);
        expect(fixture.targetRequests()).toBe(0);
      } finally {
        await fixture.close();
      }
    },
  );

  it("retries transient failures and does not retry rejected selections", async () => {
    const transient = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        }),
      );
    await expect(
      synthesizeSpeech(input, {
        fetch: transient,
        probeAudio: vi.fn(async () => ({ decodable: true, formatName: "wav" })),
        sleep: vi.fn(async () => undefined),
      }),
    ).resolves.toMatchObject({ attempts: 2 });
    expect(transient).toHaveBeenCalledTimes(2);

    const rejected = vi.fn(
      async () =>
        new Response(JSON.stringify({ secret: "upstream-private" }), {
          status: 422,
        }),
    );
    await expect(
      synthesizeSpeech(input, { fetch: rejected }),
    ).rejects.toMatchObject({ code: "selectionRejected", retryable: false });
    expect(rejected).toHaveBeenCalledTimes(1);
    try {
      await synthesizeSpeech(input, { fetch: rejected });
    } catch (error) {
      expect(String(error)).not.toContain("upstream-private");
      expect(String(error)).not.toContain(input.apiKey);
    }
  });

  it.each([
    [new Response(null, { status: 401 }), "authenticationRequired"],
    [
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      "invalidAudio",
    ],
    [
      new Response(null, {
        status: 200,
        headers: { "content-type": "audio/wav" },
      }),
      "invalidAudio",
    ],
  ] as const)(
    "classifies an invalid synthesis response",
    async (response, code) => {
      await expect(
        synthesizeSpeech(
          { ...input, retryCount: 0 },
          { fetch: vi.fn(async () => response.clone()) },
        ),
      ).rejects.toMatchObject({ code });
    },
  );

  it("rejects undecodable and oversized audio without marking a result complete", async () => {
    await expect(
      synthesizeSpeech(
        { ...input, retryCount: 0 },
        {
          fetch: vi.fn(
            async () =>
              new Response(new Uint8Array([1, 2]), {
                status: 200,
                headers: { "content-type": "audio/wav" },
              }),
          ),
          probeAudio: vi.fn(async () => ({
            decodable: false,
            formatName: null,
          })),
        },
      ),
    ).rejects.toMatchObject({ code: "invalidAudio" });

    const cancel = vi.fn();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_AUDIO_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    await expect(
      synthesizeSpeech(
        { ...input, retryCount: 0 },
        {
          fetch: vi.fn(
            async () =>
              new Response(oversized, {
                status: 200,
                headers: { "content-type": "audio/wav" },
              }),
          ),
          probeAudio: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ code: "audioTooLarge", retryable: false });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("stops before a request when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchInput = vi.fn();
    await expect(
      synthesizeSpeech(
        { ...input, signal: controller.signal },
        { fetch: fetchInput },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SpeachesSynthesisError>>({
        code: "aborted",
        retryable: false,
      }),
    );
    expect(fetchInput).not.toHaveBeenCalled();
  });
});
