import { describe, expect, it } from "vitest";
import type { SpeechCatalogVoice, VoiceCatalogEntry } from "@studynarrator/shared-types";
import { filterPresentedVoices, groupPresentedVoices, presentVoices, voiceOptionLabel } from "./voicePresentation.js";

const serverVoices: SpeechCatalogVoice[] = [
  { voiceId: "voice-heart", name: "Heart", language: "American English", gender: "female" },
  { voiceId: "voice-alloy", name: "Alloy", language: "en-US", gender: null },
  { voiceId: "voice-aoede", name: "Aoede", language: "en-US", gender: null },
  { voiceId: "voice-lessac", name: "Lessac", language: "American English", gender: "female" }
];
const catalogEntries: VoiceCatalogEntry[] = [
  { voiceId: "voice-heart", label: "Catalog Heart — American English — voice-heart", enabled: true, favorite: true, language: "American English", locale: "en-US", accent: null, category: null, style: null, sampleText: null },
  { voiceId: "voice-alloy", label: "Catalog Alloy", enabled: false, favorite: false, language: "American English", locale: "en-US", accent: null, category: null, style: null, sampleText: null },
  { voiceId: "voice-aoede", label: "Catalog Aoede", enabled: true, favorite: false, language: "American English", locale: "en-US", accent: null, category: null, style: null, sampleText: null },
  { voiceId: "voice-local", label: "Local Only — British English — voice-local", enabled: true, favorite: false, language: "British English", locale: "en-GB", accent: null, category: null, style: null, sampleText: null }
];

describe("voice presentation", () => {
  it("merges server and local metadata with deterministic friendly-name and locale fallbacks", () => {
    const voices = presentVoices(serverVoices, catalogEntries);
    expect(voices.find(({ voiceId }) => voiceId === "voice-heart")).toMatchObject({ friendlyName: "Heart", locale: "en-US", favorite: true, availableOnServer: true });
    expect(voices.find(({ voiceId }) => voiceId === "voice-local")).toMatchObject({ friendlyName: "Local Only", locale: "en-GB", availableOnServer: false });
    expect(voices.find(({ voiceId }) => voiceId === "voice-lessac")).toMatchObject({ friendlyName: "Lessac", locale: null, localeLabel: "Locale unavailable", favorite: false });
  });

  it("searches locale codes and groups favorites before sorted locale voices", () => {
    const voices = presentVoices(serverVoices, catalogEntries);
    expect(filterPresentedVoices(voices, "EN-us").map(({ voiceId }) => voiceId)).toEqual(["voice-heart", "voice-alloy", "voice-aoede"]);
    expect(groupPresentedVoices(voices).map(({ label, voices: grouped }) => ({ label, voices: grouped.map(({ friendlyName }) => friendlyName) }))).toEqual([
      { label: "Favorites", voices: ["Heart"] },
      { label: "en-GB", voices: ["Local Only"] },
      { label: "en-US", voices: ["Alloy", "Aoede"] },
      { label: "Locale unavailable", voices: ["Lessac"] }
    ]);
  });

  it("formats native select labels and exposes server availability separately", () => {
    const voices = presentVoices(serverVoices, catalogEntries);
    const heart = voices.find(({ voiceId }) => voiceId === "voice-heart")!;
    expect(voiceOptionLabel(heart)).toBe("Heart (voice-heart | en-US)");
    expect(voices.filter(({ availableOnServer }) => availableOnServer)).toHaveLength(4);
  });
});
