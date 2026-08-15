import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import {
  SCRIPT_GENERATION_SCHEMA_VERSION,
  ScriptGenerationContextSchema,
  ScriptPromptKindSchema,
  buildExternalLlmPrompt,
  buildSkillPackageFiles,
  type LexiconEntry,
  type ScriptGenerationContext,
  type ScriptPromptKind
} from "@studynarrator/core";
import {
  PromptDocumentSchema,
  ProjectIdSchema,
  type PromptDocument,
  type ProjectDetail,
  type SystemTimingConfiguration
} from "@studynarrator/shared-types";
import type { PersistenceRepository } from "./persistence.js";

type ScriptGenerationServiceErrorCode = "SCRIPT_GENERATION_NOT_FOUND" | "SCRIPT_GENERATION_STORAGE";

class ScriptGenerationServiceError extends Error {
  constructor(readonly code: ScriptGenerationServiceErrorCode, message: string) { super(message); }
}

export type ScriptGenerationRepository = Pick<PersistenceRepository, "getProject" | "getSystemPacing" | "listGlobalLexicon">;

interface ResolvedGeneratedFile {
  fileName: string;
  mimeType: "text/markdown; charset=utf-8" | "application/zip";
  bytes: Uint8Array;
  checksum: string;
}

export interface ScriptGenerationService {
  previewPrompt(projectId: string | null, kind: ScriptPromptKind): Promise<PromptDocument>;
  resolvePromptExport(projectId: string | null, kind: ScriptPromptKind): Promise<ResolvedGeneratedFile>;
  resolveSkillPackage(projectId: string | null): Promise<ResolvedGeneratedFile>;
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

function generationContext(timing: SystemTimingConfiguration, project?: ProjectDetail): ScriptGenerationContext {
  return ScriptGenerationContextSchema.parse({
    schemaVersion: SCRIPT_GENERATION_SCHEMA_VERSION,
    projectName: project?.name ?? "StudyNarrator",
    speakers: project && project.speakerMappings.length > 0
      ? project.speakerMappings.map(({ speakerId, displayName, roleDescription }) => ({
        speakerId,
        roleDescription: roleDescription.trim() || `${displayName} contributes clear spoken explanations.`
      }))
      : [{ speakerId: "narrator", roleDescription: "Explains the material clearly and accurately." }],
    pauses: timing.pausePresets.map(({ pauseId, durationMs, description }) => ({
      pauseId,
      description: description.trim() || `${String(durationMs)} millisecond pause.`
    }))
  });
}

function promptDocument(timing: SystemTimingConfiguration, project: ProjectDetail | undefined, kind: ScriptPromptKind, entries: readonly LexiconEntry[]): PromptDocument {
  const content = buildExternalLlmPrompt({ kind, context: generationContext(timing, project), lexiconEntries: entries });
  return PromptDocumentSchema.parse({
    kind,
    fileName: `${slug(project?.name ?? "StudyNarrator")}-${kind}-prompt.md`,
    mimeType: "text/markdown; charset=utf-8",
    content,
    checksum: sha256(content)
  });
}

export function createScriptGenerationService(dependencies: { repository: ScriptGenerationRepository }): ScriptGenerationService {
  const load = (projectIdInput: string | null): { project?: ProjectDetail; timing: SystemTimingConfiguration; entries: LexiconEntry[] } => {
    const timing = dependencies.repository.getSystemPacing();
    if (projectIdInput === null) return { timing, entries: [...dependencies.repository.listGlobalLexicon()] };
    const project = dependencies.repository.getProject(ProjectIdSchema.parse(projectIdInput));
    return { project, timing, entries: lexicon(dependencies.repository, project) };
  };
  return {
    async previewPrompt(projectIdInput, kindInput) {
      try {
        const kind = ScriptPromptKindSchema.parse(kindInput);
        const { project, timing, entries } = load(projectIdInput);
        return await Promise.resolve(promptDocument(timing, project, kind, entries));
      } catch (error) { throw safeError(error); }
    },
    async resolvePromptExport(projectIdInput, kindInput) {
      try {
        const kind = ScriptPromptKindSchema.parse(kindInput);
        const { project, timing, entries } = load(projectIdInput);
        const document = promptDocument(timing, project, kind, entries);
        const bytes = strToU8(document.content);
        return await Promise.resolve({ fileName: document.fileName, mimeType: document.mimeType, bytes, checksum: document.checksum });
      } catch (error) { throw safeError(error); }
    },
    async resolveSkillPackage(projectIdInput) {
      try {
        const { project, timing, entries } = load(projectIdInput);
        const archiveEntries: Record<string, [Uint8Array, { mtime: Date }]> = {};
        for (const file of buildSkillPackageFiles({ context: generationContext(timing, project), lexiconEntries: entries })) {
          archiveEntries[file.path] = [strToU8(file.content), { mtime: new Date(1980, 0, 1, 0, 0, 0, 0) }];
        }
        const bytes = zipSync(archiveEntries, { level: 9 });
        return await Promise.resolve({
          fileName: `${slug(project?.name ?? "StudyNarrator")}-script-skill.zip`,
          mimeType: "application/zip" as const,
          bytes,
          checksum: sha256(bytes)
        });
      } catch (error) { throw safeError(error); }
    }
  };
}
