import { describe, expect, it } from "vitest";
import type { LexiconEntry } from "./schemas.js";
import { ScriptGenerationBriefSchema, buildExternalLlmPrompt, buildSkillPackageFiles } from "./scriptGeneration.js";

const timestamp = "2026-08-14T00:00:00.000Z";
const entries: LexiconEntry[] = [
  { id: "global-resume", scope: "global", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "rez uh may", caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp },
  { id: "project-resume", scope: "project", entryType: "namedSense", displayText: "resume", senseId: "cv", spokenText: "project résumé", caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp },
  { id: "sql", scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel", caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp },
  { id: "disabled", scope: "project", entryType: "exactTerm", displayText: "SECRET_ALIAS", spokenText: "hidden", caseSensitive: true, wholeWord: true, priority: 0, enabled: false, notes: "", createdAt: timestamp, updatedAt: timestamp }
];

const brief = ScriptGenerationBriefSchema.parse({
  schemaVersion: 1,
  purpose: "Explain database caching accurately.",
  targetAudience: "Backend engineering students",
  detailLevel: "balanced",
  sectionMode: "required",
  codeHandling: "explain",
  additionalGuidance: "End with a short recap.",
  sourceMaterial: "SQL cache source marker.",
  speakers: [
    { speakerId: "teacher", roleDescription: "Explains concepts clearly." },
    { speakerId: "student", roleDescription: "Asks concise questions." }
  ],
  pauses: [{ pauseId: "pause_short", description: "Brief handoff." }]
});

describe("script generation", () => {
  it("builds a stable raw prompt from exact configured IDs and effective aliases", () => {
    const prompt = buildExternalLlmPrompt({ brief, lexiconEntries: entries });
    expect(prompt).toContain("[speaker_teacher]: Explains concepts clearly.");
    expect(prompt).toContain("[pause_short]: Brief handoff.");
    expect(prompt).toContain("{{resume|cv}}: pronounce as “project résumé”.");
    expect(prompt).toContain("SQL → sequel");
    expect(prompt).toContain("SOURCE MATERIAL\nSQL cache source marker.");
    expect(prompt).not.toContain("SECRET_ALIAS");
    expect(prompt).not.toContain("```");
    expect(buildExternalLlmPrompt({ brief, lexiconEntries: entries })).toBe(prompt);
  });

  it("rejects duplicate and invalid configured IDs", () => {
    expect(() => ScriptGenerationBriefSchema.parse({ ...brief, speakers: [...brief.speakers, brief.speakers[0]] })).toThrow(/Duplicate speaker/u);
    expect(() => ScriptGenerationBriefSchema.parse({ ...brief, pauses: [{ pauseId: "bad pause", description: "Invalid" }] })).toThrow();
  });

  it("builds source-free package files and adds a two-speaker example only when valid", () => {
    const { sourceMaterial: _sourceMaterial, ...configuration } = brief;
    void _sourceMaterial;
    const files = buildSkillPackageFiles({ configuration, lexiconEntries: entries });
    expect(files.map(({ path }) => path)).toEqual([
      "SKILL.md", "SCRIPT_FORMAT.md", "LEXICON_ALIASES.md", "examples/single-narrator.txt", "examples/two-speaker-study-guide.txt"
    ]);
    expect(files.map(({ content }) => content).join("\n")).not.toContain(brief.sourceMaterial);
    const single = buildSkillPackageFiles({ configuration: { ...configuration, speakers: [configuration.speakers[0]!] }, lexiconEntries: entries });
    expect(single.map(({ path }) => path)).not.toContain("examples/two-speaker-study-guide.txt");
  });
});
