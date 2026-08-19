import {
  BoundaryErrorSchema,
  SystemDiagnosticsSchema,
  type StudyNarratorBridge,
  type SystemClient,
} from "@studynarrator/shared-types";

declare global {
  interface Window {
    studyNarrator?: StudyNarratorBridge;
  }
}

export function createRestClient(
  fetchInput: typeof fetch = fetch,
): SystemClient {
  return {
    async diagnostics() {
      const response = await fetchInput("/api/diagnostics", {
        headers: { accept: "application/json" },
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const boundary = BoundaryErrorSchema.safeParse(body);
        throw new Error(
          boundary.success
            ? boundary.data.error.message
            : "Diagnostics request failed.",
        );
      }
      return SystemDiagnosticsSchema.parse(body);
    },
  };
}

export function resolveSystemClient(
  browserWindow: Window = window,
): SystemClient {
  return browserWindow.studyNarrator?.system ?? createRestClient();
}
