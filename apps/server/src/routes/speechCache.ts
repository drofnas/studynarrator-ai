import { Router } from "express";
import {
  ProjectIdSchema,
  SpeechCacheCleanupResultSchema,
  SpeechCacheKeyInputSchema,
  SpeechCacheStatusSchema,
  type SpeechCacheClient,
} from "@studynarrator/shared-types";
import { asyncHandler } from "../asyncHandler.js";

export function createSpeechCacheRouter(
  speechCache: SpeechCacheClient | undefined,
  router: Router = Router(),
): Router {
  if (speechCache) {
    router.get(
      "/api/speech-cache",
      asyncHandler(async (_request, response) => {
        response.json(
          SpeechCacheStatusSchema.parse(await speechCache.status()),
        );
      }),
    );
    router.delete(
      "/api/speech-cache",
      asyncHandler(async (_request, response) => {
        response.json(
          SpeechCacheCleanupResultSchema.parse(await speechCache.clearAll()),
        );
      }),
    );
    router.delete(
      "/api/projects/:projectId/speech-cache",
      asyncHandler(async (request, response) => {
        response.json(
          SpeechCacheCleanupResultSchema.parse(
            await speechCache.clearProject(
              ProjectIdSchema.parse(request.params.projectId),
            ),
          ),
        );
      }),
    );
    router.delete(
      "/api/speech-cache/:cacheKey",
      asyncHandler(async (request, response) => {
        const { cacheKey } = SpeechCacheKeyInputSchema.parse(request.params);
        response.json(
          SpeechCacheCleanupResultSchema.parse(
            await speechCache.clearEntry(cacheKey),
          ),
        );
      }),
    );
  }

  return router;
}
