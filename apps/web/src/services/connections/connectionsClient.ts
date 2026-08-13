import {
  BoundaryErrorSchema,
  ConnectionProfileCollectionSchema,
  ConnectionProfileSchema,
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
  EmptyResponseSchema,
  RedactedConnectionDiagnosticsSchema,
  VoiceCatalogSchema,
  type ConnectionsClient,
  type StudyNarratorBridge,
  type VoiceCatalogClient
} from "@studynarrator/shared-types";

declare global {
  interface Window {
    studyNarrator?: StudyNarratorBridge;
  }
}

interface RuntimeSchema<T> { parse(value: unknown): T }

export class ConnectionClientError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

function createRequest(fetchInput: typeof fetch) {
  return async <T>(path: string, schema: RuntimeSchema<T>, init?: RequestInit): Promise<T> => {
    const response = await fetchInput(path, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
        ...init?.headers
      }
    });
    if (!response.ok) {
      let boundary;
      try { boundary = BoundaryErrorSchema.parse(await response.json()); } catch { /* stable fallback */ }
      throw new ConnectionClientError(
        boundary?.error.message ?? "The connection service returned an invalid response.",
        boundary?.error.code ?? "INVALID_BOUNDARY_RESPONSE",
        response.status
      );
    }
    if (response.status === 204) return schema.parse({});
    return schema.parse(await response.json());
  };
}

export function createRestConnectionsClient(fetchInput: typeof fetch = fetch): ConnectionsClient {
  const request = createRequest(fetchInput);
  const body = (value: unknown) => JSON.stringify(value);
  return {
    list: async () => await request("/api/connections", ConnectionProfileCollectionSchema),
    create: async (input) => await request("/api/connections", ConnectionProfileSchema, { method: "POST", body: body(input) }),
    replace: async (profileId, input) => await request(`/api/connections/${encodeURIComponent(profileId)}`, ConnectionProfileSchema, { method: "PUT", body: body(input) }),
    async delete(profileId) { await request(`/api/connections/${encodeURIComponent(profileId)}`, EmptyResponseSchema, { method: "DELETE" }); },
    test: async (profileId) => await request(`/api/connections/${encodeURIComponent(profileId)}/test`, ConnectionTestSummarySchema, { method: "POST" }),
    exportDiagnostics: async (profileId) => await request(`/api/connections/${encodeURIComponent(profileId)}/diagnostics`, RedactedConnectionDiagnosticsSchema),
    getSetupState: async () => await request("/api/setup", ConnectionSetupStateSchema),
    setActiveProfile: async (profileId) => await request("/api/setup/active-profile", ConnectionSetupStateSchema, { method: "PUT", body: body({ profileId }) }),
    completeOnboarding: async () => await request("/api/setup/complete", ConnectionSetupStateSchema, { method: "POST" })
  };
}

export function createRestVoiceCatalogClient(fetchInput: typeof fetch = fetch): VoiceCatalogClient {
  const request = createRequest(fetchInput);
  return {
    get: async (modelId) => await request(`/api/voice-catalog?modelId=${encodeURIComponent(modelId)}`, VoiceCatalogSchema),
    replace: async (input) => await request("/api/voice-catalog", VoiceCatalogSchema, { method: "PUT", body: JSON.stringify(input) })
  };
}

export function resolveConnectionsClient(browserWindow: Window = window): ConnectionsClient {
  return browserWindow.studyNarrator?.connections ?? createRestConnectionsClient();
}

export function resolveVoiceCatalogClient(browserWindow: Window = window): VoiceCatalogClient {
  return browserWindow.studyNarrator?.voiceCatalog ?? createRestVoiceCatalogClient();
}
