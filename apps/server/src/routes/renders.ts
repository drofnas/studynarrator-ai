import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createReadStream } from "node:fs";
import {
  ProjectIdSchema,
  RenderArtifactIdSchema,
  RenderArtifactCollectionSchema,
  RenderEstimateContextInputSchema,
  RenderEstimateContextResultSchema,
  RenderHistorySegmentCollectionSchema,
  RenderIdSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  RenderSegmentInputSchema,
  RenderWaveformSchema,
  type RenderJob,
} from "@studynarrator/shared-types";
import type {
  RenderService,
  ResolvedRenderMedia,
} from "@studynarrator/application";
import { asyncHandler } from "../asyncHandler.js";

type StreamRenderMedia = (
  request: Request,
  response: Response,
  next: NextFunction,
  media: ResolvedRenderMedia,
  disposition?: "inline" | "attachment",
) => void;

export function createRendersRouter(
  renders: RenderService | undefined,
  streamRenderMedia: StreamRenderMedia,
  router: Router = Router(),
): Router {
  if (renders) {
    router.post(
      "/api/renders/estimate-context",
      asyncHandler(async (request, response) => {
        response.json(
          RenderEstimateContextResultSchema.parse(
            await renders.getEstimateContext(
              RenderEstimateContextInputSchema.parse(request.body),
            ),
          ),
        );
      }),
    );
    router.post(
      "/api/projects/:projectId/renders",
      asyncHandler(async (request, response) => {
        response
          .status(202)
          .json(
            RenderJobSchema.parse(
              await renders.startProject(
                ProjectIdSchema.parse(request.params.projectId),
              ),
            ),
          );
      }),
    );
    router.get(
      "/api/projects/:projectId/renders",
      asyncHandler(async (request, response) => {
        response.json(
          RenderJobCollectionSchema.parse(
            await renders.list(ProjectIdSchema.parse(request.params.projectId)),
          ),
        );
      }),
    );
    router.get(
      "/api/renders/:renderId",
      asyncHandler(async (request, response) => {
        response.json(
          RenderJobSchema.parse(
            await renders.get(RenderIdSchema.parse(request.params.renderId)),
          ),
        );
      }),
    );
    router.get(
      "/api/renders/:renderId/events",
      asyncHandler(async (request, response) => {
        const renderId = RenderIdSchema.parse(request.params.renderId);
        const initial = RenderJobSchema.parse(await renders.get(renderId));
        let closed = false;
        let heartbeat: NodeJS.Timeout | undefined;
        let unsubscribe: (() => void) | undefined;
        let lastSnapshot = "";

        const cleanup = () => {
          if (closed) return;
          closed = true;
          request.off("aborted", cleanup);
          response.off("close", cleanup);
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = undefined;
          }
          const stop = unsubscribe;
          unsubscribe = undefined;
          stop?.();
          if (!response.writableEnded && !response.destroyed) response.end();
        };
        const isTerminal = (job: RenderJob) =>
          job.state === "complete" ||
          job.state === "failed" ||
          job.state === "canceled";
        const emit = (job: RenderJob) => {
          if (closed || response.writableEnded || response.destroyed) return;
          const snapshot = JSON.stringify(RenderJobSchema.parse(job));
          response.write(
            `event: ${isTerminal(job) ? "terminal" : "progress"}\ndata: ${snapshot}\n\n`,
          );
          lastSnapshot = snapshot;
          if (isTerminal(job)) cleanup();
        };

        request.once("aborted", cleanup);
        response.once("close", cleanup);
        response.status(200);
        response.setHeader("content-type", "text/event-stream");
        response.setHeader("cache-control", "no-cache");
        response.setHeader("connection", "keep-alive");
        response.setHeader("x-accel-buffering", "no");
        response.flushHeaders();
        emit(initial);
        if (closed) return;

        heartbeat = setInterval(() => {
          if (!closed && !response.writableEnded && !response.destroyed)
            response.write(": heartbeat\n\n");
        }, 15_000);
        heartbeat.unref();

        const stop = renders.subscribe(renderId, emit);
        if (closed) {
          stop();
          return;
        }
        unsubscribe = stop;

        const reconciled = RenderJobSchema.parse(await renders.get(renderId));
        if (!closed && JSON.stringify(reconciled) !== lastSnapshot)
          emit(reconciled);
      }),
    );
    router.post(
      "/api/renders/:renderId/cancel",
      asyncHandler(async (request, response) => {
        response.json(
          RenderJobSchema.parse(
            await renders.cancel(RenderIdSchema.parse(request.params.renderId)),
          ),
        );
      }),
    );
    router.post(
      "/api/renders/:renderId/retry",
      asyncHandler(async (request, response) => {
        response
          .status(202)
          .json(
            RenderJobSchema.parse(
              await renders.retry(
                RenderIdSchema.parse(request.params.renderId),
              ),
            ),
          );
      }),
    );
    router.get(
      "/api/renders/:renderId/artifacts",
      asyncHandler(async (request, response) => {
        response.json(
          RenderArtifactCollectionSchema.parse(
            await renders.listArtifacts(
              RenderIdSchema.parse(request.params.renderId),
            ),
          ),
        );
      }),
    );
    router.get(
      "/api/renders/:renderId/audio",
      asyncHandler(async (request, response, next) => {
        const media = await renders.resolveRenderAudio(
          RenderIdSchema.parse(request.params.renderId),
        );
        streamRenderMedia(request, response, next, media);
      }),
    );
    router.get(
      "/api/renders/:renderId/download",
      asyncHandler(async (request, response, next) => {
        const media = await renders.resolveRenderAudio(
          RenderIdSchema.parse(request.params.renderId),
        );
        streamRenderMedia(request, response, next, media, "attachment");
      }),
    );
    router.get(
      "/api/renders/:renderId/details",
      asyncHandler(async (request, response) => {
        const archive = await renders.resolveDetailsArchive!(
          RenderIdSchema.parse(request.params.renderId),
        );
        response.setHeader("cache-control", "private, no-store");
        response.setHeader("content-type", archive.mimeType);
        response.setHeader(
          "content-disposition",
          `attachment; filename="${archive.fileName.replace(/["\\\r\n]/gu, "_")}"`,
        );
        response.setHeader("content-length", String(archive.bytes.byteLength));
        response.send(Buffer.from(archive.bytes));
      }),
    );
    router.get(
      "/api/renders/:renderId/waveform",
      asyncHandler(async (request, response) => {
        response.json(
          RenderWaveformSchema.parse(
            await renders.getWaveform(
              RenderIdSchema.parse(request.params.renderId),
            ),
          ),
        );
      }),
    );
    router.get(
      "/api/renders/:renderId/segments",
      asyncHandler(async (request, response) => {
        response.json(
          RenderHistorySegmentCollectionSchema.parse(
            await renders.listSegments(
              RenderIdSchema.parse(request.params.renderId),
            ),
          ),
        );
      }),
    );
    router.get(
      "/api/renders/:renderId/segments/:ordinal/audio",
      asyncHandler(async (request, response, next) => {
        const input = RenderSegmentInputSchema.parse({
          renderId: request.params.renderId,
          ordinal: Number(request.params.ordinal),
        });
        const media = await renders.resolveSegmentAudio(
          input.renderId,
          input.ordinal,
        );
        streamRenderMedia(request, response, next, media);
      }),
    );
    router.post(
      "/api/renders/:renderId/segments/:ordinal/export",
      asyncHandler(async (request, response, next) => {
        const input = RenderSegmentInputSchema.parse({
          renderId: request.params.renderId,
          ordinal: Number(request.params.ordinal),
        });
        const media = await renders.resolveSegmentAudio(
          input.renderId,
          input.ordinal,
        );
        streamRenderMedia(request, response, next, media, "attachment");
      }),
    );
    router.get(
      "/api/render-artifacts/:artifactId",
      asyncHandler(async (request, response, next) => {
        const { artifact, path } = await renders.resolveArtifact(
          RenderArtifactIdSchema.parse(request.params.artifactId),
        );
        const safeFileName = artifact.fileName.replace(/["\\\r\n]/gu, "_");
        response.setHeader(
          "content-disposition",
          `attachment; filename="${safeFileName}"`,
        );
        response.setHeader(
          "content-type",
          artifact.type === "mp3"
            ? "audio/mpeg"
            : artifact.type === "manifest" ||
                artifact.type === "projectSnapshot"
              ? "application/json"
              : "text/plain; charset=utf-8",
        );
        createReadStream(path).once("error", next).pipe(response);
      }),
    );
  }

  return router;
}
