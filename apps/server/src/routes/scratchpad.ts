import { Router } from "express";
import {
  ScratchpadPreviewInputSchema,
  ScratchpadPreviewResultSchema,
  type ScratchpadClient,
} from "@studynarrator/shared-types";
import { asyncHandler } from "../asyncHandler.js";

export function createScratchpadRouter(
  scratchpad: ScratchpadClient | undefined,
  router: Router = Router(),
): Router {
  if (scratchpad) {
    router.post(
      "/api/scratchpad/preview",
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
            ScratchpadPreviewResultSchema.parse(
              await scratchpad.preview(
                ScratchpadPreviewInputSchema.parse(request.body),
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
