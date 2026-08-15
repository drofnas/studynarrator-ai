import { describe, expect, it } from "vitest";
import {
  AuthoringDryRunResultSchema,
  buildAuthoringDryRun,
  parsePauseDuration,
  parseScript,
  reconcileDiscoveredConfiguration,
  resolveParagraphPauses,
  transformScript,
  validateAuthoringConfiguration,
  type AuthoringPauseConfiguration,
  type AuthoringSpeakerConfiguration,
  type LexiconEntry
} from "./index.js";

const timestamp = "2026-08-12T00:00:00.000Z";
const representativeStudyGuide = `[section: Resumes and background processing]

[speaker_teacher] Today we will compare two meanings of the word {{resume|cv}}.
[pause_short]
[speaker_student] That is the document I send with a job application.
[pause_short]
[speaker_teacher] Correct. A paused job can {{resume|continue}} after a restart.
[pause_long]

[section: SQL pronunciation]

[speaker_teacher] SQL indexes can speed up database reads.
[pause_short]
[speaker_student] In this project, SQL is pronounced using the project lexicon.
`;

function lexiconEntry(overrides: Partial<LexiconEntry> & Pick<LexiconEntry, "id" | "displayText" | "spokenText">): LexiconEntry {
  return {
    scope: "global",
    entryType: "exactTerm",
    caseSensitive: true,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function speaker(speakerId: string, voiceId: string | null): AuthoringSpeakerConfiguration {
  return { speakerId, displayName: speakerId, voiceId, speed: 1, gainDb: 0, roleDescription: "", sampleText: "" };
}

function pause(pauseId: string, durationMs: number): AuthoringPauseConfiguration {
  return { pauseId, durationMs, description: pauseId };
}

describe("pause duration normalization", () => {
  it.each([
    ["350", 350],
    ["350 ms", 350],
    ["0.35 s", 350],
    ["1.5 s", 1_500],
    ["0 s", 0],
    ["30 s", 30_000]
  ])("normalizes %s to exact milliseconds", (input, expected) => {
    expect(parsePauseDuration(input)).toEqual({ ok: true, durationMs: expected, normalized: `${String(expected)} ms` });
  });

  it("rejects negative, malformed, over-precise, and out-of-range values", () => {
    expect(parsePauseDuration("-1 s")).toMatchObject({ ok: false, code: "NEGATIVE" });
    expect(parsePauseDuration("1.5 ms")).toMatchObject({ ok: false, code: "INVALID_FORMAT" });
    expect(parsePauseDuration("0.0001 s")).toMatchObject({ ok: false, code: "SUB_MILLISECOND_PRECISION" });
    expect(parsePauseDuration("30.001 s")).toMatchObject({ ok: false, code: "OUT_OF_RANGE" });
    expect(parsePauseDuration("later")).toMatchObject({ ok: false, code: "INVALID_FORMAT" });
  });
});

describe("discovery reconciliation", () => {
  it("adds supported defaults and preserves unused authored configuration", () => {
    const parseResult = parseScript({ source: "[speaker_teacher] One. [pause_short] Two. [pause_custom] Three." });
    const first = reconcileDiscoveredConfiguration({
      parseResult,
      speakerMappings: [speaker("archived", "old_voice")],
      pausePresets: [pause("pause_archived", 2_000)]
    });

    expect(first.speakers).toEqual([
      expect.objectContaining({ speakerId: "teacher", voiceId: null, speed: 1, gainDb: 0, discovered: true, occurrenceCount: 1 }),
      expect.objectContaining({ speakerId: "archived", voiceId: "old_voice", discovered: false, occurrenceCount: 0 })
    ]);
    expect(first.pauses).toEqual([
      expect.objectContaining({ pauseId: "pause_short", durationMs: 350, discovered: true }),
      expect.objectContaining({ pauseId: "pause_archived", durationMs: 2_000, discovered: false })
    ]);

    const savedSpeakers = first.speakers.map(({ discovered: _discovered, occurrenceCount: _occurrenceCount, ...item }) => item);
    const savedPauses = first.pauses.flatMap(({ durationMs, discovered: _discovered, occurrenceCount: _occurrenceCount, ...item }) =>
      durationMs === null ? [] : [{ ...item, durationMs }]);
    const reloaded = reconcileDiscoveredConfiguration({ parseResult, speakerMappings: savedSpeakers, pausePresets: savedPauses });
    expect(reloaded).toEqual(first);
  });

  it("reports section lines and speech counts", () => {
    const parseResult = parseScript({ source: "[section: First]\n[speaker_teacher] One.\nTwo.\n[section: Second]\nThree." });
    const result = reconcileDiscoveredConfiguration({ parseResult, speakerMappings: [], pausePresets: [] });
    expect(result.sections).toEqual([
      { title: "First", sourceLine: 1, speechSegmentCount: 2 },
      { title: "Second", sourceLine: 4, speechSegmentCount: 1 }
    ]);
  });
});

describe("deterministic readiness and dry run", () => {
  it("blocks missing speakers while treating unsupported pause-shaped text as speech", () => {
    const parseResult = parseScript({ source: "[speaker_teacher] Hello. [pause_custom] Continue." });
    const transformResult = transformScript({ parsedScript: parseResult, entries: [] });
    const reconciled = reconcileDiscoveredConfiguration({ parseResult, speakerMappings: [], pausePresets: [] });
    const validation = validateAuthoringConfiguration({ parseResult, transformResult, speakers: reconciled.speakers, pauses: reconciled.pauses });

    expect(validation.status).toBe("blocked");
    expect(validation.issues).toEqual([
      expect.objectContaining({ code: "MISSING_VOICE_MAPPING", target: { kind: "speaker", id: "teacher" } })
    ]);
  });

  it("keeps original, readable, and TTS text separate in a representative study guide", () => {
    const parseResult = parseScript({ source: representativeStudyGuide });
    const transformResult = transformScript({
      parsedScript: parseResult,
      entries: [
        lexiconEntry({ id: "global-sql", displayText: "SQL", spokenText: "sequel" }),
        lexiconEntry({ id: "resume-cv", scope: "project", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "rez-oo-may" }),
        lexiconEntry({ id: "resume-continue", scope: "project", entryType: "namedSense", displayText: "resume", senseId: "continue", spokenText: "ree-zoom" })
      ]
    });
    const pacingResult = resolveParagraphPauses({ parsedScript: parseResult, configuration: { enabled: true, pauseId: "pause_medium", durationMs: 750 } });
    const reconciled = reconcileDiscoveredConfiguration({
      parseResult,
      speakerMappings: [speaker("teacher", "voice_teacher"), speaker("student", "voice_student")],
      pausePresets: [pause("pause_short", 350), pause("pause_medium", 750), pause("pause_long", 1_500)]
    });
    const result = buildAuthoringDryRun({ parseResult, pacingResult, transformResult, speakers: reconciled.speakers, pauses: reconciled.pauses });
    const firstSpeech = result.rows.find((row) => row.type === "speech");

    expect(result.status).toBe("ready");
    expect(result.rows).toHaveLength(11);
    expect(firstSpeech?.type).toBe("speech");
    if (firstSpeech?.type !== "speech") throw new Error("Expected a speech row.");
    expect(firstSpeech.voiceId).toBe("voice_teacher");
    expect(firstSpeech.originalText).toContain("{{resume|cv}}");
    expect(firstSpeech.readableText).toContain("resume");
    expect(firstSpeech.ttsText).toContain("rez-oo-may");
    expect(result.rows.filter((row) => row.type === "pause").map((row) => row.origin)).toEqual([
      "explicit", "explicit", "explicit", "explicit"
    ]);
    expect(result.schemaVersion).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.rows.map((row) => row.type)).toEqual([
      "section", "speech", "pause", "speech", "pause", "speech", "pause", "section", "speech", "pause", "speech"
    ]);
    expect(result.rows.filter((row) => row.type === "section")).toEqual([
      expect.objectContaining({ title: "Resumes and background processing" }),
      expect.objectContaining({ title: "SQL pronunciation" })
    ]);
    expect(result.rows.filter((row) => row.type === "speech").map((row) => row.ttsText)).toEqual([
      "Today we will compare two meanings of the word rez-oo-may.",
      "That is the document I send with a job application.",
      "Correct. A paused job can ree-zoom after a restart.",
      "sequel indexes can speed up database reads.",
      "In this project, sequel is pronounced using the project lexicon."
    ]);
    expect(AuthoringDryRunResultSchema.parse(result)).toEqual(result);
  });

  it("inserts one automatic paragraph pause and never doubles an explicit pause", () => {
    const automaticParse = parseScript({ source: "First.\n\nSecond." });
    const automaticTransform = transformScript({ parsedScript: automaticParse, entries: [] });
    const automaticPacing = resolveParagraphPauses({ parsedScript: automaticParse, configuration: { enabled: true, pauseId: "pause_medium", durationMs: 750 } });
    const automaticConfig = reconcileDiscoveredConfiguration({
      parseResult: automaticParse,
      speakerMappings: [speaker("narrator", "voice_narrator")],
      pausePresets: [pause("pause_medium", 750)]
    });
    const automatic = buildAuthoringDryRun({ parseResult: automaticParse, pacingResult: automaticPacing, transformResult: automaticTransform, speakers: automaticConfig.speakers, pauses: automaticConfig.pauses });
    expect(automatic.rows.map((row) => row.type === "pause" ? `${row.type}:${row.origin}` : row.type)).toEqual([
      "speech", "pause:paragraph", "speech"
    ]);

    const explicitParse = parseScript({ source: "First.\n[pause_short]\n\nSecond." });
    const explicitTransform = transformScript({ parsedScript: explicitParse, entries: [] });
    const explicitPacing = resolveParagraphPauses({ parsedScript: explicitParse, configuration: { enabled: true, pauseId: "pause_medium", durationMs: 750 } });
    const explicitConfig = reconcileDiscoveredConfiguration({
      parseResult: explicitParse,
      speakerMappings: [speaker("narrator", "voice_narrator")],
      pausePresets: [pause("pause_short", 350), pause("pause_medium", 750)]
    });
    const explicit = buildAuthoringDryRun({ parseResult: explicitParse, pacingResult: explicitPacing, transformResult: explicitTransform, speakers: explicitConfig.speakers, pauses: explicitConfig.pauses });
    expect(explicit.rows.filter((row) => row.type === "pause")).toEqual([
      expect.objectContaining({ type: "pause", origin: "explicit", pauseId: "pause_short", durationMs: 350 })
    ]);
  });
});
