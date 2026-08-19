import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export const FAKE_SPEACHES_MODEL_ID = "speaches-ai/Kokoro-82M-v1.0-ONNX";
export const FAKE_SPEACHES_VOICE_ID = "af_heart";
const FAKE_SPEACHES_ALTERNATE_VOICE_ID = "af_sky";
export const FAKE_SPEACHES_SECONDARY_MODEL_ID =
  "speaches-ai/Piper-en_US-lessac-medium";
export const FAKE_SPEACHES_SECONDARY_VOICE_ID = "en_US-lessac-medium";
const FAKE_SPEACHES_SCENARIOS = [
  "healthy",
  "slow",
  "timeout",
  "unauthorized",
  "missing-model",
  "rejected-voice",
  "empty-body",
  "invalid-content-type",
  "corrupt-audio",
] as const;
export type FakeSpeachesScenario = (typeof FAKE_SPEACHES_SCENARIOS)[number];

interface FakeSpeachesRequestLog {
  method: string;
  path: string;
  status: number;
  model: string | null;
  voice: string | null;
  speed: number | null;
  inputLength: number;
  inputHash: string | null;
}

interface FakeSpeachesState {
  scenario: FakeSpeachesScenario;
  counters: Readonly<Record<string, number>>;
  requests: readonly FakeSpeachesRequestLog[];
}

export interface FakeSpeachesServer {
  baseUrl: string;
  port: number;
  getState(): FakeSpeachesState;
  setScenario(scenario: FakeSpeachesScenario): void;
  reset(): void;
  close(): Promise<void>;
}

