import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RenderService } from "@studynarrator/application";
import { createRenderMediaProtocolHandler } from "./renderMediaProtocol.js";

const renderId = "00000000-0000-4000-8000-000000000003";

describe("Electron render media protocol", () => {
  it("streams only resolved media with byte-range and HEAD support", async () => {
    const root = await mkdtemp(join(tmpdir(), "studynarrator-protocol-"));
    const path = join(root, "audio.wav");
    await writeFile(path, Uint8Array.from([1, 2, 3, 4]));
    const renders = {
      resolveRenderAudio: vi.fn(async () => ({ path, fileName: "audio.mp3", mimeType: "audio/mpeg" as const, sizeBytes: 4 })),
      resolveSegmentAudio: vi.fn(async () => ({ path, fileName: "000001.wav", mimeType: "audio/wav" as const, sizeBytes: 4 }))
    } as unknown as RenderService;
    const handle = createRenderMediaProtocolHandler(renders);

    const partial = await handle(new Request(`studynarrator-media://segment/${renderId}/1`, { headers: { range: "bytes=1-2" } }));
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 1-2/4");
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(Uint8Array.from([2, 3]));

    const head = await handle(new Request(`studynarrator-media://render/${renderId}`, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("4");
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const invalidRange = await handle(new Request(`studynarrator-media://render/${renderId}`, { headers: { range: "bytes=9-10" } }));
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get("content-range")).toBe("bytes */4");
  });

  it("rejects malformed IDs, paths, and ranges without invoking a resolver", async () => {
    const resolveRenderAudio = vi.fn();
    const resolveSegmentAudio = vi.fn();
    const renders = { resolveRenderAudio, resolveSegmentAudio } as unknown as RenderService;
    const handle = createRenderMediaProtocolHandler(renders);
    await expect(handle(new Request("studynarrator-media://render/not-a-uuid"))).resolves.toMatchObject({ status: 404 });
    await expect(handle(new Request(`studynarrator-media://segment/${renderId}/1/extra`))).resolves.toMatchObject({ status: 404 });
    expect(resolveRenderAudio).not.toHaveBeenCalled();
    expect(resolveSegmentAudio).not.toHaveBeenCalled();
  });
});
