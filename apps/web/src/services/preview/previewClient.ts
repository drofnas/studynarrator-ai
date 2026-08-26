import {
  BoundaryErrorSchema,
  ProjectPreviewResultSchema,
  SpeechCacheCleanupResultSchema,
  SpeechCacheClearAllInputSchema,
  SpeechCacheStatusSchema,
  type ProjectPreviewClient,
  type SpeechCacheClient,
  type StudyNarratorBridge,
} from "@studynarrator/shared-types";

declare global {
  interface Window {
    studyNarrator?: StudyNarratorBridge;
  }
}

class PreviewClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface RuntimeSchema<T> {
  parse(value: unknown): T;
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
      throw new PreviewClientError(
        boundary?.error.message ??
          "StudyNarrator returned an invalid preview or cache response.",
        boundary?.error.code ?? "INVALID_BOUNDARY_RESPONSE",
        response.status,
      );
    }
    return schema.parse(await response.json());
  };
}

export function createRestProjectPreviewClient(
  fetchInput: typeof fetch = fetch,
): ProjectPreviewClient {
  const request = createRequest(fetchInput);
  return {
    async preview(projectId, input, signal) {
      return await request(
        `/api/projects/${encodeURIComponent(projectId)}/preview`,
        ProjectPreviewResultSchema,
        {
          method: "POST",
          body: JSON.stringify(input),
          ...(signal === undefined ? {} : { signal }),
        },
      );
    },
  };
}

export function createRestSpeechCacheClient(
  fetchInput: typeof fetch = fetch,
): SpeechCacheClient {
  const request = createRequest(fetchInput);
  return {
    async status() {
      return await request("/api/speech-cache", SpeechCacheStatusSchema);
    },
    async clearAll(input) {
      return await request(
        "/api/speech-cache",
        SpeechCacheCleanupResultSchema,
        {
          method: "DELETE",
          body: JSON.stringify(SpeechCacheClearAllInputSchema.parse(input)),
        },
      );
    },
    async clearProject(projectId) {
      return await request(
        `/api/projects/${encodeURIComponent(projectId)}/speech-cache`,
        SpeechCacheCleanupResultSchema,
        { method: "DELETE" },
      );
    },
    async clearEntry(cacheKey) {
      return await request(
        `/api/speech-cache/${encodeURIComponent(cacheKey)}`,
        SpeechCacheCleanupResultSchema,
        { method: "DELETE" },
      );
    },
  };
}

export function resolveProjectPreviewClient(
  browserWindow: Window = window,
): ProjectPreviewClient {
  return (
    browserWindow.studyNarrator?.projectPreview ??
    createRestProjectPreviewClient()
  );
}

export function resolveSpeechCacheClient(
  browserWindow: Window = window,
): SpeechCacheClient {
  return (
    browserWindow.studyNarrator?.speechCache ?? createRestSpeechCacheClient()
  );
}
