import {
  BoundaryErrorSchema,
  ScratchpadPreviewResultSchema,
  type ScratchpadClient,
  type StudyNarratorBridge
} from "@studynarrator/shared-types";

declare global {
  interface Window {
    studyNarrator?: StudyNarratorBridge;
  }
}

export class ScratchpadClientError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

export function createRestScratchpadClient(fetchInput: typeof fetch = fetch): ScratchpadClient {
  return {
    async preview(input, signal) {
      const response = await fetchInput("/api/scratchpad/preview", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(input),
        ...(signal === undefined ? {} : { signal })
      });
      if (!response.ok) {
        let boundary;
        try { boundary = BoundaryErrorSchema.parse(await response.json()); } catch { /* stable fallback */ }
        throw new ScratchpadClientError(
          boundary?.error.message ?? "StudyNarrator returned an invalid synthesis response.",
          boundary?.error.code ?? "INVALID_BOUNDARY_RESPONSE",
          response.status
        );
      }
      return ScratchpadPreviewResultSchema.parse(await response.json());
    }
  };
}

export function resolveScratchpadClient(browserWindow: Window = window): ScratchpadClient {
  return browserWindow.studyNarrator?.scratchpad ?? createRestScratchpadClient();
}