function createDeterministicWav(): Buffer {
  const sampleRate = 8_000;
  const samples = 8_000;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(
      Math.sin((index / sampleRate) * 2 * Math.PI * 440) * 4_000,
    );
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    total += bytes.byteLength;
    if (total > 64 * 1024) throw new Error("Request body too large.");
    chunks.push(bytes);
  }
  if (total === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Expected a JSON object.");
  return parsed as Record<string, unknown>;
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function scenarioFrom(value: unknown): FakeSpeachesScenario | null {
  return typeof value === "string" &&
    FAKE_SPEACHES_SCENARIOS.includes(value as FakeSpeachesScenario)
    ? (value as FakeSpeachesScenario)
    : null;
}

export async function startFakeSpeachesServer(
  options: {
    host?: string;
    port?: number;
    scenario?: FakeSpeachesScenario;
  } = {},
): Promise<FakeSpeachesServer> {
  let scenario: FakeSpeachesScenario = options.scenario ?? "healthy";
  const counters: Record<string, number> = {};
  const requests: FakeSpeachesRequestLog[] = [];
  const wav = createDeterministicWav();
  const handler = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__control/state" && request.method === "GET") {
      sendJson(response, 200, { scenario, counters, requests });
      return;
    }
    if (url.pathname === "/__control/scenario" && request.method === "PUT") {
      try {
        const body = await readJsonBody(request);
        const next = scenarioFrom(body.scenario);
        if (!next) {
          sendJson(response, 400, {
            error: "Unknown scenario.",
            allowed: FAKE_SPEACHES_SCENARIOS,
          });
          return;
        }
        scenario = next;
        sendJson(response, 200, { scenario });
      } catch {
        sendJson(response, 400, { error: "Invalid control request." });
      }
      return;
    }
    if (url.pathname === "/__control/reset" && request.method === "DELETE") {
      for (const key of Object.keys(counters)) delete counters[key];
      requests.length = 0;
      sendJson(response, 200, { reset: true });
      return;
    }

    const path = url.pathname.replace(/\/+$/u, "") || "/";
    counters[path] = (counters[path] ?? 0) + 1;
    let body: Record<string, unknown> = {};
    if (request.method === "POST") {
      try {
        body = await readJsonBody(request);
      } catch {
        sendJson(response, 400, { error: "Invalid request." });
        requests.push({
          method: request.method,
          path,
          status: 400,
          model: null,
          voice: null,
          speed: null,
          inputLength: 0,
          inputHash: null,
        });
        return;
      }
    }
    const model = typeof body.model === "string" ? body.model : null;
    const voice = typeof body.voice === "string" ? body.voice : null;
    const speed =
      typeof body.speed === "number" && Number.isFinite(body.speed)
        ? body.speed
        : null;
    const input = typeof body.input === "string" ? body.input : "";
    const log = (status: number): void => {
      requests.push({
        method: request.method ?? "UNKNOWN",
        path,
        status,
        model,
        voice,
        speed,
        inputLength: input.length,
        inputHash: input
          ? createHash("sha256").update(input).digest("hex")
          : null,
      });
    };

    if (scenario === "timeout") {
      log(0);
      request.once("close", () => undefined);
      return;
    }
    if (path === "/health") {
      log(200);
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (scenario === "unauthorized") {
      log(401);
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }
    if (path === "/v1/models") {
      log(200);
      sendJson(response, 200, {
        data:
          scenario === "missing-model"
            ? []
            : [
                { id: FAKE_SPEACHES_MODEL_ID },
                { id: FAKE_SPEACHES_SECONDARY_MODEL_ID },
              ],
      });
      return;
    }
    if (path === "/v1/audio/models") {
      log(200);
      sendJson(response, 200, {
        object: "list",
        models:
          scenario === "missing-model"
            ? []
            : [
                {
                  id: FAKE_SPEACHES_MODEL_ID,
                  task: "text-to-speech",
                  voices: [
                    {
                      id: FAKE_SPEACHES_VOICE_ID,
                      name: "Heart",
                      language: "American English",
                      gender: "female",
                    },
                    {
                      id: FAKE_SPEACHES_ALTERNATE_VOICE_ID,
                      name: "Sky",
                      language: "American English",
                      gender: "female",
                    },
                  ],
                },
                {
                  id: FAKE_SPEACHES_SECONDARY_MODEL_ID,
                  task: "text-to-speech",
                  voices: [
                    {
                      id: FAKE_SPEACHES_SECONDARY_VOICE_ID,
                      name: "Lessac",
                      language: "American English",
                      gender: "female",
                    },
                  ],
                },
              ],
      });
      return;
    }
    if (path === "/v1/audio/voices") {
      log(200);
      sendJson(response, 200, {
        object: "list",
        voices: [
          { id: FAKE_SPEACHES_VOICE_ID },
          { id: FAKE_SPEACHES_ALTERNATE_VOICE_ID },
          { id: FAKE_SPEACHES_SECONDARY_VOICE_ID },
        ],
      });
      return;
    }
    if (path === "/v1/audio/speech" && request.method === "POST") {
      if (scenario === "slow")
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      if (scenario === "rejected-voice") {
        log(422);
        sendJson(response, 422, { error: "voice rejected" });
        return;
      }
      if (scenario === "empty-body") {
        log(200);
        response.writeHead(200, { "content-type": "audio/wav" });
        response.end();
        return;
      }
      if (scenario === "invalid-content-type") {
        log(200);
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      if (scenario === "corrupt-audio") {
        log(200);
        response.writeHead(200, { "content-type": "audio/wav" });
        response.end("not a wav");
        return;
      }
      log(200);
      response.writeHead(200, {
        "content-type": "audio/wav",
        "content-length": wav.byteLength,
      });
      response.end(wav);
      return;
    }
    log(404);
    sendJson(response, 404, { error: "not found" });
  };

  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (!response.headersSent)
        sendJson(response, 500, { error: "fake server failure" });
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("The fake server did not obtain a loopback port.");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    getState: () => ({
      scenario,
      counters: { ...counters },
      requests: [...requests],
    }),
    setScenario: (next) => {
      scenario = next;
    },
    reset: () => {
      for (const key of Object.keys(counters)) delete counters[key];
      requests.length = 0;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
