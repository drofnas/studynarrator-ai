import {
  BoundaryErrorSchema,
  EmptyResponseSchema,
  GlobalLexiconEntryCollectionSchema,
  IgnoredDiagnosticCollectionSchema,
  PersistenceStatusSchema,
  ProjectDetailSchema,
  ProjectSummaryCollectionSchema,
  SystemTimingConfigurationSchema,
  type PersistenceClient,
  type StudyNarratorBridge
} from "@studynarrator/shared-types";

declare global {
  interface Window {
    studyNarrator?: StudyNarratorBridge;
  }
}

export class PersistenceClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly issues: readonly { path: string; message: string }[]
  ) {
    super(message);
  }
}

interface RuntimeSchema<T> { parse(value: unknown): T }

export function createRestPersistenceClient(fetchInput: typeof fetch = fetch): PersistenceClient {
  const request = async <T>(path: string, schema: RuntimeSchema<T>, init?: RequestInit): Promise<T> => {
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
      try { boundary = BoundaryErrorSchema.parse(await response.json()); } catch { /* stable fallback below */ }
      throw new PersistenceClientError(
        boundary?.error.message ?? "The persistence service returned an invalid response.",
        boundary?.error.code ?? "INVALID_BOUNDARY_RESPONSE",
        response.status,
        boundary?.error.issues ?? []
      );
    }
    if (response.status === 204) return schema.parse({});
    return schema.parse(await response.json());
  };
  const body = (value: unknown): string => JSON.stringify(value);

  return {
    status: async () => await request("/api/persistence/status", PersistenceStatusSchema),
    projects: {
      list: async () => await request("/api/projects", ProjectSummaryCollectionSchema),
      create: async (input) => await request("/api/projects", ProjectDetailSchema, { method: "POST", body: body(input) }),
      get: async (projectId) => await request(`/api/projects/${encodeURIComponent(projectId)}`, ProjectDetailSchema),
      replace: async (projectId, input) => await request(`/api/projects/${encodeURIComponent(projectId)}`, ProjectDetailSchema, { method: "PUT", body: body(input) }),
      duplicate: async (projectId, input) => await request(`/api/projects/${encodeURIComponent(projectId)}/duplicate`, ProjectDetailSchema, { method: "POST", body: body(input) }),
      async delete(projectId) {
        await request(`/api/projects/${encodeURIComponent(projectId)}`, EmptyResponseSchema, { method: "DELETE" });
      }
    },
    settings: {
      getPacing: async () => await request("/api/settings/pacing", SystemTimingConfigurationSchema),
      updatePacing: async (input) => await request("/api/settings/pacing", SystemTimingConfigurationSchema, { method: "PUT", body: body(input) })
    },
    preferences: {
      getIgnoredDiagnostics: async () => await request("/api/preferences/ignored-diagnostics", IgnoredDiagnosticCollectionSchema),
      replaceIgnoredDiagnostics: async (input) => await request("/api/preferences/ignored-diagnostics", IgnoredDiagnosticCollectionSchema, { method: "PUT", body: body(input) })
    },
    globalLexicon: {
      list: async () => await request("/api/lexicon/global", GlobalLexiconEntryCollectionSchema),
      replace: async (input) => await request("/api/lexicon/global", GlobalLexiconEntryCollectionSchema, { method: "PUT", body: body(input) })
    }
  };
}

export function resolvePersistenceClient(browserWindow: Window = window): PersistenceClient {
  return browserWindow.studyNarrator?.persistence ?? createRestPersistenceClient();
}
