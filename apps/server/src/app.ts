import express, { type ErrorRequestHandler, type Express } from "express";
import {
  BoundaryErrorSchema,
  ConnectionProfileAuthoringSchema,
  ConnectionProfileCollectionSchema,
  ConnectionProfilePlaceholderSchema,
  DurableIdSchema,
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PersistenceStatusSchema,
  ProjectCreateInputSchema,
  ProjectDetailSchema,
  ProjectDuplicateInputSchema,
  ProjectIdSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  SystemDiagnosticsSchema,
  SystemPacingDefaultsSchema,
  type PersistenceClient,
  type SystemDiagnostics
} from "@studynarrator/shared-types";
import type { DiagnosticsContext, SystemService } from "@studynarrator/application";

export function createExpressApp(options: { service: SystemService; context: DiagnosticsContext; persistence?: PersistenceClient }): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "6mb", strict: true }));

  app.get("/api/health", (_request, response) => {
    response.json(options.service.health());
  });

  app.get("/api/runtime", (_request, response) => {
    response.json(options.service.runtime(options.context));
  });

  app.get("/api/diagnostics", async (_request, response, _next) => {
    try {
      const diagnostics: SystemDiagnostics = await options.service.diagnostics(options.context);
      response.json(SystemDiagnosticsSchema.parse(diagnostics));
    } catch {
      response.status(500).json(BoundaryErrorSchema.parse({
        error: {
          code: "DIAGNOSTICS_BOUNDARY_ERROR",
          message: "StudyNarrator could not validate the diagnostics response."
        }
      }));
    }
  });

  if (options.persistence) {
    const persistence = options.persistence;
    app.get("/api/persistence/status", async (_request, response, next) => {
      try { response.json(PersistenceStatusSchema.parse(await persistence.status())); } catch (error) { next(error); }
    });
    app.get("/api/projects", async (_request, response, next) => {
      try { response.json(ProjectSummaryCollectionSchema.parse(await persistence.projects.list())); } catch (error) { next(error); }
    });
    app.post("/api/projects", async (request, response, next) => {
      try { response.status(201).json(ProjectDetailSchema.parse(await persistence.projects.create(ProjectCreateInputSchema.parse(request.body)))); } catch (error) { next(error); }
    });
    app.get("/api/projects/:projectId", async (request, response, next) => {
      try { response.json(ProjectDetailSchema.parse(await persistence.projects.get(ProjectIdSchema.parse(request.params.projectId)))); } catch (error) { next(error); }
    });
    app.put("/api/projects/:projectId", async (request, response, next) => {
      try {
        response.json(ProjectDetailSchema.parse(await persistence.projects.replace(
          ProjectIdSchema.parse(request.params.projectId),
          ProjectReplaceInputSchema.parse(request.body)
        )));
      } catch (error) { next(error); }
    });
    app.post("/api/projects/:projectId/duplicate", async (request, response, next) => {
      try {
        response.status(201).json(ProjectDetailSchema.parse(await persistence.projects.duplicate(
          ProjectIdSchema.parse(request.params.projectId),
          ProjectDuplicateInputSchema.parse(request.body)
        )));
      } catch (error) { next(error); }
    });
    app.delete("/api/projects/:projectId", async (request, response, next) => {
      try {
        await persistence.projects.delete(ProjectIdSchema.parse(request.params.projectId));
        response.status(204).end();
      } catch (error) { next(error); }
    });
    app.get("/api/settings/pacing", async (_request, response, next) => {
      try { response.json(SystemPacingDefaultsSchema.parse(await persistence.settings.getPacing())); } catch (error) { next(error); }
    });
    app.put("/api/settings/pacing", async (request, response, next) => {
      try { response.json(SystemPacingDefaultsSchema.parse(await persistence.settings.updatePacing(SystemPacingDefaultsSchema.parse(request.body)))); } catch (error) { next(error); }
    });
    app.get("/api/preferences/ignored-diagnostics", async (_request, response, next) => {
      try { response.json(IgnoredDiagnosticCollectionSchema.parse(await persistence.preferences.getIgnoredDiagnostics())); } catch (error) { next(error); }
    });
    app.put("/api/preferences/ignored-diagnostics", async (request, response, next) => {
      try { response.json(IgnoredDiagnosticCollectionSchema.parse(await persistence.preferences.replaceIgnoredDiagnostics(IgnoredDiagnosticCollectionSchema.parse(request.body)))); } catch (error) { next(error); }
    });
    app.get("/api/lexicon/global", async (_request, response, next) => {
      try { response.json(GlobalLexiconEntryCollectionSchema.parse(await persistence.globalLexicon.list())); } catch (error) { next(error); }
    });
    app.put("/api/lexicon/global", async (request, response, next) => {
      try { response.json(GlobalLexiconEntryCollectionSchema.parse(await persistence.globalLexicon.replace(GlobalLexiconReplaceInputSchema.parse(request.body)))); } catch (error) { next(error); }
    });
    app.get("/api/connection-profiles", async (_request, response, next) => {
      try { response.json(ConnectionProfileCollectionSchema.parse(await persistence.connectionProfiles.list())); } catch (error) { next(error); }
    });
    app.post("/api/connection-profiles", async (request, response, next) => {
      try { response.status(201).json(ConnectionProfilePlaceholderSchema.parse(await persistence.connectionProfiles.create(ConnectionProfileAuthoringSchema.parse(request.body)))); } catch (error) { next(error); }
    });
    app.put("/api/connection-profiles/:profileId", async (request, response, next) => {
      try {
        response.json(ConnectionProfilePlaceholderSchema.parse(await persistence.connectionProfiles.replace(
          DurableIdSchema.parse(request.params.profileId),
          ConnectionProfileAuthoringSchema.parse(request.body)
        )));
      } catch (error) { next(error); }
    });
    app.delete("/api/connection-profiles/:profileId", async (request, response, next) => {
      try {
        await persistence.connectionProfiles.delete(DurableIdSchema.parse(request.params.profileId));
        response.status(204).end();
      } catch (error) { next(error); }
    });
  }

  const boundaryError: ErrorRequestHandler = (error, _request, response, _next) => {
    let status = 500;
    let code = "PERSISTENCE_BOUNDARY_ERROR";
    let message = "StudyNarrator could not complete the persistence operation.";
    let issues: Array<{ path: string; message: string }> | undefined;
    const errorRecord = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
    const zodIssues = errorRecord && Array.isArray(errorRecord.issues)
      ? errorRecord.issues.filter((issue): issue is { path: PropertyKey[]; message: string } => {
        if (!issue || typeof issue !== "object") return false;
        const record = issue as Record<string, unknown>;
        return Array.isArray(record.path) && typeof record.message === "string";
      })
      : undefined;
    if (zodIssues) {
      status = 400;
      code = "VALIDATION_ERROR";
      message = "The request does not match the persistence contract.";
      issues = zodIssues.map((issue) => ({ path: issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`, message: issue.message }));
    } else if (errorRecord?.code === "PERSISTENCE_NOT_FOUND") {
      status = 404;
      code = "NOT_FOUND";
      message = "The requested persistence record does not exist.";
    } else if (errorRecord?.code === "PERSISTENCE_CONFLICT") {
      status = 409;
      code = "CONFLICT";
      message = "The persistence operation conflicts with existing data.";
    } else if (errorRecord?.code === "PERSISTENCE_UNAVAILABLE") {
      status = 503;
      code = "PERSISTENCE_UNAVAILABLE";
      message = "Persistence is unavailable until the database migration is repaired.";
    }
    response.status(status).json(BoundaryErrorSchema.parse({
      error: {
        code,
        message,
        ...(issues === undefined ? {} : { issues })
      }
    }));
  };
  app.use(boundaryError);

  return app;
}
