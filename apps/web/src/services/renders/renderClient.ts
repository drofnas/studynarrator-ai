import {
  BoundaryErrorSchema,
  RenderArtifactCollectionSchema,
  RenderHistorySegmentCollectionSchema,
  RenderIdSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  RenderWaveformSchema,
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
    async startProject(projectId) {
      return await read(await fetchInput(`/api/projects/${encodeURIComponent(projectId)}/renders`, { method: "POST" }), (body) => RenderJobSchema.parse(body));
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
    },
    exportAudio(renderId) {
      const anchor = document.createElement("a");
      anchor.href = `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/download`;
      anchor.download = "";
      anchor.click();
      return Promise.resolve({ disposition: "download" as const, fileName: "render audio" });
    },
    exportDetails(renderId) {
      const anchor = document.createElement("a");
      anchor.href = `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/details`;
      anchor.download = "";
      anchor.click();
      return Promise.resolve({ disposition: "download" as const, fileName: "render details" });
    },
    async listSegments(renderId) {
      return await read(await fetchInput(`/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/segments`), (body) => RenderHistorySegmentCollectionSchema.parse(body));
    },
    async getWaveform(renderId) {
      return await read(await fetchInput(`/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/waveform`), (body) => RenderWaveformSchema.parse(body));
    },
    renderAudioSource(renderId) {
      return `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/audio`;
    },
    segmentAudioSource(renderId, ordinal) {
      if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error("The render segment ordinal is invalid.");
      return `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/segments/${String(ordinal)}/audio`;
    },
    async exportSegment(renderId, ordinal) {
      if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error("The render segment ordinal is invalid.");
      const response = await fetchInput(`/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/segments/${String(ordinal)}/export`, { method: "POST" });
      if (!response.ok) {
        let body: unknown;
        try { body = await response.json() as unknown; } catch { body = null; }
        const failure = BoundaryErrorSchema.safeParse(body);
        throw new Error(failure.success ? failure.data.error.message : "StudyNarrator could not export the render segment.");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const fileName = /filename="([^"]+)"/u.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? `segment-${String(ordinal).padStart(6, "0")}.wav`;
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
      return { disposition: "download" as const, fileName };
    }
  };
}

export function resolveRenderClient(browserWindow: Window = window): RenderClient {
  return browserWindow.studyNarrator?.renders ?? createRestRenderClient();
}
