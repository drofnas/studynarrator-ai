import { describe, expect, it } from "vitest";
import {
  GLOBAL_LEXICON_BUILT_INS,
  CustomGlobalLexiconReplaceInputSchema,
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconStateSchema,
  IgnoredDiagnosticCollectionSchema,
  ProjectLexiconAuthoringCollectionSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  SpeakerMappingCollectionSchema,
  SystemTimingConfigurationSchema,
  PersistenceStatusSchema,
} from "./persistence.js";
import { SpeechBackendConnectionAuthoringSchema } from "./connections.js";

const validProject = {
  name: "Persistence contract",
  description: "",
  scriptSource: "SQL",
  speakerMappings: [],
  lexiconEntries: [],
};
const globalNamedSenseBuiltIns = GLOBAL_LEXICON_BUILT_INS.filter(
  (entry) => entry.entryType === "namedSense",
);

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
      updatedAt: "2026-08-12T12:00:00.000Z",
    };

    expect(ProjectSummaryCollectionSchema.parse([summary])).toEqual([summary]);
    expect(
      ProjectSummaryCollectionSchema.parse([
        { ...summary, scriptLineCount: null, audioDurationMs: null },
      ]),
    ).toHaveLength(1);
    expect(() =>
      ProjectSummaryCollectionSchema.parse([{ ...summary, unknown: true }]),
    ).toThrow();
  });

  it("accepts a strict complete aggregate and rejects project timing", () => {
    expect(ProjectReplaceInputSchema.parse(validProject)).toEqual(validProject);
    expect(() =>
      ProjectReplaceInputSchema.parse({ ...validProject, unknown: true }),
    ).toThrow();
    expect(() =>
      ProjectReplaceInputSchema.parse({ ...validProject, pausePresets: [] }),
    ).toThrow();
  });

  it("enforces project and custom global lexicon ownership", () => {
    expect(() =>
      ProjectReplaceInputSchema.parse({
        ...validProject,
        lexiconEntries: [
          {
            scope: "global",
            entryType: "exactTerm",
            displayText: "SQL",
            spokenText: "sequel",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      CustomGlobalLexiconReplaceInputSchema.parse([
        {
          scope: "project",
          entryType: "exactTerm",
          displayText: "SQL",
          spokenText: "sequel",
        },
      ]),
    ).toThrow();
    expect(
      CustomGlobalLexiconReplaceInputSchema.parse([
        { scope: "global", displayText: " SQL ", spokenText: " S Q L " },
      ]),
    ).toEqual([
      {
        scope: "global",
        entryType: "exactTerm",
        displayText: "SQL",
        spokenText: "S Q L",
        caseSensitive: false,
        wholeWord: true,
        priority: 0,
        enabled: true,
        notes: "",
      },
    ]);
    expect(
      CustomGlobalLexiconReplaceInputSchema.parse([
        {
          scope: "global",
          entryType: "namedSense",
          displayText: "resume",
          senseId: "cv",
          spokenText: "résumé",
        },
      ]),
    ).toEqual([
      {
        scope: "global",
        entryType: "namedSense",
        displayText: "resume",
        senseId: "cv",
        spokenText: "résumé",
        caseSensitive: false,
        wholeWord: true,
        priority: 0,
        enabled: true,
        notes: "",
      },
    ]);
    expect(() =>
      CustomGlobalLexiconReplaceInputSchema.parse([
        {
          scope: "global",
          entryType: "namedSense",
          displayText: "resume",
          spokenText: "résumé",
        },
      ]),
    ).toThrow();
    expect(() =>
      CustomGlobalLexiconReplaceInputSchema.parse([
        {
          scope: "global",
          entryType: "namedSense",
          displayText: "resume",
          senseId: "not valid",
          spokenText: "résumé",
        },
      ]),
    ).toThrow();
    expect(() =>
      CustomGlobalLexiconReplaceInputSchema.parse([
        {
          scope: "global",
          entryType: "exactTerm",
          displayText: "SQL",
          spokenText: "sequel",
          caseSensitive: true,
        },
      ]),
    ).toThrow();
  });

  it("loads the complete stable Global Lexicon catalog", () => {
    expect(GLOBAL_LEXICON_BUILT_INS).toHaveLength(39);
    expect(globalNamedSenseBuiltIns).toHaveLength(34);
    expect(GLOBAL_LEXICON_BUILT_INS.map(({ id }) => id)).toEqual([
      "10000000-0000-4000-8000-000000000007",
      "10000000-0000-4000-8000-000000000008",
      "10000000-0000-4000-8000-000000000009",
      "10000000-0000-4000-8000-000000000010",
      "10000000-0000-4000-8000-000000000011",
      "10000000-0000-4000-8000-000000000012",
      "10000000-0000-4000-8000-000000000013",
      "10000000-0000-4000-8000-000000000014",
      "10000000-0000-4000-8000-000000000015",
      "10000000-0000-4000-8000-000000000016",
      "10000000-0000-4000-8000-000000000017",
      "10000000-0000-4000-8000-000000000018",
      "10000000-0000-4000-8000-000000000019",
      "10000000-0000-4000-8000-000000000020",
      "10000000-0000-4000-8000-000000000021",
      "10000000-0000-4000-8000-000000000022",
      "10000000-0000-4000-8000-000000000025",
      "10000000-0000-4000-8000-000000000026",
      "10000000-0000-4000-8000-000000000027",
      "10000000-0000-4000-8000-000000000028",
      "10000000-0000-4000-8000-000000000029",
      "10000000-0000-4000-8000-000000000030",
      "10000000-0000-4000-8000-000000000031",
      "10000000-0000-4000-8000-000000000032",
      "10000000-0000-4000-8000-000000000033",
      "10000000-0000-4000-8000-000000000034",
      "10000000-0000-4000-8000-000000000035",
      "10000000-0000-4000-8000-000000000036",
      "10000000-0000-4000-8000-000000000037",
      "10000000-0000-4000-8000-000000000038",
      "10000000-0000-4000-8000-000000000039",
      "10000000-0000-4000-8000-000000000040",
      "10000000-0000-4000-8000-000000000041",
      "10000000-0000-4000-8000-000000000042",
      "10000000-0000-4000-8000-000000000043",
      "10000000-0000-4000-8000-000000000044",
      "10000000-0000-4000-8000-000000000045",
      "10000000-0000-4000-8000-000000000046",
      "10000000-0000-4000-8000-000000000047",
    ]);
    expect(
      GLOBAL_LEXICON_BUILT_INS.map(({ displayText, spokenText }) => [
        displayText,
        spokenText,
      ]),
    ).toContainEqual(["iframe", "iFrame"]);
    expect(
      GLOBAL_LEXICON_BUILT_INS.map(({ displayText, spokenText }) => [
        displayText,
        spokenText,
      ]),
    ).toContainEqual(["prefetch", "PreFetch"]);
    expect(
      GLOBAL_LEXICON_BUILT_INS.map(({ displayText, spokenText }) => [
        displayText,
        spokenText,
      ]),
    ).toContainEqual(["database", "DataBase"]);
    expect(GLOBAL_LEXICON_BUILT_INS.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining([
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
        "10000000-0000-4000-8000-000000000003",
        "10000000-0000-4000-8000-000000000004",
        "10000000-0000-4000-8000-000000000005",
        "10000000-0000-4000-8000-000000000006",
        "10000000-0000-4000-8000-000000000023",
        "10000000-0000-4000-8000-000000000024",
      ]),
    );
    expect(
      GLOBAL_LEXICON_BUILT_INS.every(
        ({ spokenText }) => !/\s/u.test(spokenText),
      ),
    ).toBe(true);
    const timestamp = "2026-08-16T12:00:00.000Z";
    expect(
      GlobalLexiconEntryCollectionSchema.parse(
        GLOBAL_LEXICON_BUILT_INS.map((entry) => ({
          ...entry,
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      ),
    ).toHaveLength(39);
  });

  it("preserves legacy custom metadata in read-only Global Lexicon state", () => {
    const timestamp = "2026-08-16T12:00:00.000Z";
    const builtIn = {
      ...GLOBAL_LEXICON_BUILT_INS[0]!,
      entryKind: "builtIn" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const legacyCustom = {
      ...builtIn,
      id: "20000000-0000-4000-8000-000000000001",
      entryKind: "custom" as const,
      displayText: "Legacy custom",
      spokenText: "legacy.custom",
      caseSensitive: true,
      priority: 7,
      notes: "preserved migration metadata",
    };

    expect(
      GlobalLexiconStateSchema.parse({
        builtIns: [builtIn],
        custom: [legacyCustom],
      }).custom,
    ).toEqual([legacyCustom]);
    expect(() =>
      GlobalLexiconStateSchema.parse({
        builtIns: [{ ...builtIn, priority: 7 }],
        custom: [],
      }),
    ).toThrow("Built-in global lexicon entries use fixed priority.");
  });

  it("bounds global timing values and excludes credential-shaped connection fields", () => {
    const timing = {
      pausePresets: [
        { pauseId: "pause_short", durationMs: 0, description: "Short" },
        { pauseId: "pause_medium", durationMs: 750, description: "Medium" },
        { pauseId: "pause_long", durationMs: 30_000, description: "Long" },
      ],
      transitionPauses: {
        paragraph: { mode: "preset", pauseId: "pause_medium" },
        speakerChange: { mode: "none" },
        section: { mode: "duration", durationMs: 900 },
      },
    };
    expect(SystemTimingConfigurationSchema.parse(timing)).toEqual(timing);
    expect(() =>
      SystemTimingConfigurationSchema.parse({
        ...timing,
        pausePresets: timing.pausePresets.map((preset) => ({
          ...preset,
          durationMs: 30_001,
        })),
      }),
    ).toThrow();
    expect(() =>
      SystemTimingConfigurationSchema.parse({
        ...timing,
        transitionPauses: {
          ...timing.transitionPauses,
          paragraph: { mode: "preset", pauseId: "pause_custom" },
        },
      }),
    ).toThrow();
    expect(() =>
      SpeechBackendConnectionAuthoringSchema.parse({
        baseUrl: "http://127.0.0.1:8000",
        defaultModelId: null,
        defaultVoiceId: null,
        apiKey: "secret",
      }),
    ).toThrow();
    expect(() =>
      SpeechBackendConnectionAuthoringSchema.parse({
        baseUrl: "file:///tmp/socket",
        defaultModelId: null,
        defaultVoiceId: null,
      }),
    ).toThrow();
  });

  it("accepts representative persisted product data", () => {
    const speakerMappings = SpeakerMappingCollectionSchema.parse([
      {
        speakerId: "teacher",
        displayName: "Teacher",
        voiceId: "voice_teacher",
        speed: 1,
        gainDb: 0,
        roleDescription: "Guide",
        sampleText: "Welcome",
      },
    ]);
    const lexiconEntries = ProjectLexiconAuthoringCollectionSchema.parse([
      {
        id: "project-resume",
        scope: "project",
        displayText: "resume",
        spokenText: "rez-oo-may",
      },
    ]);

    expect(
      ProjectReplaceInputSchema.parse({
        name: "Persistent project",
        description: "Reopen proof",
        scriptSource: "resume SQL",
        speakerMappings,
        lexiconEntries,
      }),
    ).toBeDefined();
    expect(
      CustomGlobalLexiconReplaceInputSchema.parse([
        {
          id: "global-sql",
          scope: "global",
          entryType: "exactTerm",
          displayText: "SQL",
          spokenText: "sequel",
        },
      ]),
    ).toHaveLength(1);
    expect(
      IgnoredDiagnosticCollectionSchema.parse([
        { code: "MALFORMED_SECTION_DIRECTIVE", pattern: "[section bad]" },
      ]),
    ).toHaveLength(1);
    expect(
      SpeechBackendConnectionAuthoringSchema.parse({
        baseUrl: "http://127.0.0.1:8000",
        defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
        defaultVoiceId: "af_heart",
      }),
    ).toBeDefined();
  });
});

describe("PersistenceStatusSchema", () => {
  const base = {
    contractVersion: 1,
    databasePath: "/tmp/studynarrator/studynarrator.sqlite",
    latestBackupPath: null as string | null,
  };

  it("accepts a ready status where the database version differs from the target (mismatch is reportable)", () => {
    const mismatch = PersistenceStatusSchema.parse({
      ...base,
      state: "ready",
      databaseSchemaVersion: 2,
      targetDatabaseSchemaVersion: 3,
    });
    expect(mismatch.databaseSchemaVersion).toBe(2);
  });

  it("rejects non-positive or missing schema versions in the ready status", () => {
    expect(() =>
      PersistenceStatusSchema.parse({
        ...base,
        state: "ready",
        databaseSchemaVersion: 0,
        targetDatabaseSchemaVersion: 3,
      }),
    ).toThrow();
    expect(() =>
      PersistenceStatusSchema.parse({
        ...base,
        state: "ready",
        databaseSchemaVersion: -1,
        targetDatabaseSchemaVersion: 3,
      }),
    ).toThrow();
  });
});
