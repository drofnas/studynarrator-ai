import express, { type ErrorRequestHandler, type Express } from "express";
import { resolve } from "node:path";
import {
  ActiveConnectionProfileInputSchema,
  BoundaryErrorSchema,
  ConnectionProfileCollectionSchema,
  ConnectionProfileIdInputSchema,
  ConnectionProfileMutationSchema,
  ConnectionProfileMutationRequestSchema,
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
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
  RedactedConnectionDiagnosticsSchema,
  ScratchpadPreviewInputSchema,
  ScratchpadPreviewResultSchema,
  SpeechCatalogSchema,
  SystemDiagnosticsSchema,
  SystemPacingDefaultsSchema,
  VoiceCatalogModelInputSchema,
  VoiceCatalogSchema,
  type ConnectionsClient,
  type PersistenceClient,
  type ScratchpadClient,
  type SystemDiagnostics,
  type VoiceCatalogClient
} from "@studynarrator/shared-types";
import type { DiagnosticsContext, SystemService } from "@studynarrator/application";

export function attachStaticWebApplication(app: Express, distributionDirectory: string): void {
  app.use(express.static(distributionDirectory, { index: "index.html" }));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(resolve(distributionDirectory, "index.html"));
  });
}

export function createExpressApp(options: {
  service: SystemService;
  context: DiagnosticsContext;
  persistence?: PersistenceClient;
  connections?: ConnectionsClient;
  voiceCatalog?: VoiceCatalogClient;
  scratchpad?: ScratchpadClient;
}): Express {
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
  }

  if (options.connections && options.voiceCatalog) {
    const connections = options.connections;
    const voiceCatalog = options.voiceCatalog;
    app.get("/api/connections", async (_request, response, next) => {
      try { response.json(ConnectionProfileCollectionSchema.parse(await connections.list())); } catch (error) { next(error); }
    });
    app.post("/api/connections", async (request, response, next) => {
      try { response.status(201).json(await connections.create(ConnectionProfileMutationSchema.parse(request.body))); } catch (error) { next(error); }
    });
    app.put("/api/connections/:profileId", async (request, response, next) => {
      try {
        const parsed = ConnectionProfileMutationRequestSchema.parse({ profileId: request.params.profileId, mutation: request.body as unknown });
        response.json(await connections.replace(parsed.profileId, parsed.mutation));
      } catch (error) { next(error); }
    });
    app.delete("/api/connections/:profileId", async (request, response, next) => {
      try {
        const parsed = ConnectionProfileIdInputSchema.parse({ profileId: request.params.profileId });
        await connections.delete(parsed.profileId);
        response.status(204).end();
      } catch (error) { next(error); }
    });
    app.post("/api/connections/:profileId/test", async (request, response, next) => {
      try {
        const parsed = ConnectionProfileIdInputSchema.parse({ profileId: request.params.profileId });
        response.json(ConnectionTestSummarySchema.parse(await connections.test(parsed.profileId)));
      } catch (error) { next(error); }
    });
    app.get("/api/connections/:profileId/speech-catalog", async (request, response, next) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.once("aborted", abort);
      const abortIfDisconnected = () => { if (!response.writableEnded) abort(); };
      response.once("close", abortIfDisconnected);
      try {
        const parsed = ConnectionProfileIdInputSchema.parse({ profileId: request.params.profileId });
        response.json(SpeechCatalogSchema.parse(await connections.discoverSpeechCatalog(parsed.profileId, controller.signal)));
      } catch (error) { next(error); }
      finally {
        request.off("aborted", abort);
        response.off("close", abortIfDisconnected);
      }
    });
    app.get("/api/connections/:profileId/diagnostics", async (request, response, next) => {
      try {
        const parsed = ConnectionProfileIdInputSchema.parse({ profileId: request.params.profileId });
        response.json(RedactedConnectionDiagnosticsSchema.parse(await connections.exportDiagnostics(parsed.profileId)));
      } catch (error) { next(error); }
    });
    app.get("/api/setup", async (_request, response, next) => {
      try { response.json(ConnectionSetupStateSchema.parse(await connections.getSetupState())); } catch (error) { next(error); }
    });
    app.put("/api/setup/active-profile", async (request, response, next) => {
      try { response.json(ConnectionSetupStateSchema.parse(await connections.setActiveProfile(ActiveConnectionProfileInputSchema.parse(request.body).profileId))); } catch (error) { next(error); }
    });
    app.post("/api/setup/complete", async (_request, response, next) => {
      try { response.json(ConnectionSetupStateSchema.parse(await connections.completeOnboarding())); } catch (error) { next(error); }
    });
    app.get("/api/voice-catalog", async (request, response, next) => {
      try {
        const { modelId } = VoiceCatalogModelInputSchema.parse(request.query);
        response.json(VoiceCatalogSchema.parse(await voiceCatalog.get(modelId)));
      } catch (error) { next(error); }
    });
    app.put("/api/voice-catalog", async (request, response, next) => {
      try { response.json(VoiceCatalogSchema.parse(await voiceCatalog.replace(VoiceCatalogSchema.parse(request.body)))); } catch (error) { next(error); }
    });
  }

  if (options.scratchpad) {
    app.post("/api/scratchpad/preview", async (request, response, next) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.once("aborted", abort);
      const abortIfDisconnected = () => { if (!response.writableEnded) abort(); };
      response.once("close", abortIfDisconnected);
      try {
        response.json(ScratchpadPreviewResultSchema.parse(await options.scratchpad!.preview(ScratchpadPreviewInputSchema.parse(request.body), controller.signal)));
      } catch (error) { next(error); }
      finally {
        request.off("aborted", abort);
        response.off("close", abortIfDisconnected);
      }
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
    } else if (errorRecord?.code === "CONNECTION_POLICY") {
      status = 409;
      code = "CONNECTION_POLICY";
      message = typeof errorRecord.message === "string" ? errorRecord.message : "The connection operation is managed by this installation.";
    } else if (errorRecord?.code === "CONNECTION_CONFIGURATION") {
      status = 409;
      code = "CONNECTION_CONFIGURATION";
      message = "Test this connection before exporting diagnostics.";
    } else if (typeof errorRecord?.code === "string" && errorRecord.code.startsWith("CONNECTION_CATALOG_")) {
      code = errorRecord.code;
      const catalogStatus: Record<string, number> = {
        CONNECTION_CATALOG_ABORTED: 499,
        CONNECTION_CATALOG_AUTHENTICATION: 401,
        CONNECTION_CATALOG_CONFIGURATION: 409,
        CONNECTION_CATALOG_INVALID_RESPONSE: 502,
        CONNECTION_CATALOG_UNAVAILABLE: 503
      };
      status = catalogStatus[errorRecord.code] ?? 500;
      message = typeof errorRecord.message === "string" ? errorRecord.message : "StudyNarrator could not discover supported speech models and voices.";
    } else if (typeof errorRecord?.code === "string" && errorRecord.code.startsWith("SCRATCHPAD_")) {
      code = errorRecord.code;
      const scratchpadStatus: Record<string, number> = {
        SCRATCHPAD_ABORTED: 499,
        SCRATCHPAD_AUTHENTICATION: 401,
        SCRATCHPAD_CONFIGURATION: 409,
        SCRATCHPAD_INVALID_AUDIO: 502,
        SCRATCHPAD_SELECTION_REJECTED: 422,
        SCRATCHPAD_UNAVAILABLE: 503
      };
      status = scratchpadStatus[errorRecord.code] ?? 500;
      message = typeof errorRecord.message === "string" ? errorRecord.message : "StudyNarrator could not complete speech synthesis.";
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
