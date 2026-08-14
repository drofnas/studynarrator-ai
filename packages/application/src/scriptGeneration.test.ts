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
  scriptSource: "",
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

const brief = {
  schemaVersion: 1 as const,
  purpose: "Teach cache invalidation.", targetAudience: "Engineers", detailLevel: "balanced" as const,
  sectionMode: "required" as const, codeHandling: "explain" as const, additionalGuidance: "",
  sourceMaterial: "PRIVATE SOURCE MARKER",
  speakers: [{ speakerId: "teacher", roleDescription: "Explains clearly." }],
  pauses: [{ pauseId: "pause_short", description: "Brief handoff." }]
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
    const document = await service.previewPrompt(project.id, brief);
    expect(document.fileName).toBe("resume-unsafe-project-external-llm-prompt.md");
    expect(document.mimeType).toBe("text/markdown; charset=utf-8");
    expect(document.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(document.content).toContain("PRIVATE SOURCE MARKER");
  });

  it("creates byte-identical ZIPs with safe paths and no source material", async () => {
    const service = createScriptGenerationService({ repository: repository() });
    const { sourceMaterial: _sourceMaterial, ...configuration } = brief;
    void _sourceMaterial;
    const first = await service.resolveSkillPackage(project.id, configuration);
    const second = await service.resolveSkillPackage(project.id, configuration);
    expect(first.fileName).toBe("resume-unsafe-project-script-skill.zip");
    expect(first.bytes).toEqual(second.bytes);
    expect(first.checksum).toBe(second.checksum);
    const files = unzipSync(first.bytes);
    expect(Object.keys(files).sort()).toEqual(["LEXICON_ALIASES.md", "SCRIPT_FORMAT.md", "SKILL.md", "examples/single-narrator.txt"].sort());
    expect(Object.values(files).map((bytes) => strFromU8(bytes)).join("\n")).not.toContain(brief.sourceMaterial);
    expect(Object.keys(files).every((path) => !path.includes("..") && !path.startsWith("/"))).toBe(true);
  });

  it("sanitizes repository failures", async () => {
    const missing = { getProject: vi.fn(() => { throw Object.assign(new Error("secret path"), { code: "PERSISTENCE_NOT_FOUND" }); }), listGlobalLexicon: vi.fn(() => []) };
    const service = createScriptGenerationService({ repository: missing });
    await expect(service.previewPrompt(project.id, brief)).rejects.toMatchObject({ code: "SCRIPT_GENERATION_NOT_FOUND", message: "The requested project does not exist." });
  });
});
