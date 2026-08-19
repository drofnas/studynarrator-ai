import { describe, expect, it } from "vitest";
import type {
  ProjectReplaceInput,
  SpeachesConnection,
} from "@studynarrator/shared-types";
import { createProjectSpeechCacheKeyPlanner } from "./cachedSpeech.js";

const connection: SpeachesConnection = {
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

describe("project speech cache key planning", () => {
  it("changes identity for voice, speed, and pronunciation text and restores the original key on reversion", () => {
    const plan = createProjectSpeechCacheKeyPlanner({
      getSpeachesConnection: () => connection,
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
      getSpeachesConnection: () => ({ ...connection, defaultModelId: null }),
      listGlobalLexicon: () => [],
    });
    expect(plan(input)).toBeUndefined();
  });
});
