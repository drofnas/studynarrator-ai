import express, { type ErrorRequestHandler, type Express } from "express";
import { BoundaryErrorSchema, SystemDiagnosticsSchema, type SystemDiagnostics } from "@studynarrator/shared-types";
import type { DiagnosticsContext, SystemService } from "@studynarrator/application";

export function createExpressApp(options: { service: SystemService; context: DiagnosticsContext }): Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", (_request, response) => {
    response.json(options.service.health());
  });

  app.get("/api/runtime", (_request, response) => {
    response.json(options.service.runtime(options.context));
  });

  app.get("/api/diagnostics", async (_request, response, next) => {
    try {
      const diagnostics: SystemDiagnostics = await options.service.diagnostics(options.context);
      response.json(SystemDiagnosticsSchema.parse(diagnostics));
    } catch (error) {
      next(error);
    }
  });

  const boundaryError: ErrorRequestHandler = (_error, _request, response, _next) => {
    response.status(500).json(BoundaryErrorSchema.parse({
      error: {
        code: "DIAGNOSTICS_BOUNDARY_ERROR",
        message: "StudyNarrator could not validate the diagnostics response."
      }
    }));
  };
  app.use(boundaryError);

  return app;
}
