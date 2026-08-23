import { randomUUID } from "node:crypto";
import { statfs } from "node:fs/promises";
import {
  RenderArtifactIdSchema,
  RenderIdSchema,
  RenderJobSchema,
  RenderStartOptionsSchema,
  renderDiskSpaceBlockMessage,
  type RenderArtifact,
  type RenderClient,
  type RenderJob,
} from "@studynarrator/shared-types";
import { ProjectIdSchema } from "@studynarrator/shared-types";
import type {
  RenderPlanStore,
  SpeechCacheActivityGate,
} from "@studynarrator/rendering";
import type { StudyNarratorRepository } from "@studynarrator/persistence";
import { createRenderArtifacts } from "./artifacts.js";
import type { CachedSpeechSynthesis } from "./cachedSpeech.js";
import { createRenderOrchestration } from "./orchestration.js";
import { createRenderQueue, type RenderLifecycleLogger } from "./queue.js";
import type { ResolvedRenderMedia } from "./renderMedia.js";
import type { RenderPlanComputer } from "./renderPlan.js";

export class RenderDiskSpaceError extends Error {
  readonly code = "RENDER_DISK_SPACE_INSUFFICIENT";
  readonly estimatedPeakBytes: number;
  readonly freeSpaceBytes: bigint;
  readonly usableBytes: bigint;

  constructor(
    estimatedPeakBytes: number,
    freeSpaceBytes: bigint,
    usableBytes: bigint,
  ) {
    super(
      renderDiskSpaceBlockMessage(
        estimatedPeakBytes,
        freeSpaceBytes,
        usableBytes,
      ),
    );
    this.name = "RenderDiskSpaceError";
    this.estimatedPeakBytes = estimatedPeakBytes;
    this.freeSpaceBytes = freeSpaceBytes;
    this.usableBytes = usableBytes;
  }
}

interface RenderFileSystemStats {
  bavail: bigint;
  bsize: bigint;
}

type RenderStatfs = (path: string) => Promise<RenderFileSystemStats>;

export type RenderRepository = Pick<
  StudyNarratorRepository,
  | "getSpeechBackendConnection"
  | "createRenderJob"
  | "getRenderJob"
  | "listRenderJobs"
  | "listRecoverableRenderJobs"
  | "updateRenderJob"
  | "updateRenderSegment"
  | "replaceRenderArtifacts"
  | "listRenderArtifacts"
  | "getRenderArtifactPath"
  | "listRenderSegments"
  | "getRenderSegmentPath"
  | "getVoiceTimingCalibration"
  | "upsertVoiceTimingCalibration"
> &
  Partial<Pick<StudyNarratorRepository, "getProject">>;

export interface RenderService extends Omit<
  RenderClient,
  "renderAudioSource" | "segmentAudioSource" | "exportAudio" | "exportDetails"
> {
  exportAudio?(renderId: string): Promise<{
    disposition: "download" | "saved" | "canceled";
    fileName: string;
  }>;
  exportDetails?(renderId: string): Promise<{
    disposition: "download" | "saved" | "canceled";
    fileName: string;
  }>;
  resolveArtifact(
    artifactId: string,
  ): Promise<{ artifact: RenderArtifact; path: string }>;
  resolveRenderAudio(renderId: string): Promise<ResolvedRenderMedia>;
  resolveSegmentAudio(
    renderId: string,
    ordinal: number,
  ): Promise<ResolvedRenderMedia>;
  subscribe(renderId: string, callback: (job: RenderJob) => void): () => void;
  resolveDetailsArchive?(renderId: string): Promise<{
    bytes: Uint8Array;
    fileName: string;
    mimeType: "application/zip";
  }>;
  close(): Promise<void>;
}

