// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRestRenderClient } from "./renderClient.js";

const renderId = "00000000-0000-4000-8000-000000000003";

describe("render REST client", () => {
  it("validates review metadata and constructs scoped playback sources", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(url.endsWith("/segments")
        ? []
        : { status: "unavailable", renderId, reason: "audioMissing" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const client = createRestRenderClient(fetchMock as typeof fetch);
    await expect(client.listSegments(renderId)).resolves.toEqual([]);
    await expect(client.getWaveform(renderId)).resolves.toEqual({ status: "unavailable", renderId, reason: "audioMissing" });
    expect(client.renderAudioSource(renderId)).toBe(`/api/renders/${renderId}/audio`);
    expect(client.segmentAudioSource(renderId, 12)).toBe(`/api/renders/${renderId}/segments/12/audio`);
    expect(() => client.segmentAudioSource(renderId, 0)).toThrow();
    expect(() => client.renderAudioSource("../outside")).toThrow();
  });

  it("exports one bounded segment through an explicit download", async () => {
    const fetchMock = vi.fn(async () => new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "audio/wav", "content-disposition": "attachment; filename=\"000007.wav\"" }
    }));
    const createObjectURL = vi.fn(() => "blob:segment");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const client = createRestRenderClient(fetchMock as typeof fetch);
    await expect(client.exportSegment(renderId, 7)).resolves.toEqual({ disposition: "download", fileName: "000007.wav" });
    expect(fetchMock).toHaveBeenCalledWith(`/api/renders/${renderId}/segments/7/export`, { method: "POST" });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:segment");
    vi.unstubAllGlobals();
  });
});
