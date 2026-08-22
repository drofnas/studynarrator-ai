import {
  BoundaryErrorSchema,
  RenderArtifactCollectionSchema,
  RenderEstimateContextInputSchema,
  RenderEstimateContextResultSchema,
  RenderHistorySegmentCollectionSchema,
  RenderIdSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  RenderStartOptionsSchema,
  RenderWaveformSchema,
  type RenderClient,
  type RenderJob,
  type StudyNarratorBridge,
} from "@studynarrator/shared-types";

declare global {
  interface Window {
    studyNarrator?: StudyNarratorBridge;
  }
}

async function read<T>(
  response: Response,
  parse: (input: unknown) => T,
): Promise<T> {
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const failure = BoundaryErrorSchema.safeParse(body);
    throw new Error(
      failure.success
        ? failure.data.error.message
        : "StudyNarrator could not complete the render operation.",
    );
  }
  return parse(body);
}

export interface RenderProgressClient extends RenderClient {
  subscribe?: (
    renderId: string,
    onJob: (job: RenderJob) => void,
    onDropped: () => void,
  ) => () => void;
}

type RenderEventSourceFactory = (url: string) => EventSource;

export function createRestRenderClient(
  fetchInput: typeof fetch = fetch,
  createEventSource: RenderEventSourceFactory = (url) => new EventSource(url),
): RenderProgressClient {
  return {
    async getEstimateContext(input) {
      const parsed = RenderEstimateContextInputSchema.parse(input);
      return await read(
        await fetchInput("/api/renders/estimate-context", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed),
        }),
        (body) => RenderEstimateContextResultSchema.parse(body),
      );
    },
    async startProject(projectId, options) {
      const parsed = RenderStartOptionsSchema.parse(options);
      return await read(
        await fetchInput(
          `/api/projects/${encodeURIComponent(projectId)}/renders`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(parsed),
          },
        ),
        (body) => RenderJobSchema.parse(body),
      );
    },
    async list(projectId) {
      return await read(
        await fetchInput(
          `/api/projects/${encodeURIComponent(projectId)}/renders`,
        ),
        (body) => RenderJobCollectionSchema.parse(body),
      );
    },
    async get(renderId) {
      return await read(
        await fetchInput(`/api/renders/${encodeURIComponent(renderId)}`),
        (body) => RenderJobSchema.parse(body),
      );
    },
    subscribe(renderId, onJob, onDropped) {
      const source = createEventSource(
        `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/events`,
      );
      let closed = false;
      let dropped = false;

      const close = () => {
        if (closed) return;
        closed = true;
        source.close();
      };
      const reportDropped = () => {
        if (closed || dropped) return;
        dropped = true;
        onDropped();
      };
      const parse = (event: MessageEvent<string>) => {
        if (closed) return undefined;
        try {
          return RenderJobSchema.parse(JSON.parse(event.data) as unknown);
        } catch {
          close();
          if (!dropped) {
            dropped = true;
            onDropped();
          }
          return undefined;
        }
      };

      source.addEventListener("progress", (event) => {
        const job = parse(event as MessageEvent<string>);
        if (job) onJob(job);
      });
      source.addEventListener("terminal", (event) => {
        const job = parse(event as MessageEvent<string>);
        if (!job) return;
        try {
          onJob(job);
        } finally {
          close();
        }
      });
      source.addEventListener("error", reportDropped);

      return close;
    },
    async cancel(renderId) {
      return await read(
        await fetchInput(
          `/api/renders/${encodeURIComponent(renderId)}/cancel`,
          { method: "POST" },
        ),
        (body) => RenderJobSchema.parse(body),
      );
    },
    async retry(renderId) {
      return await read(
        await fetchInput(`/api/renders/${encodeURIComponent(renderId)}/retry`, {
          method: "POST",
        }),
        (body) => RenderJobSchema.parse(body),
      );
    },
    async listArtifacts(renderId) {
      return await read(
        await fetchInput(
          `/api/renders/${encodeURIComponent(renderId)}/artifacts`,
        ),
        (body) => RenderArtifactCollectionSchema.parse(body),
      );
    },
    async exportArtifact(artifactId) {
      const anchor = document.createElement("a");
      anchor.href = `/api/render-artifacts/${encodeURIComponent(artifactId)}`;
      anchor.download = "";
      anchor.click();
      return await Promise.resolve({
        disposition: "download" as const,
        fileName: "render artifact",
      });
    },
    exportAudio(renderId) {
      const anchor = document.createElement("a");
      anchor.href = `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/download`;
      anchor.download = "";
      anchor.click();
      return Promise.resolve({
        disposition: "download" as const,
        fileName: "render audio",
      });
    },
    exportDetails(renderId) {
      const anchor = document.createElement("a");
      anchor.href = `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/details`;
      anchor.download = "";
      anchor.click();
      return Promise.resolve({
        disposition: "download" as const,
        fileName: "render details",
      });
    },
    async listSegments(renderId) {
      return await read(
        await fetchInput(
          `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/segments`,
        ),
        (body) => RenderHistorySegmentCollectionSchema.parse(body),
      );
    },
    async getWaveform(renderId) {
      return await read(
        await fetchInput(
          `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/waveform`,
        ),
        (body) => RenderWaveformSchema.parse(body),
      );
    },
    renderAudioSource(renderId) {
      return `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/audio`;
    },
    segmentAudioSource(renderId, ordinal) {
      if (!Number.isInteger(ordinal) || ordinal < 1)
        throw new Error("The render segment ordinal is invalid.");
      return `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/segments/${String(ordinal)}/audio`;
    },
    async exportSegment(renderId, ordinal) {
      if (!Number.isInteger(ordinal) || ordinal < 1)
        throw new Error("The render segment ordinal is invalid.");
      const response = await fetchInput(
        `/api/renders/${encodeURIComponent(RenderIdSchema.parse(renderId))}/segments/${String(ordinal)}/export`,
        { method: "POST" },
      );
      if (!response.ok) {
        let body: unknown;
        try {
          body = (await response.json()) as unknown;
        } catch {
          body = null;
        }
        const failure = BoundaryErrorSchema.safeParse(body);
        throw new Error(
          failure.success
            ? failure.data.error.message
            : "StudyNarrator could not export the render segment.",
        );
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const fileName =
        /filename="([^"]+)"/u.exec(
          response.headers.get("content-disposition") ?? "",
        )?.[1] ?? `segment-${String(ordinal).padStart(6, "0")}.wav`;
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
      return { disposition: "download" as const, fileName };
    },
  };
}

export function resolveRenderClient(
  browserWindow: Window = window,
): RenderProgressClient {
  return browserWindow.studyNarrator?.renders ?? createRestRenderClient();
}
