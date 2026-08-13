import { describe, expect, it, vi } from "vitest";
import {
  createRestConnectionsClient,
  createRestVoiceCatalogClient,
  resolveConnectionsClient,
  resolveVoiceCatalogClient
} from "./connectionsClient.js";

const profile = {
  id: "local",
  name: "Local",
  baseUrl: "http://127.0.0.1:8000",
  suppliedUrlForm: "root",
  source: "saved",
  editable: true,
  credentialEntryAllowed: false,
  configured: true,
  apiKeyConfigured: false,
  defaultModelId: "model",
  defaultVoiceId: "voice",
  timeoutSeconds: 120,
  retryCount: 2,
  responseFormat: "wav",
  lastTestedAt: null,
  lastSuccessfulTestAt: null,
  lastTestSummary: null,
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z"
};

describe("connection REST clients", () => {
  it("prefers the narrow Electron clients", () => {
    const connections = { list: vi.fn() };
    const voiceCatalog = { get: vi.fn() };
    const browser = { studyNarrator: { connections, voiceCatalog } } as never;
    expect(resolveConnectionsClient(browser)).toBe(connections);
    expect(resolveVoiceCatalogClient(browser)).toBe(voiceCatalog);
  });

  it("uses high-level encoded profile routes", async () => {
    const fetchInput = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(profile), { status: 200, headers: { "content-type": "application/json" } }));
    await createRestConnectionsClient(fetchInput).replace("profile/one", {
      profile: { name: "Local", baseUrl: "http://127.0.0.1:8000", defaultModelId: "model", defaultVoiceId: "voice" },
      credential: { action: "keep" }
    });
    expect(fetchInput.mock.calls[0]?.[0]).toBe("/api/connections/profile%2Fone");
    expect(fetchInput.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
  });

  it("discovers a profile speech catalog through the encoded privileged route", async () => {
    const catalog = { schemaVersion: 1, profileId: "profile/one", models: [{ modelId: "model", voices: [{ voiceId: "voice", name: null, language: null, gender: null }] }] };
    const fetchInput = vi.fn(async (_input?: RequestInfo | URL) => new Response(JSON.stringify(catalog), { status: 200 }));
    await expect(createRestConnectionsClient(fetchInput).discoverSpeechCatalog("profile/one")).resolves.toEqual(catalog);
    expect(fetchInput.mock.calls[0]?.[0]).toBe("/api/connections/profile%2Fone/speech-catalog");
  });

  it("never accepts malformed secret-bearing output", async () => {
    const fetchInput = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([{ ...profile, apiKey: "test-secret-must-not-appear" }]), { status: 200 }));
    await expect(createRestConnectionsClient(fetchInput).list()).rejects.toThrow();
  });

  it("encodes model IDs as a query value", async () => {
    const catalog = { schemaVersion: 1, modelId: "org/model", entries: [] };
    const fetchInput = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(catalog), { status: 200 }));
    await expect(createRestVoiceCatalogClient(fetchInput).get("org/model")).resolves.toEqual(catalog);
    expect(fetchInput.mock.calls[0]?.[0]).toBe("/api/voice-catalog?modelId=org%2Fmodel");
  });
});
