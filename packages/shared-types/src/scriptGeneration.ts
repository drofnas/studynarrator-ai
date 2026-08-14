import { z } from "zod";
import { ScriptGenerationBriefSchema, ScriptGenerationConfigurationSchema } from "@studynarrator/core";
import { ProjectIdSchema } from "./persistence.js";

export const SCRIPT_GENERATION_CHANNELS = Object.freeze({
  previewPrompt: "script-generation.preview-prompt",
  exportPrompt: "script-generation.export-prompt",
  exportSkillPackage: "script-generation.export-skill-package"
} as const);

export const PromptDocumentSchema = z.object({
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
export type FileExportResult = z.infer<typeof FileExportResultSchema>;

export const ScriptGenerationPromptRequestSchema = z.object({
  projectId: ProjectIdSchema,
  brief: ScriptGenerationBriefSchema
}).strict();

export const ScriptGenerationSkillRequestSchema = z.object({
  projectId: ProjectIdSchema,
  configuration: ScriptGenerationConfigurationSchema
}).strict();

export interface ScriptGenerationClient {
  previewPrompt(projectId: string, brief: z.infer<typeof ScriptGenerationBriefSchema>): Promise<PromptDocument>;
  exportPrompt(projectId: string, brief: z.infer<typeof ScriptGenerationBriefSchema>): Promise<FileExportResult>;
  exportSkillPackage(projectId: string, configuration: z.infer<typeof ScriptGenerationConfigurationSchema>): Promise<FileExportResult>;
}

export { ScriptGenerationBriefSchema, ScriptGenerationConfigurationSchema };
export type { ScriptGenerationBrief, ScriptGenerationConfiguration } from "@studynarrator/core";
