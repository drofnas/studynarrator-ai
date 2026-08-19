import { describe, expect, it } from "vitest";
import { ProjectSnapshotSchema } from "./renderPlan.js";

const snapshot = {
  schemaVersion: 1,
  snapshotHash: "a".repeat(64),
  capturedAt: "2026-08-15T00:00:00.000Z",
  project: {
    contractVersion: 1,
    id: "00000000-0000-4000-8000-000000000001",
    name: "Current snapshot",
    description: "",
    scriptSource: "narrator: Hello.",
    scriptHash: "b".repeat(64),
    speakerMappings: [],
    lexiconEntries: [],
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  },
  timing: {
    pausePresets: [
      { pauseId: "pause_short", durationMs: 350, description: "Short" },
      { pauseId: "pause_medium", durationMs: 750, description: "Medium" },
      { pauseId: "pause_long", durationMs: 1_500, description: "Long" },
    ],
    transitionPauses: {
      paragraph: { mode: "none" },
      speakerChange: { mode: "none" },
      section: { mode: "none" },
    },
  },
  globalLexiconEntries: [],
  ignoredDiagnostics: [],
  connection: { modelId: "model", serverIdentityHash: "c".repeat(64) },
  versions: {
    scriptGrammar: 1,
    cirSchema: 1,
    lexiconTransform: 1,
    pacing: 1,
    speechCacheSchema: 1,
    speechNormalization: 1,
    speechChunking: 1,
    speechAdapter: 1,
  },
};

describe("ProjectSnapshotSchema", () => {
  it("accepts only the current schema-1 snapshot shape", () => {
    expect(ProjectSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      ProjectSnapshotSchema.safeParse({ ...snapshot, schemaVersion: 4 })
        .success,
    ).toBe(false);
    expect(
      ProjectSnapshotSchema.safeParse({
        ...snapshot,
        connection: { ...snapshot.connection, profileId: "removed-profile" },
      }).success,
    ).toBe(false);
  });
});
