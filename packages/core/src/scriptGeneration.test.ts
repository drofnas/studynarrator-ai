import { describe, expect, it } from "vitest";
import type { LexiconEntry } from "./schemas.js";
import { ScriptGenerationContextSchema, buildExternalLlmPrompt, buildSkillPackageFiles } from "./scriptGeneration.js";

const timestamp = "2026-08-14T00:00:00.000Z";
const entries: LexiconEntry[] = [
  { id: "global-resume", scope: "global", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "rez uh may", caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp },
  { id: "project-resume", scope: "project", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "project résumé", caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp },
  { id: "sql", scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel", caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp },
  { id: "disabled", scope: "project", entryType: "exactTerm", displayText: "SECRET_ALIAS", spokenText: "hidden", caseSensitive: true, wholeWord: true, priority: 0, enabled: false, notes: "", createdAt: timestamp, updatedAt: timestamp }
];

const context = ScriptGenerationContextSchema.parse({
  schemaVersion: 1,
  projectName: "Caching guide",
  speakers: [
    { speakerId: "teacher", roleDescription: "Explains concepts clearly." },
    { speakerId: "student", roleDescription: "Asks concise questions." }
  ],
  pauses: [{ pauseId: "pause_short", description: "Brief handoff." }]
});

describe("script generation", () => {
  it("builds a stable creation boilerplate with a knowledge-input block and project lexicon", () => {
    const prompt = buildExternalLlmPrompt({ kind: "creation", context, lexiconEntries: entries });
    expect(prompt).toContain("KNOWLEDGE TO GATHER AND TEACH");
    expect(prompt).toContain("[REPLACE THIS BLOCK WITH THE TOPIC");
    expect(prompt).toContain("[speaker_teacher]: Explains concepts clearly.");
    expect(prompt).toContain("[pause_short]: Brief handoff.");
    expect(prompt).toContain("{{resume|cv}}: pronounce as “project résumé”.");
    expect(prompt).toContain("SQL → sequel");
    expect(prompt).toContain("{{display text|new_sense_id}}");
    expect(prompt).toContain("StudyNarrator will detect the new sense during import");
    expect(prompt).not.toContain("SECRET_ALIAS");
    expect(prompt).not.toContain("```");
    expect(buildExternalLlmPrompt({ kind: "creation", context, lexiconEntries: entries })).toBe(prompt);
  });

  it("builds a study-guide conversion prompt with structure directives and a final insertion placeholder", () => {
    const prompt = buildExternalLlmPrompt({ kind: "update", context, lexiconEntries: entries });
    expect(prompt).toContain("# StudyNarrator study guide conversion instructions");
    expect(prompt).toContain("Convert the existing study guide");
    expect(prompt).toContain("AUDIO SCRIPT GOALS");
    expect(prompt).toContain("[speaker_student]");
    expect(prompt).toContain("[pause_short]");
    expect(prompt).toContain("[section: Descriptive title]");
    expect(prompt.trimEnd().endsWith("[INSERT EXISTING SCRIPT]")).toBe(true);
    expect(prompt).not.toContain("Pronunciation lexicon");
    expect(prompt).not.toContain("SQL → sequel");
    expect(prompt).not.toContain("new_sense_id");
    expect(prompt).not.toContain("KNOWLEDGE TO GATHER AND TEACH");
  });

  it("rejects duplicate and invalid project-derived IDs", () => {
    expect(() => ScriptGenerationContextSchema.parse({ ...context, speakers: [...context.speakers, context.speakers[0]] })).toThrow(/Duplicate speaker/u);
    expect(() => ScriptGenerationContextSchema.parse({ ...context, pauses: [{ pauseId: "bad pause", description: "Invalid" }] })).toThrow();
  });

  it("builds a source-free package containing both reusable prompts", () => {
    const files = buildSkillPackageFiles({ context, lexiconEntries: entries });
    expect(files.map(({ path }) => path)).toEqual([
      "SKILL.md", "CREATION_PROMPT.md", "UPDATE_PROMPT.md", "SCRIPT_FORMAT.md", "LEXICON_ALIASES.md", "examples/single-narrator.txt", "examples/two-speaker-study-guide.txt"
    ]);
    const combined = files.map(({ content }) => content).join("\n");
    expect(combined).toContain("KNOWLEDGE TO GATHER AND TEACH");
    expect(combined).toContain("[INSERT EXISTING SCRIPT]");
    expect(combined).not.toContain("SECRET_ALIAS");
    const update = files.find(({ path }) => path === "UPDATE_PROMPT.md");
    expect(update?.content).not.toContain("SQL → sequel");
    const single = buildSkillPackageFiles({ context: { ...context, speakers: [context.speakers[0]!] }, lexiconEntries: entries });
    expect(single.map(({ path }) => path)).not.toContain("examples/two-speaker-study-guide.txt");
  });
});
