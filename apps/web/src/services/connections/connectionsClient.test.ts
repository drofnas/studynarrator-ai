import { describe, expect, it, vi } from "vitest";
import {
  createRestConnectionClient,
  createRestVoiceCatalogClient,
  resolveConnectionClient,
  resolveVoiceCatalogClient,
} from "./connectionsClient.js";

const connection = {
  backendId: "speaches",
  baseUrl: "http://127.0.0.1:8000",
  suppliedUrlForm: "root",
  configured: true,
  defaultModelId: "model",
  defaultVoiceId: "voice",
  timeoutSeconds: 120,
  retryCount: 2,
  responseFormat: "wav",
  lastTestedAt: null,
  lastSuccessfulTestAt: null,
  lastTestSummary: null,
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z",
};

describe("connection REST clients", () => {
  it("prefers the narrow Electron clients", () => {
    const electronConnection = { get: vi.fn() };
    const voiceCatalog = { get: vi.fn() };
    const browser = {
      studyNarrator: { connection: electronConnection, voiceCatalog },
    } as never;
    expect(resolveConnectionClient(browser)).toBe(electronConnection);
    expect(resolveVoiceCatalogClient(browser)).toBe(voiceCatalog);
  });

  it("updates the singular connection route", async () => {
    const fetchInput = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(connection), { status: 200 }),
    );
    await createRestConnectionClient(fetchInput).update({
      baseUrl: "http://127.0.0.1:8000",
      defaultModelId: "model",
      defaultVoiceId: "voice",
      timeoutSeconds: 120,
      retryCount: 2,
      responseFormat: "wav",
    });
    expect(fetchInput.mock.calls[0]?.[0]).toBe("/api/connection");
    expect(fetchInput.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
  });

  it("discovers a draft speech catalog without persisting it", async () => {
    const catalog = {
      schemaVersion: 1,
      models: [
        {
          modelId: "model",
          voices: [
            { voiceId: "voice", name: null, language: null, gender: null },
          ],
        },
      ],
    };
    const fetchInput = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(catalog), { status: 200 }),
    );
    const draft = {
      baseUrl: "http://127.0.0.1:8000",
      timeoutSeconds: 120,
      retryCount: 2,
    };
    await expect(
      createRestConnectionClient(fetchInput).discoverSpeechCatalog(draft),
    ).resolves.toEqual(catalog);
    expect(fetchInput.mock.calls[0]?.[0]).toBe(
      "/api/connection/speech-catalog",
    );
    expect(fetchInput.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(draft),
    });
  });

  it("rejects malformed connection output", async () => {
    const fetchInput = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ...connection,
            apiKey: "test-secret-must-not-appear",
          }),
          { status: 200 },
        ),
    );
    await expect(
      createRestConnectionClient(fetchInput).get(),
    ).rejects.toThrow();
  });

  it("encodes model IDs as a query value", async () => {
    const catalog = { schemaVersion: 1, modelId: "org/model", entries: [] };
    const fetchInput = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(catalog), { status: 200 }),
    );
    await expect(
      createRestVoiceCatalogClient(fetchInput).get("org/model"),
    ).resolves.toEqual(catalog);
    expect(fetchInput.mock.calls[0]?.[0]).toBe(
      "/api/voice-catalog?modelId=org%2Fmodel",
    );
  });
});
