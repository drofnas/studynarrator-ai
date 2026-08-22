// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { RenderJob } from "@studynarrator/shared-types";
import { createRestRenderClient } from "./renderClient.js";

const renderId = "00000000-0000-4000-8000-000000000003";
const progressJob: RenderJob = {
  contractVersion: 1,
  id: renderId,
  projectId: "00000000-0000-4000-8000-000000000001",
  planId: "00000000-0000-4000-8000-000000000002",
  retryOfRenderId: null,
  state: "synthesizing",
  progress: {
    phase: "synthesizing",
    sectionTitle: "Opening",
    sectionOrdinal: 1,
    sectionCount: 1,
    entryOrdinal: 1,
    speechOrdinal: 1,
    speechCount: 1,
    chunkOrdinal: 1,
    completedChunks: 0,
    totalChunks: 1,
    cacheHits: 0,
    cacheMisses: 1,
    ttsRequests: 1,
    speakerId: "teacher",
    voiceId: "voice_teacher",
    excerpt: "Study this.",
    elapsedMs: 500,
  },
  error: null,
  createdAt: "2026-08-12T12:00:00.000Z",
  startedAt: "2026-08-12T12:00:00.100Z",
  finishedAt: null,
};
const terminalJob: RenderJob = {
  ...progressJob,
  state: "complete",
  progress: {
    ...progressJob.progress,
    phase: "complete",
    chunkOrdinal: null,
    completedChunks: 1,
    speakerId: null,
    voiceId: null,
    excerpt: null,
    elapsedMs: 1_000,
  },
  finishedAt: "2026-08-12T12:00:01.000Z",
};

class FakeEventSource {
  readonly close = vi.fn();
  private readonly listeners = new Map<string, Array<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, data?: string): void {
    const event =
      data === undefined ? new Event(type) : new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("render REST client", () => {
  it("posts default-enabled and disabled render start options", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(progressJob), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createRestRenderClient(fetchMock as typeof fetch);

    await expect(client.startProject(progressJob.projectId)).resolves.toEqual(
      progressJob,
    );
    await expect(
      client.startProject(progressJob.projectId, {
        diskSpaceCheckEnabled: false,
      }),
    ).resolves.toEqual(progressJob);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/projects/${progressJob.projectId}/renders`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ diskSpaceCheckEnabled: true }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/projects/${progressJob.projectId}/renders`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ diskSpaceCheckEnabled: false }),
      },
    );
  });

  it("posts strict estimate context and validates the response", async () => {
    const context = {
      freeSpaceBytes: 5_000_000,
      calibrations: [
        {
          modelId: "model",
          voiceId: "voice",
          millisecondsPerNormalizedCharacter: 72,
          sampleCount: 3,
          updatedAt: "2026-08-12T12:00:00.000Z",
        },
      ],
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(context), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createRestRenderClient(fetchMock as typeof fetch);

    await expect(
      client.getEstimateContext({
        modelId: "model",
        voiceIds: ["voice"],
      }),
    ).resolves.toEqual(context);
    expect(fetchMock).toHaveBeenCalledWith("/api/renders/estimate-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: "model", voiceIds: ["voice"] }),
    });
    await expect(
      client.getEstimateContext({
        modelId: "model",
        voiceIds: ["voice", "voice"],
      }),
    ).rejects.toThrow("Estimate voice IDs must be unique");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("validates review metadata and constructs scoped playback sources", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return new Response(
        JSON.stringify(
          url.endsWith("/segments")
            ? []
            : { status: "unavailable", renderId, reason: "audioMissing" },
        ),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const client = createRestRenderClient(fetchMock as typeof fetch);
    await expect(client.listSegments(renderId)).resolves.toEqual([]);
    await expect(client.getWaveform(renderId)).resolves.toEqual({
      status: "unavailable",
      renderId,
      reason: "audioMissing",
    });
    expect(client.renderAudioSource(renderId)).toBe(
      `/api/renders/${renderId}/audio`,
    );
    expect(client.segmentAudioSource(renderId, 12)).toBe(
      `/api/renders/${renderId}/segments/12/audio`,
    );
    expect(() => client.segmentAudioSource(renderId, 0)).toThrow();
    expect(() => client.renderAudioSource("../outside")).toThrow();
  });

  it("subscribes to validated progress and closes after terminal delivery", () => {
    const source = new FakeEventSource();
    const eventSourceFactory = vi.fn(() => source as unknown as EventSource);
    const client = createRestRenderClient(
      vi.fn() as unknown as typeof fetch,
      eventSourceFactory,
    );
    const onJob = vi.fn();
    const onDropped = vi.fn();

    const unsubscribe = client.subscribe!(renderId, onJob, onDropped);
    expect(eventSourceFactory).toHaveBeenCalledWith(
      `/api/renders/${encodeURIComponent(renderId)}/events`,
    );

    source.emit("progress", JSON.stringify(progressJob));
    source.emit("terminal", JSON.stringify(terminalJob));
    expect(onJob).toHaveBeenNthCalledWith(1, progressJob);
    expect(onJob).toHaveBeenNthCalledWith(2, terminalJob);
    expect(onDropped).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledOnce();

    source.emit("progress", JSON.stringify(progressJob));
    unsubscribe();
    unsubscribe();
    expect(onJob).toHaveBeenCalledTimes(2);
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("reports a dropped connection once while leaving EventSource open to reconnect", () => {
    const source = new FakeEventSource();
    const client = createRestRenderClient(
      vi.fn() as unknown as typeof fetch,
      () => source as unknown as EventSource,
    );
    const onJob = vi.fn();
    const onDropped = vi.fn();

    const unsubscribe = client.subscribe!(renderId, onJob, onDropped);
    source.emit("error");
    source.emit("error");
    expect(onDropped).toHaveBeenCalledOnce();
    expect(source.close).not.toHaveBeenCalled();

    source.emit("progress", JSON.stringify(progressJob));
    expect(onJob).toHaveBeenCalledWith(progressJob);
    unsubscribe();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it.each(["{", JSON.stringify({ ...progressJob, state: "unknown" })])(
    "closes and reports malformed event data %#",
    (data) => {
      const source = new FakeEventSource();
      const client = createRestRenderClient(
        vi.fn() as unknown as typeof fetch,
        () => source as unknown as EventSource,
      );
      const onJob = vi.fn();
      const onDropped = vi.fn();

      const unsubscribe = client.subscribe!(renderId, onJob, onDropped);
      source.emit("progress", data);
      source.emit("error");
      unsubscribe();

      expect(onJob).not.toHaveBeenCalled();
      expect(onDropped).toHaveBeenCalledOnce();
      expect(source.close).toHaveBeenCalledOnce();
    },
  );

  it("exports one bounded segment through an explicit download", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: {
            "content-type": "audio/wav",
            "content-disposition": 'attachment; filename="000007.wav"',
          },
        }),
    );
    const createObjectURL = vi.fn(() => "blob:segment");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const client = createRestRenderClient(fetchMock as typeof fetch);
    await expect(client.exportSegment(renderId, 7)).resolves.toEqual({
      disposition: "download",
      fileName: "000007.wav",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/renders/${renderId}/segments/7/export`,
      { method: "POST" },
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:segment");
    vi.unstubAllGlobals();
  });
});
