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
  it("builds the fixed creation instructions with every user-input question", () => {
    const prompt = buildExternalLlmPrompt({ kind: "creation", context, lexiconEntries: entries });
    expect(prompt).toContain("# StudyNarrator Script Creation Instructions");
    expect(prompt).toContain("## PRIMARY GOAL");
    expect(prompt).toContain("# USER INPUT");
    expect(prompt).toContain("## Topic or material to teach\n\n[WHAT SHOULD THE SCRIPT TEACH?]");
    expect(prompt).toContain("## Learning goals or questions");
    expect(prompt).toContain("## Audience and existing knowledge");
    expect(prompt).toContain("## Desired depth, length, or emphasis");
    expect(prompt).toContain("## Required topics, facts, or constraints");
    expect(prompt).toContain("## Research requirements");
    expect(prompt.trimEnd().endsWith("## Source material\n\n[PASTE SOURCE MATERIAL HERE AND/OR ATTACH RELEVANT FILES TO THE CONVERSATION.]")).toBe(true);
    expect(prompt).toContain("`resume/cv` — a résumé or career document.");
    expect(prompt).toContain("[speaker_narrator]");
    expect(prompt).not.toContain("[speaker_teacher]");
    expect(prompt).not.toContain("SQL → sequel");
    expect(prompt).not.toContain("{{resume|cv}}");
    expect(prompt).not.toContain("KNOWLEDGE TO GATHER AND TEACH");
    expect(prompt).not.toContain("SECRET_ALIAS");
    expect(prompt).not.toContain("```");
    expect(buildExternalLlmPrompt({ kind: "creation", context, lexiconEntries: entries })).toBe(prompt);
  });

  it("builds the fixed update instructions with the three handoff sections", () => {
    const prompt = buildExternalLlmPrompt({ kind: "update", context, lexiconEntries: entries });
    expect(prompt).toContain("# StudyNarrator Script Update Instructions");
    expect(prompt).toContain("## UPDATE RULES");
    expect(prompt).toContain("## Requested changes\n\n[DESCRIBE WHAT SHOULD BE ADDED, REMOVED, CORRECTED, EXPANDED, OR REORGANIZED.]");
    expect(prompt).toContain("## Current StudyNarrator script\n\n[PASTE THE CURRENT SCRIPT HERE AND/OR ATTACH IT TO THE CONVERSATION.]");
    expect(prompt.trimEnd().endsWith("## Additional requirements or source material\n\n[OPTIONAL — PROVIDE FACTS, RESEARCH, SOURCE MATERIAL, CONSTRAINTS, OR ATTACH RELEVANT FILES.]")).toBe(true);
    expect(prompt).toContain("`resume/cv` — a résumé or career document.");
    expect(prompt).toContain("[speaker_narrator]");
    expect(prompt).toContain("[pause_short]");
    expect(prompt).toContain("[section: Descriptive title]");
    expect(prompt).not.toContain("[speaker_student]");
    expect(prompt).not.toContain("SQL → sequel");
    expect(prompt).not.toContain("KNOWLEDGE TO GATHER AND TEACH");
    expect(prompt).not.toContain("Convert the existing study guide");
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
    expect(combined).toContain("# StudyNarrator Script Creation Instructions");
    expect(combined).toContain("# StudyNarrator Script Update Instructions");
    expect(combined).toContain("[WHAT SHOULD THE SCRIPT TEACH?]");
    expect(combined).toContain("[DESCRIBE WHAT SHOULD BE ADDED, REMOVED, CORRECTED, EXPANDED, OR REORGANIZED.]");
    expect(combined).not.toContain("SECRET_ALIAS");
    const update = files.find(({ path }) => path === "UPDATE_PROMPT.md");
    expect(update?.content).not.toContain("SQL → sequel");
    expect(update?.content).not.toContain("[speaker_teacher]");
    const single = buildSkillPackageFiles({ context: { ...context, speakers: [context.speakers[0]!] }, lexiconEntries: entries });
    expect(single.map(({ path }) => path)).not.toContain("examples/two-speaker-study-guide.txt");
  });
});
