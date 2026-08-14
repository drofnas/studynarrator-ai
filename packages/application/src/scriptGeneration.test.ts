import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import type { ProjectDetail } from "@studynarrator/shared-types";
import { createScriptGenerationService, type ScriptGenerationRepository } from "./scriptGeneration.js";
import { APPLICATION_SERVICE_MANIFEST } from "./serviceManifest.js";

const timestamp = "2026-08-14T00:00:00.000Z";
const project: ProjectDetail = {
  contractVersion: 4,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Résumé / unsafe project",
  description: "",
  scriptSource: "PRIVATE SOURCE MARKER",
  scriptHash: "a".repeat(64),
  connectionProfileId: null,
  modelId: null,
  speakerMappings: [],
  pausePresets: [],
  transitionPauses: { paragraph: { mode: "none" }, speakerChange: { mode: "none" }, section: { mode: "none" } },
  lexiconEntries: [{ id: "sql", scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel", caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp }],
  createdAt: timestamp,
  updatedAt: timestamp
};

function repository(): ScriptGenerationRepository {
  return { getProject: vi.fn(() => project), listGlobalLexicon: vi.fn(() => []) };
}

describe("script generation service", () => {
  it("matches the public application-service manifest", () => {
    expect(APPLICATION_SERVICE_MANIFEST.filter((path) => path.startsWith("scriptGeneration."))).toEqual([
      "scriptGeneration.previewPrompt", "scriptGeneration.exportPrompt", "scriptGeneration.exportSkillPackage"
    ]);
  });
  it("returns a checksummed, sanitized prompt document", async () => {
    const service = createScriptGenerationService({ repository: repository() });
    const document = await service.previewPrompt(project.id, "creation");
    expect(document.kind).toBe("creation");
    expect(document.fileName).toBe("resume-unsafe-project-creation-prompt.md");
    expect(document.mimeType).toBe("text/markdown; charset=utf-8");
    expect(document.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(document.content).toContain("KNOWLEDGE TO GATHER AND TEACH");
    expect(document.content).not.toContain(project.scriptSource);
    const update = await service.previewPrompt(project.id, "update");
    expect(update).toMatchObject({ kind: "update", fileName: "resume-unsafe-project-update-prompt.md" });
    expect(update.content).toContain("SCRIPT AND CHANGE REQUEST");
  });

  it("builds a default prompt kit from global lexicon without loading a project", async () => {
    const getProject = vi.fn(() => project);
    const globalSql = { ...project.lexiconEntries[0]!, id: "global-sql", scope: "global" as const };
    const service = createScriptGenerationService({ repository: { getProject, listGlobalLexicon: vi.fn(() => [globalSql]) } });
    const document = await service.previewPrompt(null, "creation");
    expect(document.fileName).toBe("studynarrator-creation-prompt.md");
    expect(document.content).toContain("[speaker_narrator]");
    expect(document.content).toContain("[pause_medium]");
    expect(document.content).toContain("SQL → sequel");
    expect(getProject).not.toHaveBeenCalled();
    await expect(service.resolveSkillPackage(null)).resolves.toMatchObject({ fileName: "studynarrator-script-skill.zip" });
  });

  it("creates byte-identical ZIPs with both prompts, safe paths, and no saved script", async () => {
    const service = createScriptGenerationService({ repository: repository() });
    const first = await service.resolveSkillPackage(project.id);
    const second = await service.resolveSkillPackage(project.id);
    expect(first.fileName).toBe("resume-unsafe-project-script-skill.zip");
    expect(first.bytes).toEqual(second.bytes);
    expect(first.checksum).toBe(second.checksum);
    const files = unzipSync(first.bytes);
    expect(Object.keys(files).sort()).toEqual(["CREATION_PROMPT.md", "LEXICON_ALIASES.md", "SCRIPT_FORMAT.md", "SKILL.md", "UPDATE_PROMPT.md", "examples/single-narrator.txt"].sort());
    expect(Object.values(files).map((bytes) => strFromU8(bytes)).join("\n")).not.toContain(project.scriptSource);
    expect(Object.keys(files).every((path) => !path.includes("..") && !path.startsWith("/"))).toBe(true);
  });

  it("sanitizes repository failures", async () => {
    const missing = { getProject: vi.fn(() => { throw Object.assign(new Error("secret path"), { code: "PERSISTENCE_NOT_FOUND" }); }), listGlobalLexicon: vi.fn(() => []) };
    const service = createScriptGenerationService({ repository: missing });
    await expect(service.previewPrompt(project.id, "creation")).rejects.toMatchObject({ code: "SCRIPT_GENERATION_NOT_FOUND", message: "The requested project does not exist." });
  });
});
