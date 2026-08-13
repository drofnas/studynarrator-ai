import {
  BoundaryErrorSchema,
  RenderArtifactCollectionSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  type RenderClient,
  type StudyNarratorBridge
} from "@studynarrator/shared-types";

declare global { interface Window { studyNarrator?: StudyNarratorBridge } }

async function read<T>(response: Response, parse: (input: unknown) => T): Promise<T> {
  const body = await response.json() as unknown;
  if (!response.ok) {
    const failure = BoundaryErrorSchema.safeParse(body);
    throw new Error(failure.success ? failure.data.error.message : "StudyNarrator could not complete the render operation.");
  }
  return parse(body);
}

export function createRestRenderClient(fetchInput: typeof fetch = fetch): RenderClient {
  return {
    async start(planId) {
      return await read(await fetchInput(`/api/render-plans/${encodeURIComponent(planId)}/renders`, { method: "POST" }), (body) => RenderJobSchema.parse(body));
    },
    async list(projectId) {
      return await read(await fetchInput(`/api/projects/${encodeURIComponent(projectId)}/renders`), (body) => RenderJobCollectionSchema.parse(body));
    },
    async get(renderId) {
      return await read(await fetchInput(`/api/renders/${encodeURIComponent(renderId)}`), (body) => RenderJobSchema.parse(body));
    },
    async cancel(renderId) {
      return await read(await fetchInput(`/api/renders/${encodeURIComponent(renderId)}/cancel`, { method: "POST" }), (body) => RenderJobSchema.parse(body));
    },
    async retry(renderId) {
      return await read(await fetchInput(`/api/renders/${encodeURIComponent(renderId)}/retry`, { method: "POST" }), (body) => RenderJobSchema.parse(body));
    },
    async listArtifacts(renderId) {
      return await read(await fetchInput(`/api/renders/${encodeURIComponent(renderId)}/artifacts`), (body) => RenderArtifactCollectionSchema.parse(body));
    },
    async exportArtifact(artifactId) {
      const anchor = document.createElement("a");
      anchor.href = `/api/render-artifacts/${encodeURIComponent(artifactId)}`;
      anchor.download = "";
      anchor.click();
      return await Promise.resolve({ disposition: "download" as const, fileName: "render artifact" });
    }
  };
}

export function resolveRenderClient(browserWindow: Window = window): RenderClient {
  return browserWindow.studyNarrator?.renders ?? createRestRenderClient();
}