export async function createRenderService(options: {
  repository: RenderRepository;
  plans: RenderPlanStore;
  speech: CachedSpeechSynthesis;
  dataDirectory: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  now?: () => Date;
  createId?: () => string;
  planComputer: RenderPlanComputer;
  logger: RenderLifecycleLogger;
  statfs?: RenderStatfs;
  activityGate?: SpeechCacheActivityGate;
}): Promise<RenderService> {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const readFileSystemStats: RenderStatfs =
    options.statfs ??
    (async (path) => {
      return await statfs(path, { bigint: true });
    });
  const artifacts = await createRenderArtifacts({
    repository: options.repository,
    plans: options.plans,
    dataDirectory: options.dataDirectory,
    ffmpegPath: options.ffmpegPath,
    ffprobePath: options.ffprobePath,
    now,
    createId,
  });
  const queue = createRenderQueue({
    repository: options.repository,
    now,
    logger: options.logger,
    activityGate: options.activityGate,
    async execute(renderId, signal) {
      await orchestration.execute(renderId, signal);
    },
  });
  const orchestration = createRenderOrchestration({
    repository: options.repository,
    plans: options.plans,
    speech: options.speech,
    dataDirectory: options.dataDirectory,
    now,
    createId,
    planComputer: options.planComputer,
    logger: options.logger,
    readFileSystemStats,
    createDiskSpaceError: (estimatedPeakBytes, freeSpaceBytes, usableBytes) =>
      new RenderDiskSpaceError(estimatedPeakBytes, freeSpaceBytes, usableBytes),
    queue,
    artifacts,
  });
  await queue.recover();

  return {
    startProject: (projectId, startOptions) =>
      orchestration.startProject(
        ProjectIdSchema.parse(projectId),
        RenderStartOptionsSchema.parse(startOptions),
      ),
    async getEstimateContext(input) {
      return await orchestration.getEstimateContext(input);
    },
    async list(projectId) {
      return await Promise.resolve(
        options.repository.listRenderJobs(projectId),
      );
    },
    async get(renderId) {
      return await Promise.resolve(
        options.repository.getRenderJob(RenderIdSchema.parse(renderId)),
      );
    },
    subscribe(renderIdInput, callback) {
      return queue.subscribe(RenderIdSchema.parse(renderIdInput), callback);
    },
    async cancel(renderIdInput) {
      return await queue.cancel(RenderIdSchema.parse(renderIdInput));
    },
    async retry(renderIdInput) {
      return await orchestration.retry(RenderIdSchema.parse(renderIdInput));
    },
    async setPinned(renderIdInput, pinned) {
      const job = options.repository.getRenderJob(
        RenderIdSchema.parse(renderIdInput),
      );
      return await Promise.resolve(
        options.repository.updateRenderJob(
          RenderJobSchema.parse({ ...job, pinned: Boolean(pinned) }),
        ),
      );
    },
    async listArtifacts(renderId) {
      return await Promise.resolve(
        options.repository.listRenderArtifacts(RenderIdSchema.parse(renderId)),
      );
    },
    async exportArtifact(artifactId) {
      const { artifact } = options.repository.getRenderArtifactPath(
        RenderArtifactIdSchema.parse(artifactId),
      );
      return await Promise.resolve({
        disposition: "download" as const,
        fileName: artifact.fileName,
      });
    },
    async exportAudio(renderId) {
      const media = await artifacts.resolveRenderAudio(renderId);
      return { disposition: "download" as const, fileName: media.fileName };
    },
    async exportDetails(renderId) {
      const archive = await artifacts.resolveDetailsArchive(renderId);
      return { disposition: "download" as const, fileName: archive.fileName };
    },
    async resolveArtifact(artifactId) {
      return await artifacts.resolveArtifactFile(artifactId);
    },
    async listSegments(renderId) {
      return await artifacts.buildHistorySegments(renderId);
    },
    async getWaveform(renderId) {
      return await artifacts.waveformFor(renderId);
    },
    async exportSegment(renderId, ordinal) {
      const media = await artifacts.resolveSegmentAudio(renderId, ordinal);
      return { disposition: "download" as const, fileName: media.fileName };
    },
    resolveRenderAudio: (renderId) => artifacts.resolveRenderAudio(renderId),
    resolveSegmentAudio: (renderId, ordinal) =>
      artifacts.resolveSegmentAudio(renderId, ordinal),
    resolveDetailsArchive: (renderId) =>
      artifacts.resolveDetailsArchive(renderId),
    async close() {
      await queue.close();
    },
  };
}
