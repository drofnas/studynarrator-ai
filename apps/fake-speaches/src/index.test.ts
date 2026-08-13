import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { diagnoseSpeaches } from "@studynarrator/speaches-adapter";
import {
  FAKE_SPEACHES_MODEL_ID,
  FAKE_SPEACHES_VOICE_ID,
  startFakeSpeachesServer,
  type FakeSpeachesServer
} from "./index.js";

let current: FakeSpeachesServer | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function diagnose(baseUrl: string, timeoutSeconds = 2) {
  return await diagnoseSpeaches({
    baseUrl,
    modelId: FAKE_SPEACHES_MODEL_ID,
    voiceId: FAKE_SPEACHES_VOICE_ID,
    apiKey: "g06-secret-must-not-appear",
    timeoutSeconds
  });
}

describe("fake Speaches diagnostic scenarios", () => {
  it("returns deterministic, decodable WAV audio and sanitized logs", async () => {
    current = await startFakeSpeachesServer();
    const output = await diagnose(current.baseUrl);
    expect(output.summary.overall).toBe("connected");
    expect(output.summary.stages.map(({ status }) => status)).toEqual(Array(8).fill("pass"));
    expect(output.summary.stages[7]).toMatchObject({ code: "audio-valid-wav" });

    const state = current.getState();
    expect(state.counters).toMatchObject({ "/health": 1, "/v1/models": 1, "/v1/audio/voices": 1, "/v1/audio/speech": 1 });
    expect(state.requests.at(-1)).toMatchObject({
      method: "POST",
      path: "/v1/audio/speech",
      status: 200,
      model: FAKE_SPEACHES_MODEL_ID,
      voice: FAKE_SPEACHES_VOICE_ID,
      inputLength: 31
    });
    expect(state.requests.at(-1)?.inputHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(state)).not.toContain("g06-secret-must-not-appear");
    expect(JSON.stringify(state)).not.toContain("StudyNarrator connection check");
  });

  it.each([
    ["unauthorized", "authenticationRequired", "authentication-required"],
    ["missing-model", "modelUnavailable", "model-unavailable"],
    ["rejected-voice", "voiceUnavailable", "voice-rejected-422"],
    ["empty-body", "invalidAudio", "audio-empty"],
    ["invalid-content-type", "invalidAudio", "audio-content-type-invalid"],
    ["corrupt-audio", "invalidAudio", "audio-undecodable"]
  ] as const)("classifies %s", async (scenario, overall, code) => {
    current = await startFakeSpeachesServer({ scenario });
    const output = await diagnose(current.baseUrl);
    expect(output.summary.overall).toBe(overall);
    expect(output.summary.stages.some((candidate) => candidate.code === code)).toBe(true);
    expect(JSON.stringify(output)).not.toContain("g06-secret-must-not-appear");
  });

  it("times out once with no retry", async () => {
    current = await startFakeSpeachesServer({ scenario: "timeout" });
    const output = await diagnose(current.baseUrl, 0.03);
    expect(output.summary.overall).toBe("disconnected");
    expect(output.summary.stages[3]).toMatchObject({ status: "fail", code: "request-timeout" });
    expect(current.getState().counters["/health"]).toBe(1);
  });

  it("accepts root and /v1 inputs without ever requesting /v1/v1", async () => {
    current = await startFakeSpeachesServer();
    await diagnose(current.baseUrl);
    await diagnose(`${current.baseUrl}/v1`);
    const state = current.getState();
    expect(state.counters["/v1/models"]).toBe(2);
    expect(Object.keys(state.counters).some((path) => path.includes("/v1/v1"))).toBe(false);
  });

  it("classifies a known closed port as a TCP refusal", async () => {
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("Expected a reserved port.");
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    const output = await diagnose(`http://127.0.0.1:${address.port}`);
    expect(output.summary.overall).toBe("disconnected");
    expect(output.summary.stages[2]).toMatchObject({ status: "fail", code: "econnrefused" });
  });

  it("changes scenarios and clears counters through loopback controls", async () => {
    current = await startFakeSpeachesServer();
    const changed = await fetch(`${current.baseUrl}/__control/scenario`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "missing-model" })
    });
    expect(changed.status).toBe(200);
    expect((await diagnose(current.baseUrl)).summary.overall).toBe("modelUnavailable");
    const reset = await fetch(`${current.baseUrl}/__control/reset`, { method: "DELETE" });
    expect(reset.status).toBe(200);
    expect(current.getState().requests).toHaveLength(0);
  });
});
