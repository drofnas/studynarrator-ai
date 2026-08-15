import { describe, expect, it } from "vitest";
import {
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PausePresetCollectionSchema,
  ProjectLexiconAuthoringCollectionSchema,
  ProjectReplaceInputSchema,
  SpeakerMappingCollectionSchema,
  SystemPacingDefaultsSchema
} from "./persistence.js";
import { SpeachesConnectionAuthoringSchema } from "./connections.js";

const validProject = {
  name: "Persistence contract",
  description: "",
  scriptSource: "SQL",
  speakerMappings: [],
  pausePresets: [{ pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }],
  transitionPauses: {
    paragraph: { mode: "preset", pauseId: "pause_medium" },
    speakerChange: { mode: "none" },
    section: { mode: "none" }
  },
  lexiconEntries: []
};

describe("persistence contracts", () => {
  it("accepts a strict complete aggregate and rejects mismatched pacing", () => {
    expect(ProjectReplaceInputSchema.parse(validProject)).toEqual(validProject);
    expect(() => ProjectReplaceInputSchema.parse({ ...validProject, unknown: true })).toThrow();
    expect(() => ProjectReplaceInputSchema.parse({
      ...validProject,
      transitionPauses: { ...validProject.transitionPauses, paragraph: { mode: "preset", pauseId: "pause_missing" } }
    })).toThrow(/must reference/iu);
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

  it("bounds pacing values and excludes credential-shaped connection fields", () => {
    expect(SystemPacingDefaultsSchema.parse({ enabled: true, durationMs: 0 })).toEqual({ enabled: true, durationMs: 0 });
    expect(SystemPacingDefaultsSchema.parse({ enabled: false, durationMs: 30_000 })).toEqual({ enabled: false, durationMs: 30_000 });
    expect(() => SystemPacingDefaultsSchema.parse({ enabled: true, durationMs: 30_001 })).toThrow();
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
    const pausePresets = PausePresetCollectionSchema.parse([
      { pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }
    ]);
    const transitionPauses = validProject.transitionPauses;
    const lexiconEntries = ProjectLexiconAuthoringCollectionSchema.parse([
      { id: "project-resume", scope: "project", displayText: "resume", spokenText: "rez-oo-may" }
    ]);

    expect(ProjectReplaceInputSchema.parse({
      name: "Persistent project",
      description: "Reopen proof",
      scriptSource: "resume SQL",
      speakerMappings,
      pausePresets,
      transitionPauses,
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

    const updatedPauses = PausePresetCollectionSchema.parse([
      { pauseId: "pause_medium", durationMs: 900, description: "Automatic paragraph transition" }
    ]);
    expect(ProjectReplaceInputSchema.parse({
      ...validProject,
      pausePresets: updatedPauses,
      transitionPauses: { ...validProject.transitionPauses, section: { mode: "duration", durationMs: 900 } }
    }).transitionPauses.section).toEqual({ mode: "duration", durationMs: 900 });
  });
});
