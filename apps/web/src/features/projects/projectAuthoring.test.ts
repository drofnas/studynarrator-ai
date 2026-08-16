// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { VoiceCatalogEntry } from "@studynarrator/shared-types";
import { resolveProjectSpeakerVoiceId, stripSingleSurroundingCodeFence, supportedProjectVoices } from "./projectAuthoring.js";

const voices: VoiceCatalogEntry[] = [
  { voiceId: "voice-disabled", label: "Disabled", enabled: false, favorite: false, language: null, locale: null, accent: null, category: null, style: null, sampleText: null },
  { voiceId: "voice-first", label: "First", enabled: true, favorite: false, language: null, locale: null, accent: null, category: null, style: null, sampleText: null },
  { voiceId: "voice-default", label: "Default", enabled: true, favorite: false, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }
];

describe("authoring input helpers", () => {
  it("only strips one explicit surrounding code fence", () => {
    expect(stripSingleSurroundingCodeFence("```text\nSQL\n```")).toBe("SQL");
    expect(stripSingleSurroundingCodeFence("before\n```text\nSQL\n```")).toBeUndefined();
    expect(stripSingleSurroundingCodeFence("SQL")).toBeUndefined();
  });

  it("resolves project speaker voices from enabled system entries", () => {
    expect(resolveProjectSpeakerVoiceId("voice-first", "voice-default", voices)).toBe("voice-first");
    expect(resolveProjectSpeakerVoiceId(null, "voice-default", voices)).toBe("voice-default");
    expect(resolveProjectSpeakerVoiceId("legacy-voice", "voice-disabled", voices)).toBe("voice-first");
    expect(resolveProjectSpeakerVoiceId("voice-disabled", null, voices)).toBe("voice-first");
    expect(resolveProjectSpeakerVoiceId(null, null, [])).toBeNull();
    expect(resolveProjectSpeakerVoiceId("legacy-voice", null, voices.map((voice) => ({ ...voice, enabled: false })))).toBeNull();
  });

  it("intersects catalog ordering with server support and appends newly discovered voices", () => {
    expect(supportedProjectVoices(voices, [
      { voiceId: "voice-default", name: "Default server name", language: null, gender: null },
      { voiceId: "voice-disabled", name: null, language: null, gender: null },
      { voiceId: "voice-new", name: "New voice", language: "English", gender: "neutral" }
    ])).toEqual([
      expect.objectContaining({ voiceId: "voice-default", label: "Default" }),
      expect.objectContaining({ voiceId: "voice-new", label: "New voice — voice-new", language: "English", category: "neutral" })
    ]);
  });
});
