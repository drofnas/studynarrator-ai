import { describe, expect, it } from "vitest";
import {
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  ProjectLexiconAuthoringCollectionSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  SpeakerMappingCollectionSchema,
  SystemTimingConfigurationSchema
} from "./persistence.js";
import { SpeachesConnectionAuthoringSchema } from "./connections.js";

const validProject = {
  name: "Persistence contract",
  description: "",
  scriptSource: "SQL",
  speakerMappings: [],
  lexiconEntries: []
};

describe("persistence contracts", () => {
  it("accepts strict project summaries with derived index metadata", () => {
    const summary = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Index metadata",
      description: "",
      scriptHash: "a".repeat(64),
      scriptLineCount: 3,
      audioDurationMs: 752_000,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z"
    };

    expect(ProjectSummaryCollectionSchema.parse([summary])).toEqual([summary]);
    expect(ProjectSummaryCollectionSchema.parse([{ ...summary, scriptLineCount: null, audioDurationMs: null }])).toHaveLength(1);
    expect(() => ProjectSummaryCollectionSchema.parse([{ ...summary, unknown: true }])).toThrow();
  });

  it("accepts a strict complete aggregate and rejects project timing", () => {
    expect(ProjectReplaceInputSchema.parse(validProject)).toEqual(validProject);
    expect(() => ProjectReplaceInputSchema.parse({ ...validProject, unknown: true })).toThrow();
    expect(() => ProjectReplaceInputSchema.parse({ ...validProject, pausePresets: [] })).toThrow();
  });

  it("enforces project and global lexicon ownership", () => {
    expect(() => ProjectReplaceInputSchema.parse({
      ...validProject,
      lexiconEntries: [{ scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }]
    })).toThrow();
    expect(() => GlobalLexiconReplaceInputSchema.parse([
      { scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }
    ])).toThrow();
    expect(GlobalLexiconReplaceInputSchema.parse([
      { scope: "global", displayText: " SQL ", spokenText: " S Q L " }
    ])).toEqual([{
      scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "S Q L",
      caseSensitive: false, wholeWord: true, priority: 0, enabled: true, notes: ""
    }]);
    expect(() => GlobalLexiconReplaceInputSchema.parse([
      { scope: "global", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "résumé" }
    ])).toThrow();
    expect(() => GlobalLexiconReplaceInputSchema.parse([
      { scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel", caseSensitive: true }
    ])).toThrow();
  });

  it("bounds global timing values and excludes credential-shaped connection fields", () => {
    const timing = {
      pausePresets: [
        { pauseId: "pause_short", durationMs: 0, description: "Short" },
        { pauseId: "pause_medium", durationMs: 750, description: "Medium" },
        { pauseId: "pause_long", durationMs: 30_000, description: "Long" }
      ],
      transitionPauses: { paragraph: { mode: "preset", pauseId: "pause_medium" }, speakerChange: { mode: "none" }, section: { mode: "duration", durationMs: 900 } }
    };
    expect(SystemTimingConfigurationSchema.parse(timing)).toEqual(timing);
    expect(() => SystemTimingConfigurationSchema.parse({ ...timing, pausePresets: timing.pausePresets.map((preset) => ({ ...preset, durationMs: 30_001 })) })).toThrow();
    expect(() => SystemTimingConfigurationSchema.parse({ ...timing, transitionPauses: { ...timing.transitionPauses, paragraph: { mode: "preset", pauseId: "pause_custom" } } })).toThrow();
    expect(() => SpeachesConnectionAuthoringSchema.parse({
      baseUrl: "http://127.0.0.1:8000", defaultModelId: null, defaultVoiceId: null, apiKey: "secret"
    })).toThrow();
    expect(() => SpeachesConnectionAuthoringSchema.parse({
      baseUrl: "file:///tmp/socket", defaultModelId: null, defaultVoiceId: null
    })).toThrow();
  });

  it("accepts representative persisted product data", () => {
    const speakerMappings = SpeakerMappingCollectionSchema.parse([
      { speakerId: "teacher", displayName: "Teacher", voiceId: "voice_teacher", speed: 1, gainDb: 0, roleDescription: "Guide", sampleText: "Welcome" }
    ]);
    const lexiconEntries = ProjectLexiconAuthoringCollectionSchema.parse([
      { id: "project-resume", scope: "project", displayText: "resume", spokenText: "rez-oo-may" }
    ]);

    expect(ProjectReplaceInputSchema.parse({
      name: "Persistent project",
      description: "Reopen proof",
      scriptSource: "resume SQL",
      speakerMappings,
      lexiconEntries
    })).toBeDefined();
    expect(GlobalLexiconReplaceInputSchema.parse([
      { id: "global-sql", scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }
    ])).toHaveLength(1);
    expect(IgnoredDiagnosticCollectionSchema.parse([
      { code: "MALFORMED_SECTION_DIRECTIVE", pattern: "[section bad]" }
    ])).toHaveLength(1);
    expect(SpeachesConnectionAuthoringSchema.parse({
      baseUrl: "http://127.0.0.1:8000",
      defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      defaultVoiceId: "af_heart"
    })).toBeDefined();
  });
});
