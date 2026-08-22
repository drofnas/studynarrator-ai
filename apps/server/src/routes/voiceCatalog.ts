import { Router, type RequestHandler } from "express";
import {
  VoiceCatalogModelInputSchema,
  VoiceCatalogSchema,
  type VoiceCatalogClient,
} from "@studynarrator/shared-types";
import { asyncHandler } from "../asyncHandler.js";

export function createVoiceCatalogRouter(
  voiceCatalog: VoiceCatalogClient | undefined,
  persistenceUnavailable: RequestHandler,
  router: Router = Router(),
): Router {
  if (voiceCatalog) {
    router.get(
      "/api/voice-catalog",
      asyncHandler(async (request, response) => {
        const { modelId } = VoiceCatalogModelInputSchema.parse(request.query);
        response.json(
          VoiceCatalogSchema.parse(await voiceCatalog.get(modelId)),
        );
      }),
    );
    router.put(
      "/api/voice-catalog",
      asyncHandler(async (request, response) => {
        response.json(
          VoiceCatalogSchema.parse(
            await voiceCatalog.replace(VoiceCatalogSchema.parse(request.body)),
          ),
        );
      }),
    );
  } else {
    router.get("/api/voice-catalog", persistenceUnavailable);
    router.put("/api/voice-catalog", persistenceUnavailable);
  }

  return router;
}
