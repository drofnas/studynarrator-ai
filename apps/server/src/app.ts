import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import {
  BoundaryErrorSchema,
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PersistenceBackupCollectionSchema,
  PersistenceBackupRestoreInputSchema,
  PersistenceBackupRestoreResultSchema,
  PersistenceStatusSchema,
  ProjectCreateInputSchema,
  ProjectDetailSchema,
  ProjectDuplicateInputSchema,
  ProjectIdSchema,
  ProjectPreviewInputSchema,
  ProjectPreviewResultSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  RenderArtifactIdSchema,
  RenderArtifactCollectionSchema,
  RenderIdSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  RenderHistorySegmentCollectionSchema,
  RenderSegmentInputSchema,
  RenderWaveformSchema,
  ScriptGenerationPromptExportInputSchema,
  ScriptGenerationPromptInputSchema,
  ScriptGenerationSkillInputSchema,
  RedactedConnectionDiagnosticsSchema,
  ScratchpadPreviewInputSchema,
  ScratchpadPreviewResultSchema,
  SpeechCacheCleanupResultSchema,
  SpeechCacheKeyInputSchema,
  SpeechCacheStatusSchema,
  SpeechCatalogSchema,
  SpeechCatalogDiscoveryInputSchema,
  SpeechBackendConnectionAuthoringSchema,
  SpeechBackendConnectionSchema,
  SystemDiagnosticsSchema,
  SystemTimingConfigurationSchema,
  VoiceCatalogModelInputSchema,
  VoiceCatalogSchema,
  type SpeechBackendConnectionClient,
  type PersistenceClient,
  type ProjectPreviewClient,
  type ScratchpadClient,
  type SpeechCacheClient,
  type SystemDiagnostics,
  type VoiceCatalogClient,
} from "@studynarrator/shared-types";
import {
  parseRenderMediaRange,
  type DiagnosticsContext,
  type RenderService,
  type ResolvedRenderMedia,
  type ScriptGenerationService,
  type SystemService,
} from "@studynarrator/application";
import { asyncHandler } from "./asyncHandler.js";
import { boundaryError } from "./errorMiddleware.js";

function streamRenderMedia(
  request: Request,
  response: Response,
  next: NextFunction,
  media: ResolvedRenderMedia,
  disposition: "inline" | "attachment" = "inline",
): void {
  const range = parseRenderMediaRange(request.headers.range, media.sizeBytes);
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("cache-control", "private, no-store");
  response.setHeader("content-type", media.mimeType);
  response.setHeader(
    "content-disposition",
    `${disposition}; filename="${media.fileName.replace(/["\\\r\n]/gu, "_")}"`,
  );
  if (range.status === "unsatisfiable") {
    response
      .status(416)
      .setHeader("content-range", `bytes */${String(media.sizeBytes)}`)
      .end();
    return;
  }
  const length = range.end - range.start + 1;
  response.status(range.status === "partial" ? 206 : 200);
  response.setHeader("content-length", String(length));
  if (range.status === "partial")
    response.setHeader(
      "content-range",
      `bytes ${String(range.start)}-${String(range.end)}/${String(media.sizeBytes)}`,
    );
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(media.path, { start: range.start, end: range.end })
    .once("error", next)
    .pipe(response);
}

