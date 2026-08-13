import { readFileSync } from "node:fs";
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
  name: "Gate 04",
  description: "",
  scriptSource: "SQL",
  connectionProfileId: null,
  modelId: null,
  speakerMappings: [],
  pausePresets: [{ pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }],
  paragraphPause: { enabled: true, pauseId: "pause_medium", durationMs: 750 },
  lexiconEntries: []
};

const g04Manual = readFileSync(new URL("../../../docs/gates/G04-manual-test.md", import.meta.url), "utf8");

function jsonExampleUnder(heading: string): unknown {
  const section = g04Manual.split(`### ${heading}\n`)[1];
  if (!section) throw new Error(`Missing G04 manual heading: ${heading}.`);
  const example = section.match(/```json\n([\s\S]*?)\n```/u)?.[1];
  if (!example) throw new Error(`Missing JSON example under G04 manual heading: ${heading}.`);
  return JSON.parse(example) as unknown;
}

function connectionField(label: string): string {
  const value = g04Manual.match(new RegExp(`- \\*\\*${label}:\\*\\* \\x60([^\\x60]+)\\x60`, "u"))?.[1];
  if (!value) throw new Error(`Missing G04 connection field: ${label}.`);
  return value;
}

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

  it("keeps every G04 manual review payload copy/paste ready", () => {
    const speakerMappings = SpeakerMappingCollectionSchema.parse(jsonExampleUnder("Speaker mappings JSON"));
    const pausePresets = PausePresetCollectionSchema.parse(jsonExampleUnder("Pause presets JSON"));
    const paragraphPause = jsonExampleUnder("Paragraph pacing JSON");
    const lexiconEntries = ProjectLexiconAuthoringCollectionSchema.parse(jsonExampleUnder("Project lexicon JSON"));

    expect(ProjectReplaceInputSchema.parse({
      name: "Gate 04 Persistence",
      description: "Two-restart review",
      scriptSource: "{{resume|cv}} SQL",
      connectionProfileId: connectionField("ID"),
      speakerMappings,
      pausePresets,
      paragraphPause,
      lexiconEntries
    })).toBeDefined();
    expect(GlobalLexiconReplaceInputSchema.parse(jsonExampleUnder("Global lexicon JSON"))).toHaveLength(1);
    expect(IgnoredDiagnosticCollectionSchema.parse(jsonExampleUnder("Ignored diagnostic patterns JSON"))).toHaveLength(1);
    expect(ConnectionProfileAuthoringSchema.parse({
      id: connectionField("ID"),
      name: connectionField("Name"),
      baseUrl: connectionField("HTTP\\(S\\) base URL"),
      defaultModelId: connectionField("Model hint"),
      defaultVoiceId: connectionField("Voice hint")
    })).toBeDefined();

    const allJsonExamples = [...g04Manual.matchAll(/[ \\t]*```json\n([\s\S]*?)\n[ \\t]*```/gu)]
      .map((match) => {
        const example = match[1];
        if (!example) throw new Error("The G04 manual contains an empty JSON example.");
        return JSON.parse(example) as unknown;
      });
    expect(allJsonExamples).toHaveLength(8);
    expect(PausePresetCollectionSchema.parse(allJsonExamples[6])).toEqual([
      { pauseId: "pause_medium", durationMs: 900, description: "Automatic paragraph transition" }
    ]);
    expect(ProjectReplaceInputSchema.parse({
      ...validProject,
      pausePresets: allJsonExamples[6],
      paragraphPause: allJsonExamples[7]
    }).paragraphPause).toEqual({ enabled: true, pauseId: "pause_medium", durationMs: 900 });
  });
});
