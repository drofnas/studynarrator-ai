import { Router, type Response } from "express";
import {
  ProjectIdSchema,
  ScriptGenerationPromptExportInputSchema,
  ScriptGenerationPromptInputSchema,
  ScriptGenerationSkillInputSchema,
} from "@studynarrator/shared-types";
import type { ScriptGenerationService } from "@studynarrator/application";
import { asyncHandler } from "../asyncHandler.js";

export function createScriptGenerationRouter(
  scriptGeneration: ScriptGenerationService | undefined,
  router: Router = Router(),
): Router {
  if (scriptGeneration) {
    const sendGeneratedFile = (
      response: Response,
      file: Awaited<ReturnType<ScriptGenerationService["resolvePromptExport"]>>,
    ) => {
      response.setHeader("cache-control", "private, no-store");
      response.setHeader("content-type", file.mimeType);
      response.setHeader(
        "content-disposition",
        `attachment; filename="${file.fileName.replace(/["\\\r\n]/gu, "_")}"`,
      );
      response.setHeader("content-length", String(file.bytes.byteLength));
      response.send(Buffer.from(file.bytes));
    };
    router.post(
      "/api/script-generation/prompt-preview",
      asyncHandler(async (request, response) => {
        const input = ScriptGenerationPromptInputSchema.parse(request.body);
        response.json(await scriptGeneration.previewPrompt(null, input.kind));
      }),
    );
    router.post(
      "/api/script-generation/prompt-export",
      asyncHandler(async (request, response) => {
        const input = ScriptGenerationPromptExportInputSchema.parse(
          request.body,
        );
        sendGeneratedFile(
          response,
          await scriptGeneration.resolvePromptExport(
            null,
            input.kind,
            input.content,
          ),
        );
      }),
    );
    router.post(
      "/api/script-generation/skill-export",
      asyncHandler(async (request, response) => {
        ScriptGenerationSkillInputSchema.parse(request.body);
        sendGeneratedFile(
          response,
          await scriptGeneration.resolveSkillPackage(null),
        );
      }),
    );
    router.post(
      "/api/projects/:projectId/prompt-preview",
      asyncHandler(async (request, response) => {
        const input = ScriptGenerationPromptInputSchema.parse(request.body);
        response.json(
          await scriptGeneration.previewPrompt(
            ProjectIdSchema.parse(request.params.projectId),
            input.kind,
          ),
        );
      }),
    );
    router.post(
      "/api/projects/:projectId/prompt-export",
      asyncHandler(async (request, response) => {
        const input = ScriptGenerationPromptExportInputSchema.parse(
          request.body,
        );
        sendGeneratedFile(
          response,
          await scriptGeneration.resolvePromptExport(
            ProjectIdSchema.parse(request.params.projectId),
            input.kind,
            input.content,
          ),
        );
      }),
    );
    router.post(
      "/api/projects/:projectId/skill-export",
      asyncHandler(async (request, response) => {
        ScriptGenerationSkillInputSchema.parse(request.body);
        sendGeneratedFile(
          response,
          await scriptGeneration.resolveSkillPackage(
            ProjectIdSchema.parse(request.params.projectId),
          ),
        );
      }),
    );
  }

  return router;
}
