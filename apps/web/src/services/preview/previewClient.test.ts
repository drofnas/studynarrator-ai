import { describe, expect, it, vi } from "vitest";
import {
  createRestProjectPreviewClient,
  createRestSpeechCacheClient,
  resolveProjectPreviewClient,
  resolveSpeechCacheClient
} from "./previewClient.js";

const timestamp = "2026-08-12T12:00:00.000Z";
const cache = {
  key: "a".repeat(64), status: "hit" as const, byteLength: 3,
  createdAt: timestamp, lastUsedAt: timestamp
};
const preview = {
  schemaVersion: 1 as const,
  id: "00000000-0000-4000-8000-000000000002",
  createdAt: timestamp,
  projectId: "00000000-0000-4000-8000-000000000001",
  mode: "pronunciation" as const,
  nodeOrdinal: null,
  sourceRange: null,
  connectionProfileId: "profile",
  connectionProfileName: "Local",
  modelId: "model",
  speakerId: "narrator" as const,
  voiceId: "voice",
  voiceLabel: "Voice",
  speed: 1,
  originalText: "Speech.",
  readableText: "Speech.",
  transformedText: "Speech.",
  cache,
  audio: { mimeType: "audio/wav" as const, base64: "AQID", byteLength: 3 }
};

describe("preview REST clients", () => {
  it("posts project previews with cancellation and validates the response", async () => {
    const fetchInput = vi.fn(async () => new Response(JSON.stringify(preview), { status: 200 }));
    const controller = new AbortController();
    await expect(createRestProjectPreviewClient(fetchInput as typeof fetch).preview(
      preview.projectId,
      { mode: "pronunciation", text: "Speech." },
      controller.signal
    )).resolves.toEqual(preview);
    expect(fetchInput).toHaveBeenCalledWith(`/api/projects/${preview.projectId}/preview`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ mode: "pronunciation", text: "Speech." }), signal: controller.signal
    }));
  });

  it("covers every cache operation and validates cleanup output", async () => {
    const status = {
      contractVersion: 1, entryCount: 1, totalBytes: 3, lastUsedAt: timestamp,
      sessionHits: 1, sessionMisses: 0, sessionWrites: 0, sessionCorruptMisses: 0, inFlight: 0
    };
    const cleanup = { contractVersion: 1, entriesRemoved: 1, bytesFreed: 3 };
    const fetchInput = vi.fn(async (path: string, init?: RequestInit) => new Response(
      JSON.stringify(init?.method === "DELETE" ? cleanup : status), { status: 200 }
    ));
    const client = createRestSpeechCacheClient(fetchInput as typeof fetch);
    await expect(client.status()).resolves.toEqual(status);
    await expect(client.clearAll()).resolves.toEqual(cleanup);
    await expect(client.clearProject(preview.projectId)).resolves.toEqual(cleanup);
    await expect(client.clearEntry(cache.key)).resolves.toEqual(cleanup);
    expect(fetchInput).toHaveBeenCalledTimes(4);
  });

  it("prefers both Electron preload clients", () => {
    const projectPreview = { preview: vi.fn() };
    const speechCache = { status: vi.fn(), clearAll: vi.fn(), clearProject: vi.fn(), clearEntry: vi.fn() };
    const browser = { studyNarrator: { projectPreview, speechCache } } as unknown as Window;
    expect(resolveProjectPreviewClient(browser)).toBe(projectPreview);
    expect(resolveSpeechCacheClient(browser)).toBe(speechCache);
  });
});
