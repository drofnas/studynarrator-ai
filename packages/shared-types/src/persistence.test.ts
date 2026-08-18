import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLOBAL_LEXICON,
  DEFAULT_GLOBAL_NAMED_SENSE_LEXICON,
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  ProjectLexiconAuthoringCollectionSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  SpeakerMappingCollectionSchema,
  SystemTimingConfigurationSchema,
  PersistenceStatusSchema
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
    expect(GlobalLexiconReplaceInputSchema.parse([
      { scope: "global", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "résumé" }
    ])).toEqual([{
      scope: "global", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "résumé",
      caseSensitive: false, wholeWord: true, priority: 0, enabled: true, notes: ""
    }]);
    expect(() => GlobalLexiconReplaceInputSchema.parse([
      { scope: "global", entryType: "namedSense", displayText: "resume", spokenText: "résumé" }
    ])).toThrow();
    expect(() => GlobalLexiconReplaceInputSchema.parse([
      { scope: "global", entryType: "namedSense", displayText: "resume", senseId: "not valid", spokenText: "résumé" }
    ])).toThrow();
    expect(() => GlobalLexiconReplaceInputSchema.parse([
      { scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel", caseSensitive: true }
    ])).toThrow();
  });

  it("defines the complete stable Global Lexicon defaults", () => {
    expect(DEFAULT_GLOBAL_LEXICON).toHaveLength(44);
    expect(DEFAULT_GLOBAL_NAMED_SENSE_LEXICON).toHaveLength(36);
    expect(DEFAULT_GLOBAL_NAMED_SENSE_LEXICON[0]).toMatchObject({
      id: "10000000-0000-4000-8000-000000000009",
      displayText: "resume",
      senseId: "cv",
      spokenText: "rez oo may"
    });
    expect(DEFAULT_GLOBAL_NAMED_SENSE_LEXICON.at(-1)).toMatchObject({
      id: "10000000-0000-4000-8000-000000000044",
      displayText: "axes",
      senseId: "tools",
      spokenText: "ak siz"
    });
    expect(DEFAULT_GLOBAL_NAMED_SENSE_LEXICON.map(({ displayText, senseId, spokenText }) => [`${displayText}/${senseId}`, spokenText])).toEqual([
      ["resume/cv", "rez oo may"], ["resume/continue", "ree zoom"],
      ["read/present", "reed"], ["read/past", "red"],
      ["lead/guide", "leed"], ["lead/metal", "led"],
      ["live/exist", "liv"], ["live/realtime", "lyve"],
      ["record/noun", "reck erd"], ["record/verb", "ree cord"],
      ["project/noun", "prah jekt"], ["project/verb", "pruh jekt"],
      ["object/thing", "ob jekt"], ["object/oppose", "ub jekt"],
      ["subject/topic", "sub jekt"], ["subject/expose", "sub jekt"],
      ["present/current", "prez ent"], ["present/give", "pree zent"],
      ["content/material", "con tent"], ["content/satisfied", "kun tent"],
      ["minute/time", "min it"], ["minute/tiny", "my noot"],
      ["close/near", "klohs"], ["close/shut", "klohz"],
      ["use/noun", "yoos"], ["use/verb", "yooz"],
      ["attribute/property", "at trih byoot"], ["attribute/assign", "uh trib yoot"],
      ["import/noun", "im port"], ["import/verb", "im port"],
      ["export/noun", "eks port"], ["export/verb", "ik sport"],
      ["row/line", "roh"], ["row/argument", "rau"],
      ["axes/math", "ak seez"], ["axes/tools", "ak siz"]
    ]);
    expect(new Set(DEFAULT_GLOBAL_LEXICON.map(({ id }) => id))).toHaveProperty("size", 44);
    const timestamp = "2026-08-16T12:00:00.000Z";
    expect(GlobalLexiconEntryCollectionSchema.parse(DEFAULT_GLOBAL_LEXICON.map((entry) => ({
      ...entry,
      createdAt: timestamp,
      updatedAt: timestamp
    })))).toHaveLength(44);
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

describe("PersistenceStatusSchema", () => {
  const base = {
    contractVersion: 1,
    databasePath: "/tmp/studynarrator/studynarrator.sqlite",
    latestBackupPath: null as string | null
  };

  it("accepts a ready status where the database version differs from the target (mismatch is reportable)", () => {
    const mismatch = PersistenceStatusSchema.parse({
      ...base,
      state: "ready",
      databaseSchemaVersion: 2,
      targetDatabaseSchemaVersion: 3
    });
    expect(mismatch.databaseSchemaVersion).toBe(2);
  });

  it("rejects non-positive or missing schema versions in the ready status", () => {
    expect(() => PersistenceStatusSchema.parse({ ...base, state: "ready", databaseSchemaVersion: 0, targetDatabaseSchemaVersion: 3 })).toThrow();
    expect(() => PersistenceStatusSchema.parse({ ...base, state: "ready", databaseSchemaVersion: -1, targetDatabaseSchemaVersion: 3 })).toThrow();
  });
});
