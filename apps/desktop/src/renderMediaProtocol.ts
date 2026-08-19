import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  parseRenderMediaRange,
  type RenderService,
} from "@studynarrator/application";
import { RenderIdSchema } from "@studynarrator/shared-types";

export function createRenderMediaProtocolHandler(
  renders: RenderService,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean);
      const renderId = RenderIdSchema.parse(parts[0]);
      const media =
        url.protocol === "studynarrator-media:" &&
        url.hostname === "render" &&
        parts.length === 1
          ? await renders.resolveRenderAudio(renderId)
          : url.protocol === "studynarrator-media:" &&
              url.hostname === "segment" &&
              parts.length === 2
            ? await renders.resolveSegmentAudio(renderId, Number(parts[1]))
            : null;
      if (!media) return new Response("Not found.", { status: 404 });
      const range = parseRenderMediaRange(
        request.headers.get("range") ?? undefined,
        media.sizeBytes,
      );
      const headers = new Headers({
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${media.fileName.replace(/["\\\r\n]/gu, "_")}"`,
        "content-type": media.mimeType,
      });
      if (range.status === "unsatisfiable") {
        headers.set("content-range", `bytes */${String(media.sizeBytes)}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("content-length", String(range.end - range.start + 1));
      if (range.status === "partial")
        headers.set(
          "content-range",
          `bytes ${String(range.start)}-${String(range.end)}/${String(media.sizeBytes)}`,
        );
      if (request.method === "HEAD")
        return new Response(null, {
          status: range.status === "partial" ? 206 : 200,
          headers,
        });
      const body = Readable.toWeb(
        createReadStream(media.path, { start: range.start, end: range.end }),
      ) as ReadableStream<Uint8Array>;
      return new Response(body, {
        status: range.status === "partial" ? 206 : 200,
        headers,
      });
    } catch {
      return new Response("Not found.", { status: 404 });
    }
  };
}
