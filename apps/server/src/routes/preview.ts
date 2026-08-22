import { Router } from "express";
import {
  ProjectIdSchema,
  ProjectPreviewInputSchema,
  ProjectPreviewResultSchema,
  type ProjectPreviewClient,
} from "@studynarrator/shared-types";
import { asyncHandler } from "../asyncHandler.js";

export function createPreviewRouter(
  projectPreview: ProjectPreviewClient | undefined,
  router: Router = Router(),
): Router {
  if (projectPreview) {
    router.post(
      "/api/projects/:projectId/preview",
      asyncHandler(async (request, response) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        request.once("aborted", abort);
        const abortIfDisconnected = () => {
          if (!response.writableEnded) abort();
        };
        response.once("close", abortIfDisconnected);
        try {
          response.json(
            ProjectPreviewResultSchema.parse(
              await projectPreview.preview(
                ProjectIdSchema.parse(request.params.projectId),
                ProjectPreviewInputSchema.parse(request.body),
                controller.signal,
              ),
            ),
          );
        } finally {
          request.off("aborted", abort);
          response.off("close", abortIfDisconnected);
        }
      }),
    );
  }

  return router;
}
