import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import type {
  PersistenceClient,
  ProjectPreviewClient,
  ScratchpadClient,
  SpeechBackendConnectionClient,
  SpeechCacheClient,
  VoiceCatalogClient,
} from "@studynarrator/shared-types";
import {
  parseRenderMediaRange,
  type DiagnosticsContext,
  type RenderService,
  type ResolvedRenderMedia,
  type ScriptGenerationService,
  type SystemService,
} from "@studynarrator/application";
import { boundaryError } from "./errorMiddleware.js";
import { createConnectionRouter } from "./routes/connection.js";
import { createPersistenceRouter } from "./routes/persistence.js";
import { createPreviewRouter } from "./routes/preview.js";
import { createRendersRouter } from "./routes/renders.js";
import { createScratchpadRouter } from "./routes/scratchpad.js";
import { createScriptGenerationRouter } from "./routes/scriptGeneration.js";
import { createSpeechCacheRouter } from "./routes/speechCache.js";
import { createSystemRouter } from "./routes/system.js";
import { createVoiceCatalogRouter } from "./routes/voiceCatalog.js";

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

  createSystemRouter(
    { service: options.service, context: options.context },
    app,
  );

  if (options.persistence) {
    createPersistenceRouter(options.persistence, app);
  }

  createConnectionRouter(options.connection, persistenceUnavailable, app);

  createVoiceCatalogRouter(options.voiceCatalog, persistenceUnavailable, app);

  createScratchpadRouter(options.scratchpad, app);

  createPreviewRouter(options.projectPreview, app);

  createRendersRouter(options.renders, streamRenderMedia, app);

  createScriptGenerationRouter(options.scriptGeneration, app);

  createSpeechCacheRouter(options.speechCache, app);

  app.use(boundaryError);

  return app;
}
