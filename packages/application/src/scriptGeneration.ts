import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import {
  ScriptGenerationBriefSchema,
  ScriptGenerationConfigurationSchema,
  buildExternalLlmPrompt,
  buildSkillPackageFiles,
  type LexiconEntry
} from "@studynarrator/core";
import {
  PromptDocumentSchema,
  ProjectIdSchema,
  type PromptDocument,
  type ProjectDetail,
  type ScriptGenerationBrief,
  type ScriptGenerationConfiguration
} from "@studynarrator/shared-types";
import type { PersistenceRepository } from "./persistence.js";

export type ScriptGenerationServiceErrorCode = "SCRIPT_GENERATION_NOT_FOUND" | "SCRIPT_GENERATION_STORAGE";

export class ScriptGenerationServiceError extends Error {
  constructor(readonly code: ScriptGenerationServiceErrorCode, message: string) { super(message); }
}

export type ScriptGenerationRepository = Pick<PersistenceRepository, "getProject" | "listGlobalLexicon">;

export interface ResolvedGeneratedFile {
  fileName: string;
  mimeType: "text/markdown; charset=utf-8" | "application/zip";
  bytes: Uint8Array;
  checksum: string;
}

export interface ScriptGenerationService {
  previewPrompt(projectId: string, brief: ScriptGenerationBrief): Promise<PromptDocument>;
  resolvePromptExport(projectId: string, brief: ScriptGenerationBrief): Promise<ResolvedGeneratedFile>;
  resolveSkillPackage(projectId: string, configuration: ScriptGenerationConfiguration): Promise<ResolvedGeneratedFile>;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value: string): string {
  const normalized = value.normalize("NFKD").replace(/\p{Mark}/gu, "").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80).replace(/-+$/gu, "");
  return normalized || "study-narrator-project";
}

function safeError(error: unknown): ScriptGenerationServiceError {
  if (error instanceof ScriptGenerationServiceError) return error;
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  if (record?.code === "PERSISTENCE_NOT_FOUND") {
    return new ScriptGenerationServiceError("SCRIPT_GENERATION_NOT_FOUND", "The requested project does not exist.");
  }
  return new ScriptGenerationServiceError("SCRIPT_GENERATION_STORAGE", "StudyNarrator could not generate the requested export.");
}

function lexicon(repository: ScriptGenerationRepository, project: ProjectDetail): LexiconEntry[] {
  return [...repository.listGlobalLexicon(), ...project.lexiconEntries];
}

function promptDocument(project: ProjectDetail, brief: ScriptGenerationBrief, entries: readonly LexiconEntry[]): PromptDocument {
  const content = buildExternalLlmPrompt({ brief, lexiconEntries: entries });
  return PromptDocumentSchema.parse({
    fileName: `${slug(project.name)}-external-llm-prompt.md`,
    mimeType: "text/markdown; charset=utf-8",
    content,
    checksum: sha256(content)
  });
}

export function createScriptGenerationService(dependencies: { repository: ScriptGenerationRepository }): ScriptGenerationService {
  const load = (projectIdInput: string): { project: ProjectDetail; entries: LexiconEntry[] } => {
    const project = dependencies.repository.getProject(ProjectIdSchema.parse(projectIdInput));
    return { project, entries: lexicon(dependencies.repository, project) };
  };
  return {
    async previewPrompt(projectIdInput, briefInput) {
      try {
        const brief = ScriptGenerationBriefSchema.parse(briefInput);
        const { project, entries } = load(projectIdInput);
        return await Promise.resolve(promptDocument(project, brief, entries));
      } catch (error) { throw safeError(error); }
    },
    async resolvePromptExport(projectIdInput, briefInput) {
      try {
        const brief = ScriptGenerationBriefSchema.parse(briefInput);
        const { project, entries } = load(projectIdInput);
        const document = promptDocument(project, brief, entries);
        const bytes = strToU8(document.content);
        return await Promise.resolve({ fileName: document.fileName, mimeType: document.mimeType, bytes, checksum: document.checksum });
      } catch (error) { throw safeError(error); }
    },
    async resolveSkillPackage(projectIdInput, configurationInput) {
      try {
        const configuration = ScriptGenerationConfigurationSchema.parse(configurationInput);
        const { project, entries } = load(projectIdInput);
        const archiveEntries: Record<string, [Uint8Array, { mtime: Date }]> = {};
        for (const file of buildSkillPackageFiles({ configuration, lexiconEntries: entries })) {
          archiveEntries[file.path] = [strToU8(file.content), { mtime: new Date(1980, 0, 1, 0, 0, 0, 0) }];
        }
        const bytes = zipSync(archiveEntries, { level: 9 });
        return await Promise.resolve({
          fileName: `${slug(project.name)}-script-skill.zip`,
          mimeType: "application/zip" as const,
          bytes,
          checksum: sha256(bytes)
        });
      } catch (error) { throw safeError(error); }
    }
  };
}
