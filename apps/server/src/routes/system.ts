import { Router } from "express";
import {
  BoundaryErrorSchema,
  SystemDiagnosticsSchema,
  type SystemDiagnostics,
} from "@studynarrator/shared-types";
import type {
  DiagnosticsContext,
  SystemService,
} from "@studynarrator/application";
import { asyncHandler } from "../asyncHandler.js";

export function createSystemRouter(
  options: {
    service: SystemService;
    context: DiagnosticsContext;
  },
  router: Router = Router(),
): Router {
  router.get("/api/health", (_request, response) => {
    response.json(options.service.health());
  });

  router.get("/api/runtime", (_request, response) => {
    response.json(options.service.runtime(options.context));
  });

  router.get(
    "/api/diagnostics",
    asyncHandler(async (_request, response) => {
      try {
        const diagnostics: SystemDiagnostics =
          await options.service.diagnostics(options.context);
        response.json(SystemDiagnosticsSchema.parse(diagnostics));
      } catch {
        response.status(500).json(
          BoundaryErrorSchema.parse({
            error: {
              code: "DIAGNOSTICS_BOUNDARY_ERROR",
              message:
                "StudyNarrator could not validate the diagnostics response.",
            },
          }),
        );
      }
    }),
  );

  return router;
}
