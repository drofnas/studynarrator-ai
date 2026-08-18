import express, {
  type ErrorRequestHandler,
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
  RenderPlanIdSchema,
  RenderPlanSchema,
  RenderPlanSummaryCollectionSchema,
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
  SpeachesCatalogDiscoveryInputSchema,
  SpeachesConnectionAuthoringSchema,
  SpeachesConnectionSchema,
  SystemDiagnosticsSchema,
  SystemTimingConfigurationSchema,
  VoiceCatalogModelInputSchema,
  VoiceCatalogSchema,
  type SpeachesConnectionClient,
  type PersistenceClient,
  type ProjectPreviewClient,
  type RenderPlanClient,
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
  connection?: SpeachesConnectionClient;
  voiceCatalog?: VoiceCatalogClient;
  scratchpad?: ScratchpadClient;
  projectPreview?: ProjectPreviewClient;
  renderPlans?: RenderPlanClient;
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

  app.get("/api/diagnostics", async (_request, response, _next) => {
    try {
      const diagnostics: SystemDiagnostics = await options.service.diagnostics(
        options.context,
      );
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
  });

  if (options.persistence) {
    const persistence = options.persistence;
    app.get("/api/persistence/status", async (_request, response, next) => {
      try {
        response.json(
          PersistenceStatusSchema.parse(await persistence.status()),
        );
      } catch (error) {
        next(error);
      }
    });
    app.get("/api/persistence/backups", async (_request, response, next) => {
      try {
        const backups = persistence.backups;
        if (!backups)
          throw new Error("Backup listing is not available in this context.");
        response.json(
          PersistenceBackupCollectionSchema.parse(await backups.list()),
        );
      } catch (error) {
        next(error);
      }
    });
    app.post(
      "/api/persistence/backups/restore",
      async (request, response, next) => {
        try {
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
        } catch (error) {
          next(error);
        }
      },
    );
    app.get("/api/projects", async (_request, response, next) => {
      try {
        response.json(
          ProjectSummaryCollectionSchema.parse(
            await persistence.projects.list(),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.post("/api/projects", async (request, response, next) => {
      try {
        response
          .status(201)
          .json(
            ProjectDetailSchema.parse(
              await persistence.projects.create(
                ProjectCreateInputSchema.parse(request.body),
              ),
            ),
          );
      } catch (error) {
        next(error);
      }
    });
    app.get("/api/projects/:projectId", async (request, response, next) => {
      try {
        response.json(
          ProjectDetailSchema.parse(
            await persistence.projects.get(
              ProjectIdSchema.parse(request.params.projectId),
            ),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.put("/api/projects/:projectId", async (request, response, next) => {
      try {
        response.json(
          ProjectDetailSchema.parse(
            await persistence.projects.replace(
              ProjectIdSchema.parse(request.params.projectId),
              ProjectReplaceInputSchema.parse(request.body),
            ),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.post(
      "/api/projects/:projectId/duplicate",
      async (request, response, next) => {
        try {
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
        } catch (error) {
          next(error);
        }
      },
    );
    app.delete("/api/projects/:projectId", async (request, response, next) => {
      try {
        await persistence.projects.delete(
          ProjectIdSchema.parse(request.params.projectId),
        );
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    });
    app.get("/api/settings/pacing", async (_request, response, next) => {
      try {
        response.json(
          SystemTimingConfigurationSchema.parse(
            await persistence.settings.getPacing(),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.put("/api/settings/pacing", async (request, response, next) => {
      try {
        response.json(
          SystemTimingConfigurationSchema.parse(
            await persistence.settings.updatePacing(
              SystemTimingConfigurationSchema.parse(request.body),
            ),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.get(
      "/api/preferences/ignored-diagnostics",
      async (_request, response, next) => {
        try {
          response.json(
            IgnoredDiagnosticCollectionSchema.parse(
              await persistence.preferences.getIgnoredDiagnostics(),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.put(
      "/api/preferences/ignored-diagnostics",
      async (request, response, next) => {
        try {
          response.json(
            IgnoredDiagnosticCollectionSchema.parse(
              await persistence.preferences.replaceIgnoredDiagnostics(
                IgnoredDiagnosticCollectionSchema.parse(request.body),
              ),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.get("/api/lexicon/global", async (_request, response, next) => {
      try {
        response.json(
          GlobalLexiconEntryCollectionSchema.parse(
            await persistence.globalLexicon.list(),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.put("/api/lexicon/global", async (request, response, next) => {
      try {
        response.json(
          GlobalLexiconEntryCollectionSchema.parse(
            await persistence.globalLexicon.replace(
              GlobalLexiconReplaceInputSchema.parse(request.body),
            ),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
  }

  if (options.connection) {
    const connection = options.connection;
    app.get("/api/connection", async (_request, response, next) => {
      try {
        response.json(SpeachesConnectionSchema.parse(await connection.get()));
      } catch (error) {
        next(error);
      }
    });
    app.put("/api/connection", async (request, response, next) => {
      try {
        response.json(
          SpeachesConnectionSchema.parse(
            await connection.update(
              SpeachesConnectionAuthoringSchema.parse(request.body),
            ),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.post("/api/connection/test", async (_request, response, next) => {
      try {
        response.json(
          ConnectionTestSummarySchema.parse(await connection.test()),
        );
      } catch (error) {
        next(error);
      }
    });
    app.post(
      "/api/connection/speech-catalog",
      async (request, response, next) => {
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
                SpeachesCatalogDiscoveryInputSchema.parse(request.body),
                controller.signal,
              ),
            ),
          );
        } catch (error) {
          next(error);
        } finally {
          request.off("aborted", abort);
          response.off("close", abortIfDisconnected);
        }
      },
    );
    app.get("/api/connection/diagnostics", async (_request, response, next) => {
      try {
        response.json(
          RedactedConnectionDiagnosticsSchema.parse(
            await connection.exportDiagnostics(),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.get("/api/setup", async (_request, response, next) => {
      try {
        response.json(
          ConnectionSetupStateSchema.parse(await connection.getSetupState()),
        );
      } catch (error) {
        next(error);
      }
    });
    app.post("/api/setup/complete", async (_request, response, next) => {
      try {
        response.json(
          ConnectionSetupStateSchema.parse(
            await connection.completeOnboarding(),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
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
    app.get("/api/voice-catalog", async (request, response, next) => {
      try {
        const { modelId } = VoiceCatalogModelInputSchema.parse(request.query);
        response.json(
          VoiceCatalogSchema.parse(await voiceCatalog.get(modelId)),
        );
      } catch (error) {
        next(error);
      }
    });
    app.put("/api/voice-catalog", async (request, response, next) => {
      try {
        response.json(
          VoiceCatalogSchema.parse(
            await voiceCatalog.replace(VoiceCatalogSchema.parse(request.body)),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
  } else {
    app.get("/api/voice-catalog", persistenceUnavailable);
    app.put("/api/voice-catalog", persistenceUnavailable);
  }

  if (options.scratchpad) {
    app.post("/api/scratchpad/preview", async (request, response, next) => {
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
      } catch (error) {
        next(error);
      } finally {
        request.off("aborted", abort);
        response.off("close", abortIfDisconnected);
      }
    });
  }

  if (options.projectPreview) {
    app.post(
      "/api/projects/:projectId/preview",
      async (request, response, next) => {
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
        } catch (error) {
          next(error);
        } finally {
          request.off("aborted", abort);
          response.off("close", abortIfDisconnected);
        }
      },
    );
  }

  if (options.renderPlans) {
    app.post(
      "/api/projects/:projectId/render-plans",
      async (request, response, next) => {
        try {
          response
            .status(201)
            .json(
              RenderPlanSchema.parse(
                await options.renderPlans!.create(
                  ProjectIdSchema.parse(request.params.projectId),
                ),
              ),
            );
        } catch (error) {
          next(error);
        }
      },
    );
    app.get(
      "/api/projects/:projectId/render-plans",
      async (request, response, next) => {
        try {
          response.json(
            RenderPlanSummaryCollectionSchema.parse(
              await options.renderPlans!.list(
                ProjectIdSchema.parse(request.params.projectId),
              ),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.get("/api/render-plans/:planId", async (request, response, next) => {
      try {
        response.json(
          RenderPlanSchema.parse(
            await options.renderPlans!.get(
              RenderPlanIdSchema.parse(request.params.planId),
            ),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
  }

  if (options.renders) {
    app.post(
      "/api/projects/:projectId/renders",
      async (request, response, next) => {
        try {
          response
            .status(202)
            .json(
              RenderJobSchema.parse(
                await options.renders!.startProject!(
                  ProjectIdSchema.parse(request.params.projectId),
                ),
              ),
            );
        } catch (error) {
          next(error);
        }
      },
    );
    app.post(
      "/api/render-plans/:planId/renders",
      async (request, response, next) => {
        try {
          response
            .status(202)
            .json(
              RenderJobSchema.parse(
                await options.renders!.start(
                  RenderPlanIdSchema.parse(request.params.planId),
                ),
              ),
            );
        } catch (error) {
          next(error);
        }
      },
    );
    app.get(
      "/api/projects/:projectId/renders",
      async (request, response, next) => {
        try {
          response.json(
            RenderJobCollectionSchema.parse(
              await options.renders!.list(
                ProjectIdSchema.parse(request.params.projectId),
              ),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.get("/api/renders/:renderId", async (request, response, next) => {
      try {
        response.json(
          RenderJobSchema.parse(
            await options.renders!.get(
              RenderIdSchema.parse(request.params.renderId),
            ),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.post(
      "/api/renders/:renderId/cancel",
      async (request, response, next) => {
        try {
          response.json(
            RenderJobSchema.parse(
              await options.renders!.cancel(
                RenderIdSchema.parse(request.params.renderId),
              ),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.post(
      "/api/renders/:renderId/retry",
      async (request, response, next) => {
        try {
          response
            .status(202)
            .json(
              RenderJobSchema.parse(
                await options.renders!.retry(
                  RenderIdSchema.parse(request.params.renderId),
                ),
              ),
            );
        } catch (error) {
          next(error);
        }
      },
    );
    app.get(
      "/api/renders/:renderId/artifacts",
      async (request, response, next) => {
        try {
          response.json(
            RenderArtifactCollectionSchema.parse(
              await options.renders!.listArtifacts(
                RenderIdSchema.parse(request.params.renderId),
              ),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.get("/api/renders/:renderId/audio", async (request, response, next) => {
      try {
        const media = await options.renders!.resolveRenderAudio(
          RenderIdSchema.parse(request.params.renderId),
        );
        streamRenderMedia(request, response, next, media);
      } catch (error) {
        next(error);
      }
    });
    app.get(
      "/api/renders/:renderId/download",
      async (request, response, next) => {
        try {
          const media = await options.renders!.resolveRenderAudio(
            RenderIdSchema.parse(request.params.renderId),
          );
          streamRenderMedia(request, response, next, media, "attachment");
        } catch (error) {
          next(error);
        }
      },
    );
    app.get(
      "/api/renders/:renderId/details",
      async (request, response, next) => {
        try {
          const archive = await options.renders!.resolveDetailsArchive!(
            RenderIdSchema.parse(request.params.renderId),
          );
          response.setHeader("cache-control", "private, no-store");
          response.setHeader("content-type", archive.mimeType);
          response.setHeader(
            "content-disposition",
            `attachment; filename="${archive.fileName.replace(/["\\\r\n]/gu, "_")}"`,
          );
          response.setHeader(
            "content-length",
            String(archive.bytes.byteLength),
          );
          response.send(Buffer.from(archive.bytes));
        } catch (error) {
          next(error);
        }
      },
    );
    app.get(
      "/api/renders/:renderId/waveform",
      async (request, response, next) => {
        try {
          response.json(
            RenderWaveformSchema.parse(
              await options.renders!.getWaveform(
                RenderIdSchema.parse(request.params.renderId),
              ),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.get(
      "/api/renders/:renderId/segments",
      async (request, response, next) => {
        try {
          response.json(
            RenderHistorySegmentCollectionSchema.parse(
              await options.renders!.listSegments(
                RenderIdSchema.parse(request.params.renderId),
              ),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.get(
      "/api/renders/:renderId/segments/:ordinal/audio",
      async (request, response, next) => {
        try {
          const input = RenderSegmentInputSchema.parse({
            renderId: request.params.renderId,
            ordinal: Number(request.params.ordinal),
          });
          const media = await options.renders!.resolveSegmentAudio(
            input.renderId,
            input.ordinal,
          );
          streamRenderMedia(request, response, next, media);
        } catch (error) {
          next(error);
        }
      },
    );
    app.post(
      "/api/renders/:renderId/segments/:ordinal/export",
      async (request, response, next) => {
        try {
          const input = RenderSegmentInputSchema.parse({
            renderId: request.params.renderId,
            ordinal: Number(request.params.ordinal),
          });
          const media = await options.renders!.resolveSegmentAudio(
            input.renderId,
            input.ordinal,
          );
          streamRenderMedia(request, response, next, media, "attachment");
        } catch (error) {
          next(error);
        }
      },
    );
    app.get(
      "/api/render-artifacts/:artifactId",
      async (request, response, next) => {
        try {
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
        } catch (error) {
          next(error);
        }
      },
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
      async (request, response, next) => {
        try {
          const input = ScriptGenerationPromptInputSchema.parse(request.body);
          response.json(
            await options.scriptGeneration!.previewPrompt(null, input.kind),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.post(
      "/api/script-generation/prompt-export",
      async (request, response, next) => {
        try {
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
        } catch (error) {
          next(error);
        }
      },
    );
    app.post(
      "/api/script-generation/skill-export",
      async (request, response, next) => {
        try {
          ScriptGenerationSkillInputSchema.parse(request.body);
          sendGeneratedFile(
            response,
            await options.scriptGeneration!.resolveSkillPackage(null),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.post(
      "/api/projects/:projectId/prompt-preview",
      async (request, response, next) => {
        try {
          const input = ScriptGenerationPromptInputSchema.parse(request.body);
          response.json(
            await options.scriptGeneration!.previewPrompt(
              ProjectIdSchema.parse(request.params.projectId),
              input.kind,
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.post(
      "/api/projects/:projectId/prompt-export",
      async (request, response, next) => {
        try {
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
        } catch (error) {
          next(error);
        }
      },
    );
    app.post(
      "/api/projects/:projectId/skill-export",
      async (request, response, next) => {
        try {
          ScriptGenerationSkillInputSchema.parse(request.body);
          sendGeneratedFile(
            response,
            await options.scriptGeneration!.resolveSkillPackage(
              ProjectIdSchema.parse(request.params.projectId),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  if (options.speechCache) {
    app.get("/api/speech-cache", async (_request, response, next) => {
      try {
        response.json(
          SpeechCacheStatusSchema.parse(await options.speechCache!.status()),
        );
      } catch (error) {
        next(error);
      }
    });
    app.delete("/api/speech-cache", async (_request, response, next) => {
      try {
        response.json(
          SpeechCacheCleanupResultSchema.parse(
            await options.speechCache!.clearAll(),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.delete(
      "/api/projects/:projectId/speech-cache",
      async (request, response, next) => {
        try {
          response.json(
            SpeechCacheCleanupResultSchema.parse(
              await options.speechCache!.clearProject(
                ProjectIdSchema.parse(request.params.projectId),
              ),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
    app.delete(
      "/api/speech-cache/:cacheKey",
      async (request, response, next) => {
        try {
          const { cacheKey } = SpeechCacheKeyInputSchema.parse(request.params);
          response.json(
            SpeechCacheCleanupResultSchema.parse(
              await options.speechCache!.clearEntry(cacheKey),
            ),
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  const boundaryError: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    let status = 500;
    let code = "PERSISTENCE_BOUNDARY_ERROR";
    let message = "StudyNarrator could not complete the persistence operation.";
    let issues: Array<{ path: string; message: string }> | undefined;
    const errorRecord =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : undefined;
    const zodIssues =
      errorRecord && Array.isArray(errorRecord.issues)
        ? errorRecord.issues.filter(
            (issue): issue is { path: PropertyKey[]; message: string } => {
              if (!issue || typeof issue !== "object") return false;
              const record = issue as Record<string, unknown>;
              return (
                Array.isArray(record.path) && typeof record.message === "string"
              );
            },
          )
        : undefined;
    if (zodIssues) {
      status = 400;
      code = "VALIDATION_ERROR";
      message = "The request does not match the persistence contract.";
      issues = zodIssues.map((issue) => ({
        path: issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`,
        message: issue.message,
      }));
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
      message =
        "Persistence is unavailable until the database migration is repaired.";
    } else if (errorRecord?.code === "BACKUP_RESTORE_FAILED") {
      status = 422;
      code = "BACKUP_RESTORE_FAILED";
      message =
        typeof errorRecord.message === "string"
          ? errorRecord.message
          : "The selected backup could not be restored.";
    } else if (errorRecord?.code === "CONNECTION_POLICY") {
      status = 409;
      code = "CONNECTION_POLICY";
      message =
        typeof errorRecord.message === "string"
          ? errorRecord.message
          : "The connection operation is managed by this installation.";
    } else if (errorRecord?.code === "CONNECTION_CONFIGURATION") {
      status = 409;
      code = "CONNECTION_CONFIGURATION";
      message = "Test this connection before exporting diagnostics.";
    } else if (
      typeof errorRecord?.code === "string" &&
      errorRecord.code.startsWith("CONNECTION_CATALOG_")
    ) {
      code = errorRecord.code;
      const catalogStatus: Record<string, number> = {
        CONNECTION_CATALOG_ABORTED: 499,
        CONNECTION_CATALOG_AUTHENTICATION: 401,
        CONNECTION_CATALOG_CONFIGURATION: 409,
        CONNECTION_CATALOG_INVALID_RESPONSE: 502,
        CONNECTION_CATALOG_UNAVAILABLE: 503,
      };
      status = catalogStatus[errorRecord.code] ?? 500;
      message =
        typeof errorRecord.message === "string"
          ? errorRecord.message
          : "StudyNarrator could not discover supported speech models and voices.";
    } else if (
      typeof errorRecord?.code === "string" &&
      errorRecord.code.startsWith("SCRATCHPAD_")
    ) {
      code = errorRecord.code;
      const scratchpadStatus: Record<string, number> = {
        SCRATCHPAD_ABORTED: 499,
        SCRATCHPAD_AUTHENTICATION: 401,
        SCRATCHPAD_CONFIGURATION: 409,
        SCRATCHPAD_INVALID_AUDIO: 502,
        SCRATCHPAD_SELECTION_REJECTED: 422,
        SCRATCHPAD_UNAVAILABLE: 503,
      };
      status = scratchpadStatus[errorRecord.code] ?? 500;
      message =
        typeof errorRecord.message === "string"
          ? errorRecord.message
          : "StudyNarrator could not complete speech synthesis.";
    } else if (
      typeof errorRecord?.code === "string" &&
      errorRecord.code.startsWith("PROJECT_PREVIEW_")
    ) {
      code = errorRecord.code;
      const previewStatus: Record<string, number> = {
        PROJECT_PREVIEW_ABORTED: 499,
        PROJECT_PREVIEW_AUTHENTICATION: 401,
        PROJECT_PREVIEW_CONFIGURATION: 409,
        PROJECT_PREVIEW_INVALID_AUDIO: 502,
        PROJECT_PREVIEW_INVALID_SEGMENT: 422,
        PROJECT_PREVIEW_SELECTION_REJECTED: 422,
        PROJECT_PREVIEW_UNAVAILABLE: 503,
      };
      status = previewStatus[errorRecord.code] ?? 500;
      message =
        typeof errorRecord.message === "string"
          ? errorRecord.message
          : "StudyNarrator could not complete the project preview.";
    } else if (
      typeof errorRecord?.code === "string" &&
      errorRecord.code.startsWith("RENDER_PLAN_")
    ) {
      code = errorRecord.code;
      const renderPlanStatus: Record<string, number> = {
        RENDER_PLAN_CONFIGURATION: 409,
        RENDER_PLAN_INVALID_PROJECT: 422,
        RENDER_PLAN_NOT_FOUND: 404,
        RENDER_PLAN_STORAGE: 500,
      };
      status = renderPlanStatus[errorRecord.code] ?? 500;
      message =
        typeof errorRecord.message === "string"
          ? errorRecord.message
          : "StudyNarrator could not complete the render plan operation.";
    } else if (errorRecord?.code === "RENDER_MEDIA_UNAVAILABLE") {
      status = 404;
      code = "RENDER_MEDIA_UNAVAILABLE";
      message = "The requested render audio is unavailable.";
    } else if (
      typeof errorRecord?.code === "string" &&
      errorRecord.code.startsWith("SCRIPT_GENERATION_")
    ) {
      code = errorRecord.code;
      status = errorRecord.code === "SCRIPT_GENERATION_NOT_FOUND" ? 404 : 500;
      message =
        typeof errorRecord.message === "string"
          ? errorRecord.message
          : "StudyNarrator could not generate the requested export.";
    }
    response.status(status).json(
      BoundaryErrorSchema.parse({
        error: {
          code,
          message,
          ...(issues === undefined ? {} : { issues }),
        },
      }),
    );
  };
  app.use(boundaryError);

  return app;
}
