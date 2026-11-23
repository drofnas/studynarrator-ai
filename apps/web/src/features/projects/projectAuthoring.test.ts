// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { VoiceCatalogEntry } from "@studynarrator/shared-types";
import {
  defaultSpeakerVoice,
  resolveEffectiveSpeakerVoiceId,
  resolveProjectSpeakerVoiceId,
  scriptVoiceStatus,
  speakerVoiceSelection,
  stripSingleSurroundingCodeFence,
  supportedProjectVoices,
} from "./projectAuthoring.js";

const voices: VoiceCatalogEntry[] = [
  {
    voiceId: "voice-disabled",
    label: "Disabled",
    enabled: false,
    favorite: false,
    language: null,
    locale: null,
    accent: null,
    category: null,
    style: null,
    sampleText: null,
  },
  {
    voiceId: "voice-first",
    label: "First",
    enabled: true,
    favorite: false,
    language: null,
    locale: null,
    accent: null,
    category: null,
    style: null,
    sampleText: null,
  },
  {
    voiceId: "voice-default",
    label: "Default",
    enabled: true,
    favorite: false,
    language: null,
    locale: null,
    accent: null,
    category: null,
    style: null,
    sampleText: null,
  },
];

describe("authoring input helpers", () => {
  it("only strips one explicit surrounding code fence", () => {
    expect(stripSingleSurroundingCodeFence("```text\nSQL\n```")).toBe("SQL");
    expect(
      stripSingleSurroundingCodeFence("before\n```text\nSQL\n```"),
    ).toBeUndefined();
    expect(stripSingleSurroundingCodeFence("SQL")).toBeUndefined();
  });

  it("resolves project speaker voices from enabled system entries", () => {
    expect(
      resolveProjectSpeakerVoiceId("voice-first", "voice-default", voices),
    ).toBe("voice-first");
    expect(resolveProjectSpeakerVoiceId(null, "voice-default", voices)).toBe(
      "voice-default",
    );
    expect(
      resolveProjectSpeakerVoiceId("legacy-voice", "voice-disabled", voices),
    ).toBe("voice-first");
    expect(resolveProjectSpeakerVoiceId("voice-disabled", null, voices)).toBe(
      "voice-first",
    );
    expect(resolveProjectSpeakerVoiceId(null, null, [])).toBeNull();
    expect(
      resolveProjectSpeakerVoiceId(
        "legacy-voice",
        null,
        voices.map((voice) => ({ ...voice, enabled: false })),
      ),
    ).toBeNull();
  });

  it("intersects catalog ordering with server support and appends newly discovered voices", () => {
    expect(
      supportedProjectVoices(voices, [
        {
          voiceId: "voice-default",
          name: "Default server name",
          language: null,
          gender: null,
        },
        { voiceId: "voice-disabled", name: null, language: null, gender: null },
        {
          voiceId: "voice-new",
          name: "New voice",
          language: "English",
          gender: "neutral",
        },
      ]),
    ).toEqual([
      expect.objectContaining({ voiceId: "voice-default", label: "Default" }),
      expect.objectContaining({
        voiceId: "voice-new",
        label: "New voice — voice-new",
        language: "English",
        category: "neutral",
      }),
    ]);
  });

  it("prefers a Settings override, then a usable script hint, then the default chain", () => {
    const resolve = (
      speaker: Parameters<typeof resolveEffectiveSpeakerVoiceId>[0],
    ) => resolveEffectiveSpeakerVoiceId(speaker, "voice-default", voices);

    expect(
      resolve({
        voiceId: "voice-first",
        voiceOverride: true,
        voiceHint: "voice-default",
      }),
    ).toBe("voice-first");
    expect(
      resolve({
        voiceId: "voice-first",
        voiceOverride: false,
        voiceHint: "voice-default",
      }),
    ).toBe("voice-default");
    expect(resolve({ voiceId: null, voiceHint: "voice-first" })).toBe(
      "voice-first",
    );
    expect(
      resolve({
        voiceId: "voice-disabled",
        voiceOverride: true,
        voiceHint: "voice-first",
      }),
    ).toBe("voice-first");
    expect(resolve({ voiceId: null, voiceHint: "voice-disabled" })).toBe(
      "voice-default",
    );
    expect(
      resolve({ voiceId: "voice-first", voiceHint: "unknown-voice" }),
    ).toBe("voice-first");
    expect(resolve({ voiceId: "voice-first" })).toBe("voice-first");
  });

  it("records an override unless the starred script voice is chosen", () => {
    expect(
      speakerVoiceSelection({ voiceHint: "voice-first" }, "voice-default"),
    ).toEqual({
      voiceId: "voice-default",
      voiceOverride: true,
    });
    expect(
      speakerVoiceSelection({ voiceHint: "voice-first" }, "voice-first"),
    ).toEqual({
      voiceId: "voice-first",
      voiceOverride: false,
    });
    expect(speakerVoiceSelection({}, "voice-first")).toEqual({
      voiceId: "voice-first",
      voiceOverride: true,
    });
  });

  it("reports whether a speaker follows, overrides, or cannot use its script voice", () => {
    expect(scriptVoiceStatus({ voiceId: "voice-first" }, voices)).toBe("none");
    expect(
      scriptVoiceStatus(
        { voiceId: "voice-first", voiceHint: "voice-first" },
        voices,
      ),
    ).toBe("following");
    expect(
      scriptVoiceStatus(
        {
          voiceId: "voice-default",
          voiceOverride: true,
          voiceHint: "voice-first",
        },
        voices,
      ),
    ).toBe("overridden");
    expect(
      scriptVoiceStatus(
        { voiceId: "voice-default", voiceHint: "voice-disabled" },
        voices,
      ),
    ).toBe("unavailable");
  });

  it("resets a speaker to its usable script voice, then af_heart, then the default chain", () => {
    const heart = { ...voices[1]!, voiceId: "af_heart" };
    expect(
      defaultSpeakerVoice({ voiceHint: "voice-first" }, "voice-default", [
        ...voices,
        heart,
      ]),
    ).toEqual({ voiceId: "voice-first", voiceOverride: false });
    expect(
      defaultSpeakerVoice({ voiceHint: "voice-disabled" }, "voice-default", [
        ...voices,
        heart,
      ]),
    ).toEqual({ voiceId: "af_heart", voiceOverride: false });
    expect(
      defaultSpeakerVoice({}, "voice-default", [...voices, heart]),
    ).toEqual({ voiceId: "af_heart", voiceOverride: false });
    expect(defaultSpeakerVoice({}, "voice-default", voices)).toEqual({
      voiceId: "voice-default",
      voiceOverride: false,
    });
    expect(
      defaultSpeakerVoice(
        {},
        null,
        voices.map((voice) => ({ ...voice, enabled: false })),
      ),
    ).toEqual({ voiceId: null, voiceOverride: false });
  });
});
