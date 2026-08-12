import { describe, expect, it } from "vitest";
import {
  ConnectionProfileAuthoringSchema,
  GlobalLexiconReplaceInputSchema,
  ProjectReplaceInputSchema,
  SystemPacingDefaultsSchema
} from "./persistence.js";

const validProject = {
  name: "Gate 04",
  description: "",
  scriptSource: "SQL",
  connectionProfileId: null,
  speakerMappings: [],
  pausePresets: [{ pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }],
  paragraphPause: { enabled: true, pauseId: "pause_medium", durationMs: 750 },
  lexiconEntries: []
};

describe("G04 persistence contracts", () => {
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
});
