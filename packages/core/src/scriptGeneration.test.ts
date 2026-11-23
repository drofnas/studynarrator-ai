import { describe, expect, it } from "vitest";
import { parseScript } from "./parser.js";
import type { LexiconEntry } from "./schemas.js";
import {
  ScriptGenerationContextSchema,
  buildExternalLlmPrompt,
  buildSkillPackageFiles,
} from "./scriptGeneration.js";

const timestamp = "2026-08-14T00:00:00.000Z";
const entries: LexiconEntry[] = [
  {
    id: "global-resume",
    scope: "global",
    entryType: "namedSense",
    displayText: "resume",
    senseId: "cv",
    spokenText: "rez uh may",
    caseSensitive: true,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "project-resume",
    scope: "project",
    entryType: "namedSense",
    displayText: "resume",
    senseId: "cv",
    spokenText: "project résumé",
    caseSensitive: true,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "sql",
    scope: "project",
    entryType: "exactTerm",
    displayText: "SQL",
    spokenText: "sequel",
    caseSensitive: true,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "disabled",
    scope: "project",
    entryType: "exactTerm",
    displayText: "SECRET_ALIAS",
    spokenText: "hidden",
    caseSensitive: true,
    wholeWord: true,
    priority: 0,
    enabled: false,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

const context = ScriptGenerationContextSchema.parse({
  schemaVersion: 1,
  projectName: "Caching guide",
  speakers: [
    { speakerId: "teacher", roleDescription: "Explains concepts clearly." },
    { speakerId: "student", roleDescription: "Asks concise questions." },
  ],
  pauses: [{ pauseId: "pause_short", description: "Brief handoff." }],
});

describe("script generation", () => {
  it("builds the fixed creation instructions with every user-input question", () => {
    const prompt = buildExternalLlmPrompt({
      kind: "creation",
      context,
      lexiconEntries: entries,
    });
    expect(prompt).toContain("# StudyNarrator AI Script Creation Instructions");
    expect(prompt).toContain("## PRIMARY GOAL");
    expect(prompt).toContain("# USER INPUT");
    expect(prompt).toContain(
      "## Topic or material to teach\n\n[WHAT SHOULD THE SCRIPT TEACH?]",
    );
    expect(prompt).toContain("## Learning goals or questions");
    expect(prompt).toContain("## Audience and existing knowledge");
    expect(prompt).toContain("## Desired depth, length, or emphasis");
    expect(prompt).toContain("## Required topics, facts, or constraints");
    expect(prompt).toContain("## Research requirements");
    expect(
      prompt
        .trimEnd()
        .endsWith(
          "## Source material\n\n[PASTE SOURCE MATERIAL HERE AND/OR ATTACH RELEVANT FILES TO THE CONVERSATION.]",
        ),
    ).toBe(true);
    expect(prompt).toContain("`resume/cv` — a résumé or career document.");
    expect(prompt).toContain("[speaker_narrator]");
    expect(prompt).not.toContain("[speaker_teacher]");
    expect(prompt).not.toContain("SQL → sequel");
    expect(prompt).not.toContain("{{resume|cv}}");
    expect(prompt).not.toContain("import/noun");
    expect(prompt).not.toContain("import/verb");
    expect(prompt).not.toContain("KNOWLEDGE TO GATHER AND TEACH");
    expect(prompt).not.toContain("SECRET_ALIAS");
    expect(prompt).not.toContain("```");
    expect(
      buildExternalLlmPrompt({
        kind: "creation",
        context,
        lexiconEntries: entries,
      }),
    ).toBe(prompt);
  });

  it("builds the fixed update instructions with the three handoff sections", () => {
    const prompt = buildExternalLlmPrompt({
      kind: "update",
      context,
      lexiconEntries: entries,
    });
    expect(prompt).toContain("# StudyNarrator AI Script Update Instructions");
    expect(prompt).toContain("## UPDATE RULES");
    expect(prompt).toContain(
      "## Requested changes\n\n[DESCRIBE WHAT SHOULD BE ADDED, REMOVED, CORRECTED, EXPANDED, OR REORGANIZED.]",
    );
    expect(prompt).toContain(
      "## Current StudyNarrator AI script\n\n[PASTE THE CURRENT SCRIPT HERE AND/OR ATTACH IT TO THE CONVERSATION.]",
    );
    expect(
      prompt
        .trimEnd()
        .endsWith(
          "## Additional requirements or source material\n\n[OPTIONAL — PROVIDE FACTS, RESEARCH, SOURCE MATERIAL, CONSTRAINTS, OR ATTACH RELEVANT FILES.]",
        ),
    ).toBe(true);
    expect(prompt).toContain("`resume/cv` — a résumé or career document.");
    expect(prompt).toContain("`[speaker_<id>|<voice_id>]`");
    expect(prompt).toContain("do not rename an existing speaker");
    expect(prompt).toContain("You may add new speakers");
    expect(prompt).toContain("[pause_short]");
    expect(prompt).toContain("[section: Descriptive title]");
    expect(prompt).not.toContain("[speaker_student]");
    expect(prompt).not.toContain("SQL → sequel");
    expect(prompt).not.toContain("import/noun");
    expect(prompt).not.toContain("import/verb");
    expect(prompt).not.toContain("KNOWLEDGE TO GATHER AND TEACH");
    expect(prompt).not.toContain("Convert the existing study guide");
  });

  it("allows any number of speakers and offers the supplied voices", () => {
    const voices = [
      { voiceId: "af_heart", language: "American English" },
      { voiceId: "am_adam", language: "American English" },
      { voiceId: "bm_george", language: "British English" },
    ];
    for (const kind of ["creation", "update"] as const) {
      const prompt = buildExternalLlmPrompt({
        kind,
        context,
        lexiconEntries: entries,
        voices,
      });
      expect(prompt).toContain(
        "A script can use as many speakers as it needs.",
      );
      expect(prompt).not.toContain("Do not invent additional speaker IDs");
      expect(prompt).not.toContain("Use only configured speaker IDs");
      expect(prompt).not.toContain("speaker IDs, or unsupported details");
      expect(prompt).toContain("Kokoro 82M v1.0 ONNX");
      expect(prompt).toContain(
        "- American English: `af_heart`, `am_adam`\n- British English: `bm_george`",
      );
      expect(prompt).toContain("Do not invent voice IDs.");
      expect(prompt).not.toContain("[speaker_teacher]");
      expect(prompt).not.toContain("[speaker_student]");
    }
  });

  it("asks for user-named voices when no voice list is supplied", () => {
    const prompt = buildExternalLlmPrompt({
      kind: "creation",
      context,
      lexiconEntries: entries,
    });
    expect(prompt).toContain(
      "Use a voice ID only if the user input names one.",
    );
    expect(prompt).not.toContain("Available voices:");
    expect(prompt).toContain("## Speakers and voices");
  });

  it("teaches a multi-speaker example the parser accepts without diagnostics", () => {
    const prompt = buildExternalLlmPrompt({
      kind: "creation",
      context,
      lexiconEntries: entries,
    });
    const example = prompt
      .split("\n")
      .filter((line) => /^\[speaker_(?:host|guest)[|\]]/u.test(line))
      .join("\n\n");
    expect(example.split("\n\n")).toHaveLength(4);
    const result = parseScript({ source: example });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(
      result.discoveries.speakers.map(({ id, voiceHint }) => ({
        id,
        voiceHint,
      })),
    ).toEqual([
      { id: "host", voiceHint: "af_heart" },
      { id: "guest", voiceHint: "bm_george" },
    ]);
  });

  it("rejects malformed voice lists", () => {
    expect(() =>
      buildExternalLlmPrompt({
        kind: "creation",
        context,
        lexiconEntries: entries,
        voices: [{ voiceId: "bad voice", language: "English" }],
      }),
    ).toThrow();
  });

  it("rejects duplicate and invalid project-derived IDs", () => {
    expect(() =>
      ScriptGenerationContextSchema.parse({
        ...context,
        speakers: [...context.speakers, context.speakers[0]],
      }),
    ).toThrow(/Duplicate speaker/u);
    expect(() =>
      ScriptGenerationContextSchema.parse({
        ...context,
        pauses: [{ pauseId: "bad pause", description: "Invalid" }],
      }),
    ).toThrow();
  });

  it("builds a source-free package containing both reusable prompts", () => {
    const files = buildSkillPackageFiles({ context, lexiconEntries: entries });
    expect(files.map(({ path }) => path)).toEqual([
      "SKILL.md",
      "CREATION_PROMPT.md",
      "UPDATE_PROMPT.md",
      "SCRIPT_FORMAT.md",
      "LEXICON_ALIASES.md",
      "examples/single-narrator.txt",
      "examples/two-speaker-study-guide.txt",
    ]);
    const combined = files.map(({ content }) => content).join("\n");
    expect(combined).toContain(
      "# StudyNarrator AI Script Creation Instructions",
    );
    expect(combined).toContain("# StudyNarrator AI Script Update Instructions");
    expect(combined).toContain("[WHAT SHOULD THE SCRIPT TEACH?]");
    expect(combined).toContain(
      "[DESCRIBE WHAT SHOULD BE ADDED, REMOVED, CORRECTED, EXPANDED, OR REORGANIZED.]",
    );
    expect(combined).not.toContain("SECRET_ALIAS");
    const update = files.find(({ path }) => path === "UPDATE_PROMPT.md");
    expect(update?.content).not.toContain("SQL → sequel");
    expect(update?.content).not.toContain("[speaker_teacher]");
    const single = buildSkillPackageFiles({
      context: { ...context, speakers: [context.speakers[0]!] },
      lexiconEntries: entries,
    });
    expect(single.map(({ path }) => path)).not.toContain(
      "examples/two-speaker-study-guide.txt",
    );
    const format = buildSkillPackageFiles({
      context,
      lexiconEntries: entries,
      voices: [{ voiceId: "af_heart", language: "American English" }],
    }).find(({ path }) => path === "SCRIPT_FORMAT.md")?.content;
    expect(format).toContain("A script can use as many speakers as it needs.");
    expect(format).toContain("Add new speakers when the script needs them.");
    expect(format).toContain("- American English: `af_heart`");
    expect(format).not.toContain(
      "Use only these configured speaker directives",
    );
  });
});
