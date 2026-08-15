import { z } from "zod";
import { ScriptPromptKindSchema } from "@studynarrator/core";
import { ProjectIdSchema } from "./persistence.js";

export const SCRIPT_GENERATION_CHANNELS = Object.freeze({
  previewPrompt: "script-generation.preview-prompt",
  exportPrompt: "script-generation.export-prompt",
  exportSkillPackage: "script-generation.export-skill-package"
} as const);

export const PromptDocumentSchema = z.object({
  kind: ScriptPromptKindSchema,
  fileName: z.string().min(1).max(255),
  mimeType: z.literal("text/markdown; charset=utf-8"),
  content: z.string().min(1),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict();
export type PromptDocument = z.infer<typeof PromptDocumentSchema>;

export const FileExportResultSchema = z.object({
  disposition: z.enum(["download", "saved", "canceled"]),
  fileName: z.string().min(1).max(255)
}).strict();
type FileExportResult = z.infer<typeof FileExportResultSchema>;

export const ScriptGenerationPromptRequestSchema = z.object({
  projectId: ProjectIdSchema.nullable(),
  kind: ScriptPromptKindSchema
}).strict();

export const ScriptGenerationPromptInputSchema = z.object({ kind: ScriptPromptKindSchema }).strict();

export const ScriptGenerationSkillRequestSchema = z.object({ projectId: ProjectIdSchema.nullable() }).strict();
export const ScriptGenerationSkillInputSchema = z.object({}).strict();

export interface ScriptGenerationClient {
  previewPrompt(projectId: string | null, kind: z.infer<typeof ScriptPromptKindSchema>): Promise<PromptDocument>;
  exportPrompt(projectId: string | null, kind: z.infer<typeof ScriptPromptKindSchema>): Promise<FileExportResult>;
  exportSkillPackage(projectId: string | null): Promise<FileExportResult>;
}

export { ScriptPromptKindSchema };
export type { ScriptPromptKind } from "@studynarrator/core";
