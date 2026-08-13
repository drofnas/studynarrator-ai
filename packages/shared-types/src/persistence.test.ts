import { describe, expect, it } from "vitest";
import {
  ConnectionProfileAuthoringSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PausePresetCollectionSchema,
  ProjectLexiconAuthoringCollectionSchema,
  ProjectReplaceInputSchema,
  SpeakerMappingCollectionSchema,
  SystemPacingDefaultsSchema
} from "./persistence.js";

const validProject = {
  name: "Persistence contract",
  description: "",
  scriptSource: "SQL",
  connectionProfileId: null,
  modelId: null,
  speakerMappings: [],
  pausePresets: [{ pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }],
  paragraphPause: { enabled: true, pauseId: "pause_medium", durationMs: 750 },
  lexiconEntries: []
};

describe("persistence contracts", () => {
  it("accepts a strict complete aggregate and rejects mismatched pacing", () => {
    expect(ProjectReplaceInputSchema.parse(validProject)).toEqual(validProject);
    expect(() => ProjectReplaceInputSchema.parse({ ...validProject, unknown: true })).toThrow();
    expect(() => ProjectReplaceInputSchema.parse({
      ...validProject,
      paragraphPause: { enabled: true, pauseId: "pause_medium", durationMs: 900 }
    })).toThrow(/must match/iu);
  });

  it("enforces project and global lexicon ownership", () => {
    expect(() => ProjectReplaceInputSchema.parse({
      ...validProject,
      lexiconEntries: [{ scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }]
    })).toThrow(/project scope/iu);
    expect(() => GlobalLexiconReplaceInputSchema.parse([
      { scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }
    ])).toThrow(/global scope/iu);
  });

  it("bounds pacing values and excludes credential-shaped connection fields", () => {
    expect(SystemPacingDefaultsSchema.parse({ enabled: true, durationMs: 0 })).toEqual({ enabled: true, durationMs: 0 });
    expect(SystemPacingDefaultsSchema.parse({ enabled: false, durationMs: 30_000 })).toEqual({ enabled: false, durationMs: 30_000 });
    expect(() => SystemPacingDefaultsSchema.parse({ enabled: true, durationMs: 30_001 })).toThrow();
    expect(() => ConnectionProfileAuthoringSchema.parse({
      name: "Unsafe", baseUrl: "http://127.0.0.1:8000", defaultModelId: null, defaultVoiceId: null, apiKey: "secret"
    })).toThrow();
    expect(() => ConnectionProfileAuthoringSchema.parse({
      name: "Unsafe", baseUrl: "file:///tmp/socket", defaultModelId: null, defaultVoiceId: null
    })).toThrow();
  });

  it("accepts representative persisted product data", () => {
    const speakerMappings = SpeakerMappingCollectionSchema.parse([
      { speakerId: "teacher", displayName: "Teacher", voiceId: "voice_teacher", speed: 1, gainDb: 0, roleDescription: "Guide", sampleText: "Welcome" }
    ]);
    const pausePresets = PausePresetCollectionSchema.parse([
      { pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }
    ]);
    const paragraphPause = { enabled: true, pauseId: "pause_medium", durationMs: 750 };
    const lexiconEntries = ProjectLexiconAuthoringCollectionSchema.parse([
      { id: "project-resume", scope: "project", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "rez-oo-may" }
    ]);

    expect(ProjectReplaceInputSchema.parse({
      name: "Persistent project",
      description: "Reopen proof",
      scriptSource: "{{resume|cv}} SQL",
      connectionProfileId: "local-speaches",
      modelId: null,
      speakerMappings,
      pausePresets,
      paragraphPause,
      lexiconEntries
    })).toBeDefined();
    expect(GlobalLexiconReplaceInputSchema.parse([
      { id: "global-sql", scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }
    ])).toHaveLength(1);
    expect(IgnoredDiagnosticCollectionSchema.parse([
      { code: "MALFORMED_SECTION_DIRECTIVE", pattern: "[section bad]" }
    ])).toHaveLength(1);
    expect(ConnectionProfileAuthoringSchema.parse({
      id: "local-speaches",
      name: "Local Speaches",
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
      paragraphPause: { enabled: true, pauseId: "pause_medium", durationMs: 900 }
    }).paragraphPause).toEqual({ enabled: true, pauseId: "pause_medium", durationMs: 900 });
  });
});
