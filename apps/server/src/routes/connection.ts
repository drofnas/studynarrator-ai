import { Router, type RequestHandler } from "express";
import {
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
  RedactedConnectionDiagnosticsSchema,
  SpeechBackendConnectionAuthoringSchema,
  SpeechBackendConnectionSchema,
  SpeechCatalogDiscoveryInputSchema,
  SpeechCatalogSchema,
  type SpeechBackendConnectionClient,
} from "@studynarrator/shared-types";
import { asyncHandler } from "../asyncHandler.js";

export function createConnectionRouter(
  connection: SpeechBackendConnectionClient | undefined,
  persistenceUnavailable: RequestHandler,
  router: Router = Router(),
): Router {
  if (connection) {
    router.get(
      "/api/connection",
      asyncHandler(async (_request, response) => {
        response.json(
          SpeechBackendConnectionSchema.parse(await connection.get()),
        );
      }),
    );
    router.put(
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
    router.post(
      "/api/connection/test",
      asyncHandler(async (_request, response) => {
        response.json(
          ConnectionTestSummarySchema.parse(await connection.test()),
        );
      }),
    );
    router.post(
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
    router.get(
      "/api/connection/diagnostics",
      asyncHandler(async (_request, response) => {
        response.json(
          RedactedConnectionDiagnosticsSchema.parse(
            await connection.exportDiagnostics(),
          ),
        );
      }),
    );
    router.get(
      "/api/setup",
      asyncHandler(async (_request, response) => {
        response.json(
          ConnectionSetupStateSchema.parse(await connection.getSetupState()),
        );
      }),
    );
    router.post(
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
    router.get("/api/connection", persistenceUnavailable);
    router.put("/api/connection", persistenceUnavailable);
    router.post("/api/connection/test", persistenceUnavailable);
    router.post("/api/connection/speech-catalog", persistenceUnavailable);
    router.get("/api/connection/diagnostics", persistenceUnavailable);
    router.get("/api/setup", persistenceUnavailable);
    router.post("/api/setup/complete", persistenceUnavailable);
  }

  return router;
}
