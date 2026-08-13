import { describe, expect, it, vi } from "vitest";
import { diagnoseSpeaches, normalizeSpeachesUrl } from "./index.js";

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

describe("diagnoseSpeaches failure boundaries", () => {
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