export function attachStaticWebApplication(
  app: Express,
  distributionDirectory: string,
): void {
  app.use(
    express.static(distributionDirectory, {
      index: "index.html",
      setHeaders(response, path) {
        response.setHeader(
          "cache-control",
          path.endsWith("index.html")
            ? "no-cache"
            : "public, max-age=31536000, immutable",
        );
      },
    }),
  );
  app.get("/{*path}", (request, response, next) => {
    if (request.path === "/api" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.setHeader("cache-control", "no-cache");
    response.sendFile(resolve(distributionDirectory, "index.html"));
  });
}

export function createExpressApp(options: {
  service: SystemService;
  context: DiagnosticsContext;
  persistence?: PersistenceClient;
  connection?: SpeechBackendConnectionClient;
  voiceCatalog?: VoiceCatalogClient;
  scratchpad?: ScratchpadClient;
  projectPreview?: ProjectPreviewClient;
  renders?: RenderService;
  speechCache?: SpeechCacheClient;
  scriptGeneration?: ScriptGenerationService;
}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "6mb", strict: true }));
  const persistenceUnavailable = (
    _request: Request,
    _response: Response,
    next: NextFunction,
  ) => {
    next(
      Object.assign(new Error("Persistence is unavailable."), {
        code: "PERSISTENCE_UNAVAILABLE",
      }),
    );
  };

  app.get("/api/health", (_request, response) => {
    response.json(options.service.health());
  });

  app.get("/api/runtime", (_request, response) => {
    response.json(options.service.runtime(options.context));
  });

  app.get(
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

  if (options.persistence) {
    const persistence = options.persistence;
    app.get(
      "/api/persistence/status",
      asyncHandler(async (_request, response) => {
        response.json(
          PersistenceStatusSchema.parse(await persistence.status()),
        );
      }),
    );
    app.get(
      "/api/persistence/backups",
      asyncHandler(async (_request, response) => {
        const backups = persistence.backups;
        if (!backups)
          throw new Error("Backup listing is not available in this context.");
        response.json(
          PersistenceBackupCollectionSchema.parse(await backups.list()),
        );
      }),
    );
    app.post(
      "/api/persistence/backups/restore",
      asyncHandler(async (request, response) => {
        const backups = persistence.backups;
        if (!backups)
          throw new Error("Backup restore is not available in this context.");
        response
          .status(201)
          .json(
            PersistenceBackupRestoreResultSchema.parse(
              await backups.restore(
                PersistenceBackupRestoreInputSchema.parse(request.body),
              ),
            ),
          );
      }),
    );
    app.get(
      "/api/projects",
      asyncHandler(async (_request, response) => {
        response.json(
          ProjectSummaryCollectionSchema.parse(
            await persistence.projects.list(),
          ),
        );
      }),
    );
    app.post(
      "/api/projects",
      asyncHandler(async (request, response) => {
        response
          .status(201)
          .json(
            ProjectDetailSchema.parse(
              await persistence.projects.create(
                ProjectCreateInputSchema.parse(request.body),
              ),
            ),
          );
      }),
    );
    app.get(
      "/api/projects/:projectId",
      asyncHandler(async (request, response) => {
        response.json(
          ProjectDetailSchema.parse(
            await persistence.projects.get(
              ProjectIdSchema.parse(request.params.projectId),
            ),
          ),
        );
      }),
    );
    app.put(
      "/api/projects/:projectId",
      asyncHandler(async (request, response) => {
        response.json(
          ProjectDetailSchema.parse(
            await persistence.projects.replace(
              ProjectIdSchema.parse(request.params.projectId),
              ProjectReplaceInputSchema.parse(request.body),
            ),
          ),
        );
      }),
    );
    app.post(
      "/api/projects/:projectId/duplicate",
      asyncHandler(async (request, response) => {
        response
          .status(201)
          .json(
            ProjectDetailSchema.parse(
              await persistence.projects.duplicate(
                ProjectIdSchema.parse(request.params.projectId),
                ProjectDuplicateInputSchema.parse(request.body),
              ),
            ),
          );
      }),
    );
    app.delete(
      "/api/projects/:projectId",
      asyncHandler(async (request, response) => {
        await persistence.projects.delete(
          ProjectIdSchema.parse(request.params.projectId),
        );
        response.status(204).end();
      }),
    );
    app.get(
      "/api/settings/pacing",
      asyncHandler(async (_request, response) => {
        response.json(
          SystemTimingConfigurationSchema.parse(
            await persistence.settings.getPacing(),
          ),
        );
      }),
    );
    app.put(
      "/api/settings/pacing",
      asyncHandler(async (request, response) => {
        response.json(
          SystemTimingConfigurationSchema.parse(
            await persistence.settings.updatePacing(
              SystemTimingConfigurationSchema.parse(request.body),
            ),
          ),
        );
      }),
    );
    app.get(
      "/api/preferences/ignored-diagnostics",
      asyncHandler(async (_request, response) => {
        response.json(
          IgnoredDiagnosticCollectionSchema.parse(
            await persistence.preferences.getIgnoredDiagnostics(),
          ),
        );
      }),
    );
    app.put(
      "/api/preferences/ignored-diagnostics",
      asyncHandler(async (request, response) => {
        response.json(
          IgnoredDiagnosticCollectionSchema.parse(
            await persistence.preferences.replaceIgnoredDiagnostics(
              IgnoredDiagnosticCollectionSchema.parse(request.body),
            ),
          ),
        );
      }),
    );
    app.get(
      "/api/lexicon/global",
      asyncHandler(async (_request, response) => {
        response.json(
          GlobalLexiconEntryCollectionSchema.parse(
            await persistence.globalLexicon.list(),
          ),
        );
      }),
    );
    app.put(
      "/api/lexicon/global",
      asyncHandler(async (request, response) => {
        response.json(
          GlobalLexiconEntryCollectionSchema.parse(
            await persistence.globalLexicon.replace(
              GlobalLexiconReplaceInputSchema.parse(request.body),
            ),
          ),
        );
      }),
    );
  }

  if (options.connection) {
    const connection = options.connection;
    app.get(
      "/api/connection",
      asyncHandler(async (_request, response) => {
        response.json(
          SpeechBackendConnectionSchema.parse(await connection.get()),
        );
      }),
    );
    app.put(
      "/api/connection",
      asyncHandler(async (request, response) => {
        response.json(
          SpeechBackendConnectionSchema.parse(
            await connection.update(
              SpeechBackendConnectionAuthoringSchema.parse(request.body),
            ),
          ),
        );
      }),
    );
    app.post(
      "/api/connection/test",
      asyncHandler(async (_request, response) => {
        response.json(
          ConnectionTestSummarySchema.parse(await connection.test()),
        );
      }),
    );
    app.post(
      "/api/connection/speech-catalog",
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
            SpeechCatalogSchema.parse(
              await connection.discoverSpeechCatalog(
                SpeechCatalogDiscoveryInputSchema.parse(request.body),
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
    app.get(
      "/api/connection/diagnostics",
      asyncHandler(async (_request, response) => {
        response.json(
          RedactedConnectionDiagnosticsSchema.parse(
            await connection.exportDiagnostics(),
          ),
        );
      }),
    );
    app.get(
      "/api/setup",
      asyncHandler(async (_request, response) => {
        response.json(
          ConnectionSetupStateSchema.parse(await connection.getSetupState()),
        );
      }),
    );
    app.post(
      "/api/setup/complete",
      asyncHandler(async (_request, response) => {
        response.json(
          ConnectionSetupStateSchema.parse(
            await connection.completeOnboarding(),
          ),
        );
      }),
    );
  } else {
    app.get("/api/connection", persistenceUnavailable);
    app.put("/api/connection", persistenceUnavailable);
    app.post("/api/connection/test", persistenceUnavailable);
    app.post("/api/connection/speech-catalog", persistenceUnavailable);
    app.get("/api/connection/diagnostics", persistenceUnavailable);
    app.get("/api/setup", persistenceUnavailable);
    app.post("/api/setup/complete", persistenceUnavailable);
  }

  if (options.voiceCatalog) {
    const voiceCatalog = options.voiceCatalog;
    app.get(
      "/api/voice-catalog",
      asyncHandler(async (request, response) => {
        const { modelId } = VoiceCatalogModelInputSchema.parse(request.query);
        response.json(
          VoiceCatalogSchema.parse(await voiceCatalog.get(modelId)),
        );
      }),
    );
    app.put(
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
    app.get("/api/voice-catalog", persistenceUnavailable);
    app.put("/api/voice-catalog", persistenceUnavailable);
  }

  if (options.scratchpad) {
    app.post(
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
              await options.scratchpad!.preview(
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

  if (options.projectPreview) {
    app.post(
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
              await options.projectPreview!.preview(
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

  if (options.renders) {
    app.post(
      "/api/projects/:projectId/renders",
      asyncHandler(async (request, response) => {
        response
          .status(202)
          .json(
            RenderJobSchema.parse(
              await options.renders!.startProject(
                ProjectIdSchema.parse(request.params.projectId),
              ),
            ),
          );
      }),
    );
    app.get(
      "/api/projects/:projectId/renders",
      asyncHandler(async (request, response) => {
        response.json(
          RenderJobCollectionSchema.parse(
            await options.renders!.list(
              ProjectIdSchema.parse(request.params.projectId),
            ),
          ),
        );
      }),
    );
    app.get(
      "/api/renders/:renderId",
      asyncHandler(async (request, response) => {
        response.json(
          RenderJobSchema.parse(
            await options.renders!.get(
              RenderIdSchema.parse(request.params.renderId),
            ),
          ),
        );
      }),
    );
    app.post(
      "/api/renders/:renderId/cancel",
      asyncHandler(async (request, response) => {
        response.json(
          RenderJobSchema.parse(
            await options.renders!.cancel(
              RenderIdSchema.parse(request.params.renderId),
            ),
          ),
        );
      }),
    );
    app.post(
      "/api/renders/:renderId/retry",
      asyncHandler(async (request, response) => {
        response
          .status(202)
          .json(
            RenderJobSchema.parse(
              await options.renders!.retry(
                RenderIdSchema.parse(request.params.renderId),
              ),
            ),
          );
      }),
    );
    app.get(
      "/api/renders/:renderId/artifacts",
      asyncHandler(async (request, response) => {
        response.json(
          RenderArtifactCollectionSchema.parse(
            await options.renders!.listArtifacts(
              RenderIdSchema.parse(request.params.renderId),
            ),
          ),
        );
      }),
    );
    app.get(
      "/api/renders/:renderId/audio",
      asyncHandler(async (request, response, next) => {
        const media = await options.renders!.resolveRenderAudio(
          RenderIdSchema.parse(request.params.renderId),
        );
        streamRenderMedia(request, response, next, media);
      }),
    );
    app.get(
      "/api/renders/:renderId/download",
      asyncHandler(async (request, response, next) => {
        const media = await options.renders!.resolveRenderAudio(
          RenderIdSchema.parse(request.params.renderId),
        );
        streamRenderMedia(request, response, next, media, "attachment");
      }),
    );
    app.get(
      "/api/renders/:renderId/details",
      asyncHandler(async (request, response) => {
        const archive = await options.renders!.resolveDetailsArchive!(
          RenderIdSchema.parse(request.params.renderId),
        );
        response.setHeader("cache-control", "private, no-store");
        response.setHeader("content-type", archive.mimeType);
        response.setHeader(
          "content-disposition",
          `attachment; filename="${archive.fileName.replace(/["\\\r\n]/gu, "_")}"`,
        );
        response.setHeader("content-length", String(archive.bytes.byteLength));
        response.send(Buffer.from(archive.bytes));
      }),
    );
    app.get(
      "/api/renders/:renderId/waveform",
      asyncHandler(async (request, response) => {
        response.json(
          RenderWaveformSchema.parse(
            await options.renders!.getWaveform(
              RenderIdSchema.parse(request.params.renderId),
            ),
          ),
        );
      }),
    );
    app.get(
      "/api/renders/:renderId/segments",
      asyncHandler(async (request, response) => {
        response.json(
          RenderHistorySegmentCollectionSchema.parse(
            await options.renders!.listSegments(
              RenderIdSchema.parse(request.params.renderId),
            ),
          ),
        );
      }),
    );
    app.get(
      "/api/renders/:renderId/segments/:ordinal/audio",
      asyncHandler(async (request, response, next) => {
        const input = RenderSegmentInputSchema.parse({
          renderId: request.params.renderId,
          ordinal: Number(request.params.ordinal),
        });
        const media = await options.renders!.resolveSegmentAudio(
          input.renderId,
          input.ordinal,
        );
        streamRenderMedia(request, response, next, media);
      }),
    );
    app.post(
      "/api/renders/:renderId/segments/:ordinal/export",
      asyncHandler(async (request, response, next) => {
        const input = RenderSegmentInputSchema.parse({
          renderId: request.params.renderId,
          ordinal: Number(request.params.ordinal),
        });
        const media = await options.renders!.resolveSegmentAudio(
          input.renderId,
          input.ordinal,
        );
        streamRenderMedia(request, response, next, media, "attachment");
      }),
    );
    app.get(
      "/api/render-artifacts/:artifactId",
      asyncHandler(async (request, response, next) => {
        const { artifact, path } = await options.renders!.resolveArtifact(
          RenderArtifactIdSchema.parse(request.params.artifactId),
        );
        const safeFileName = artifact.fileName.replace(/["\\\r\n]/gu, "_");
        response.setHeader(
          "content-disposition",
          `attachment; filename="${safeFileName}"`,
        );
        response.setHeader(
          "content-type",
          artifact.type === "mp3"
            ? "audio/mpeg"
            : artifact.type === "manifest" ||
                artifact.type === "projectSnapshot"
              ? "application/json"
              : "text/plain; charset=utf-8",
        );
        createReadStream(path).once("error", next).pipe(response);
      }),
    );
  }

  if (options.scriptGeneration) {
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
    app.post(
      "/api/script-generation/prompt-preview",
      asyncHandler(async (request, response) => {
        const input = ScriptGenerationPromptInputSchema.parse(request.body);
        response.json(
          await options.scriptGeneration!.previewPrompt(null, input.kind),
        );
      }),
    );
    app.post(
      "/api/script-generation/prompt-export",
      asyncHandler(async (request, response) => {
        const input = ScriptGenerationPromptExportInputSchema.parse(
          request.body,
        );
        sendGeneratedFile(
          response,
          await options.scriptGeneration!.resolvePromptExport(
            null,
            input.kind,
            input.content,
          ),
        );
      }),
    );
    app.post(
      "/api/script-generation/skill-export",
      asyncHandler(async (request, response) => {
        ScriptGenerationSkillInputSchema.parse(request.body);
        sendGeneratedFile(
          response,
          await options.scriptGeneration!.resolveSkillPackage(null),
        );
      }),
    );
    app.post(
      "/api/projects/:projectId/prompt-preview",
      asyncHandler(async (request, response) => {
        const input = ScriptGenerationPromptInputSchema.parse(request.body);
        response.json(
          await options.scriptGeneration!.previewPrompt(
            ProjectIdSchema.parse(request.params.projectId),
            input.kind,
          ),
        );
      }),
    );
    app.post(
      "/api/projects/:projectId/prompt-export",
      asyncHandler(async (request, response) => {
        const input = ScriptGenerationPromptExportInputSchema.parse(
          request.body,
        );
        sendGeneratedFile(
          response,
          await options.scriptGeneration!.resolvePromptExport(
            ProjectIdSchema.parse(request.params.projectId),
            input.kind,
            input.content,
          ),
        );
      }),
    );
    app.post(
      "/api/projects/:projectId/skill-export",
      asyncHandler(async (request, response) => {
        ScriptGenerationSkillInputSchema.parse(request.body);
        sendGeneratedFile(
          response,
          await options.scriptGeneration!.resolveSkillPackage(
            ProjectIdSchema.parse(request.params.projectId),
          ),
        );
      }),
    );
  }

  if (options.speechCache) {
    app.get(
      "/api/speech-cache",
      asyncHandler(async (_request, response) => {
        response.json(
          SpeechCacheStatusSchema.parse(await options.speechCache!.status()),
        );
      }),
    );
    app.delete(
      "/api/speech-cache",
      asyncHandler(async (_request, response) => {
        response.json(
          SpeechCacheCleanupResultSchema.parse(
            await options.speechCache!.clearAll(),
          ),
        );
      }),
    );
    app.delete(
      "/api/projects/:projectId/speech-cache",
      asyncHandler(async (request, response) => {
        response.json(
          SpeechCacheCleanupResultSchema.parse(
            await options.speechCache!.clearProject(
              ProjectIdSchema.parse(request.params.projectId),
            ),
          ),
        );
      }),
    );
    app.delete(
      "/api/speech-cache/:cacheKey",
      asyncHandler(async (request, response) => {
        const { cacheKey } = SpeechCacheKeyInputSchema.parse(request.params);
        response.json(
          SpeechCacheCleanupResultSchema.parse(
            await options.speechCache!.clearEntry(cacheKey),
          ),
        );
      }),
    );
  }

  app.use(boundaryError);

  return app;
}
