import {
  ProjectPreviewInputSchema,
  ProjectPreviewResultSchema,
  SpeechCacheCleanupResultSchema,
  SpeechCacheStatusSchema
} from "./preview.js";

const timestamp = "2026-08-13T12:00:00.000Z";
const projectId = "00000000-0000-4000-8000-000000000001";

describe("preview and speech cache contracts", () => {
  it("accepts only segment or bounded pronunciation requests", () => {
    expect(ProjectPreviewInputSchema.parse({ mode: "segment", nodeOrdinal: 2 })).toEqual({ mode: "segment", nodeOrdinal: 2 });
    expect(ProjectPreviewInputSchema.parse({ mode: "pronunciation", text: "SQL", speakerId: "teacher" })).toEqual({ mode: "pronunciation", text: "SQL", speakerId: "teacher" });
    expect(() => ProjectPreviewInputSchema.parse({ mode: "segment", nodeOrdinal: 0 })).toThrow();
    expect(() => ProjectPreviewInputSchema.parse({ mode: "pronunciation", text: "" })).toThrow();
  });

  it("validates complete preview results without paths or endpoints", () => {
    const result = ProjectPreviewResultSchema.parse({
      schemaVersion: 1,
      id: "00000000-0000-4000-8000-000000000002",
      createdAt: timestamp,
      projectId,
      mode: "segment",
      nodeOrdinal: 2,
      sourceRange: { start: { line: 2, column: 1 }, end: { line: 2, column: 7 } },
      connectionProfileId: "profile",
      connectionProfileName: "Local",
      modelId: "model",
      speakerId: "teacher",
      voiceId: "voice",
      voiceLabel: "Teacher Voice",
      speed: 1,
      originalText: "SQL.",
      readableText: "SQL.",
      transformedText: "sequel.",
      cache: { key: "a".repeat(64), status: "miss", byteLength: 3, createdAt: timestamp, lastUsedAt: timestamp },
      audio: { mimeType: "audio/wav", base64: "AQID", byteLength: 3 }
    });
    expect(result.cache.status).toBe("miss");
    expect(() => ProjectPreviewResultSchema.parse({ ...result, audioPath: "/private/cache.wav" })).toThrow();
  });

  it("validates cache status and cleanup counters", () => {
    expect(SpeechCacheStatusSchema.parse({
      contractVersion: 1, entryCount: 2, totalBytes: 100, lastUsedAt: timestamp,
      sessionHits: 1, sessionMisses: 2, sessionWrites: 2, sessionCorruptMisses: 0, inFlight: 0
    }).entryCount).toBe(2);
    expect(SpeechCacheCleanupResultSchema.parse({ contractVersion: 1, entriesRemoved: 2, bytesFreed: 100 })).toEqual({ contractVersion: 1, entriesRemoved: 2, bytesFreed: 100 });
  });
});
