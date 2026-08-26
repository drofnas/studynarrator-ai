import { describe, expect, it, vi } from "vitest";
import type {
  ProjectReplaceInput,
  SpeechBackendConnection,
} from "@studynarrator/shared-types";
import {
  createProjectSpeechCacheKeyPlanner,
  createSpeechCacheService,
} from "./cachedSpeech.js";

const connection: SpeechBackendConnection = {
  backendId: "speaches",
  baseUrl: "http://127.0.0.1:8000",
  suppliedUrlForm: "root",
  configured: true,
  defaultModelId: "model-a",
  defaultVoiceId: "voice-a",
  timeoutSeconds: 120,
  retryCount: 2,
  responseFormat: "wav",
  lastTestedAt: null,
  lastSuccessfulTestAt: null,
  lastTestSummary: null,
  createdAt: "2026-08-15T12:00:00.000Z",
  updatedAt: "2026-08-15T12:00:00.000Z",
};

const input: ProjectReplaceInput = {
  name: "Cache identity",
  description: "",
  scriptSource: "[speaker_teacher] ETA improves.",
  speakerMappings: [
    {
      speakerId: "teacher",
      displayName: "Teacher",
      voiceId: "voice-a",
      speed: 1,
      gainDb: 0,
      roleDescription: "",
      sampleText: "",
    },
  ],
  lexiconEntries: [],
};

describe("speech cache service", () => {
  it("uses coordinated rendered-clip cleanup only when selected", async () => {
    const clearAll = vi.fn(async () => ({ entriesRemoved: 1, bytesFreed: 3 }));
    const clearCacheAndRenderedProjectClips = vi.fn(async () => ({
      entriesRemoved: 2,
      bytesFreed: 5,
    }));
    const service = createSpeechCacheService({ clearAll } as never, {
      clearCacheAndRenderedProjectClips,
    });

    await expect(
      service.clearAll({ includeRenderedProjectClips: false }),
    ).resolves.toMatchObject({ entriesRemoved: 1, bytesFreed: 3 });
    await expect(
      service.clearAll({ includeRenderedProjectClips: true }),
    ).resolves.toMatchObject({ entriesRemoved: 2, bytesFreed: 5 });
    expect(clearAll).toHaveBeenCalledOnce();
    expect(clearCacheAndRenderedProjectClips).toHaveBeenCalledOnce();
    await expect(service.clearAll({} as never)).rejects.toThrow();
  });
});

describe("project speech cache key planning", () => {
  it("changes identity for voice, speed, and pronunciation text and restores the original key on reversion", () => {
    const plan = createProjectSpeechCacheKeyPlanner({
      getSpeechBackendConnection: () => connection,
      listGlobalLexicon: () => [],
    });
    const [original] = plan(input)!;
    expect(
      plan({
        ...input,
        speakerMappings: [{ ...input.speakerMappings[0]!, voiceId: "voice-b" }],
      }),
    ).not.toContain(original);
    expect(
      plan({
        ...input,
        speakerMappings: [{ ...input.speakerMappings[0]!, speed: 1.2 }],
      }),
    ).not.toContain(original);
    expect(
      plan({
        ...input,
        lexiconEntries: [
          {
            scope: "project",
            entryType: "exactTerm",
            displayText: "ETA",
            spokenText: "estimated time of arrival",
          },
        ],
      }),
    ).not.toContain(original);
    expect(plan(input)).toEqual([original]);
  });

  it("defers reconciliation while synthesis identity is unavailable", () => {
    const plan = createProjectSpeechCacheKeyPlanner({
      getSpeechBackendConnection: () => ({
        ...connection,
        defaultModelId: null,
      }),
      listGlobalLexicon: () => [],
    });
    expect(plan(input)).toBeUndefined();
  });
});
