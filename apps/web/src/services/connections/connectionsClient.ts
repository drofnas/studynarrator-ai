import {
  BoundaryErrorSchema,
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
  RedactedConnectionDiagnosticsSchema,
  SpeechBackendConnectionSchema,
  SpeechCatalogSchema,
  VoiceCatalogSchema,
  type SpeechBackendConnectionClient,
  type StudyNarratorBridge,
  type VoiceCatalogClient,
} from "@studynarrator/shared-types";

declare global {
  interface Window {
    studyNarrator?: StudyNarratorBridge;
  }
}
interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

class ConnectionClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function createRequest(fetchInput: typeof fetch) {
  return async <T>(
    path: string,
    schema: RuntimeSchema<T>,
    init?: RequestInit,
  ): Promise<T> => {
    const response = await fetchInput(path, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      let boundary;
      try {
        boundary = BoundaryErrorSchema.parse(await response.json());
      } catch {
        /* stable fallback */
      }
      throw new ConnectionClientError(
        boundary?.error.message ??
          "The connection service returned an invalid response.",
        boundary?.error.code ?? "INVALID_BOUNDARY_RESPONSE",
        response.status,
      );
    }
    return schema.parse(await response.json());
  };
}

export function createRestConnectionClient(
  fetchInput: typeof fetch = fetch,
): SpeechBackendConnectionClient {
  const request = createRequest(fetchInput);
  return {
    get: async () =>
      await request("/api/connection", SpeechBackendConnectionSchema),
    update: async (input) =>
      await request("/api/connection", SpeechBackendConnectionSchema, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    test: async () =>
      await request("/api/connection/test", ConnectionTestSummarySchema, {
        method: "POST",
      }),
    discoverSpeechCatalog: async (input, signal) =>
      await request("/api/connection/speech-catalog", SpeechCatalogSchema, {
        method: "POST",
        body: JSON.stringify(input),
        ...(signal === undefined ? {} : { signal }),
      }),
    exportDiagnostics: async () =>
      await request(
        "/api/connection/diagnostics",
        RedactedConnectionDiagnosticsSchema,
      ),
    getSetupState: async () =>
      await request("/api/setup", ConnectionSetupStateSchema),
    completeOnboarding: async () =>
      await request("/api/setup/complete", ConnectionSetupStateSchema, {
        method: "POST",
      }),
  };
}

export function createRestVoiceCatalogClient(
  fetchInput: typeof fetch = fetch,
): VoiceCatalogClient {
  const request = createRequest(fetchInput);
  return {
    get: async (modelId) =>
      await request(
        `/api/voice-catalog?modelId=${encodeURIComponent(modelId)}`,
        VoiceCatalogSchema,
      ),
    replace: async (input) =>
      await request("/api/voice-catalog", VoiceCatalogSchema, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
  };
}

export function resolveConnectionClient(
  browserWindow: Window = window,
): SpeechBackendConnectionClient {
  return (
    browserWindow.studyNarrator?.connection ?? createRestConnectionClient()
  );
}

export function resolveVoiceCatalogClient(
  browserWindow: Window = window,
): VoiceCatalogClient {
  return (
    browserWindow.studyNarrator?.voiceCatalog ?? createRestVoiceCatalogClient()
  );
}
