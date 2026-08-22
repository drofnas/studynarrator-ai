import { lstat, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  RetentionReclaimInputSchema,
  RetentionReclaimPreviewSchema,
  RetentionReclaimResultSchema,
  RetentionUsageSchema,
  type RetentionReclaimPreview,
  type RetentionReclaimResult,
  type RetentionUsage,
  type RenderJob,
} from "@studynarrator/shared-types";
import type { StudyNarratorRepository } from "@studynarrator/persistence";
import type {
  SpeechCache,
  SpeechCacheActivityGate,
  SpeechCacheActivityLease,
} from "@studynarrator/rendering";

const TTL_MILLISECONDS = {
  "8h": 8 * 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
} as const;

type RetentionTtl = "8h" | "24h" | "7d" | "never";
interface SpeechCacheSweeper {
  inventory(): Promise<{ entries: number; bytes: number }>;
  sweep(input: {
    ttl: RetentionTtl;
    sizeCapBytes: number;
    preview?: boolean;
    now?: () => Date;
    pinnedProjectIds?: readonly string[];
    maintenanceLease?: SpeechCacheActivityLease;
  }): Promise<{
    entriesRemoved: number;
    bytesFreed: number;
    skipped: boolean;
  }>;
}

type RetentionRepository = Pick<
  StudyNarratorRepository,
  | "getRetentionSettings"
  | "listPinnedRenderProjectIds"
  | "listRecoverableRenderJobs"
  | "listRetentionRenderJobs"
  | "clearRenderMedia"
>;

interface ManagedDirectory {
  job: RenderJob;
  path: string;
  bytes: number;
}

const EMPTY_USAGE: RetentionUsage = {
  speechCache: { entries: 0, bytes: 0 },
  jobSnapshots: { entries: 0, bytes: 0 },
  renderArtifacts: { entries: 0, bytes: 0 },
};

function emptyUsage(): RetentionUsage {
  return structuredClone(EMPTY_USAGE);
}

function terminal(job: RenderJob): boolean {
  return (
    job.state === "complete" ||
    job.state === "failed" ||
    job.state === "canceled"
  );
}

function expired(job: RenderJob, ttl: RetentionTtl, now: Date): boolean {
  if (ttl === "never" || job.pinned || !terminal(job)) return false;
  const timestamp = job.finishedAt ?? job.createdAt;
  return Date.parse(timestamp) <= now.getTime() - TTL_MILLISECONDS[ttl];
}

async function inspectDirectory(path: string): Promise<number | null> {
  let details;
  try {
    details = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  if (!details.isDirectory() || details.isSymbolicLink()) return null;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) return null;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const childBytes = await inspectDirectory(child);
      if (childBytes === null) return null;
      bytes += childBytes;
      continue;
    }
    if (!entry.isFile()) return null;
    const childDetails = await lstat(child);
    if (!childDetails.isFile() || childDetails.isSymbolicLink()) return null;
    bytes += childDetails.size;
  }
  return bytes;
}

async function managedDirectories(
  rootDirectory: string,
  jobs: readonly RenderJob[],
): Promise<ManagedDirectory[]> {
  const root = resolve(rootDirectory);
  let rootDetails;
  try {
    rootDetails = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) return [];
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const directories: ManagedDirectory[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const job = jobsById.get(entry.name);
    if (!job || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    const bytes = await inspectDirectory(path);
    if (bytes === null) continue;
    directories.push({ job, path, bytes });
  }
  return directories;
}

/**
 * Performs retention maintenance only within the three application-managed
 * roots. A shared cache-maintenance lease keeps a render from starting while
 * its snapshots, artifacts, and cache dependencies are considered together.
 */
export function createRetentionMaintenance(options: {
  repository: RetentionRepository;
  cache: SpeechCache;
  speechCacheSweeper: SpeechCacheSweeper;
  activityGate: SpeechCacheActivityGate;
  dataDirectory: string;
  now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());
  const snapshotsRoot = resolve(options.dataDirectory, "render-plans", ".jobs");
  const artifactsRoot = resolve(options.dataDirectory, "renders");

  const directoryUsage = async () => {
    const jobs = options.repository.listRetentionRenderJobs();
    const [snapshots, artifacts] = await Promise.all([
      managedDirectories(snapshotsRoot, jobs),
      managedDirectories(artifactsRoot, jobs),
    ]);
    return { jobs, snapshots, artifacts };
  };

  const usage = async (): Promise<RetentionUsage> => {
    const [cacheInventory, directories] = await Promise.all([
      options.speechCacheSweeper.inventory(),
      directoryUsage(),
    ]);
    return RetentionUsageSchema.parse({
      speechCache: {
        entries: cacheInventory.entries,
        bytes: cacheInventory.bytes,
      },
      jobSnapshots: {
        entries: directories.snapshots.length,
        bytes: directories.snapshots.reduce(
          (total, item) => total + item.bytes,
          0,
        ),
      },
      renderArtifacts: {
        entries: directories.artifacts.length,
        bytes: directories.artifacts.reduce(
          (total, item) => total + item.bytes,
          0,
        ),
      },
    });
  };

  const reclaim = async (
    preview: boolean,
  ): Promise<RetentionReclaimPreview | RetentionReclaimResult> => {
    const maintenance = options.activityGate.beginMaintenance();
    if (!maintenance)
      return preview
        ? RetentionReclaimPreviewSchema.parse({
            reclaimable: emptyUsage(),
            skipped: true,
          })
        : RetentionReclaimResultSchema.parse({
            reclaimed: emptyUsage(),
            skipped: true,
          });
    try {
      // This is broader than the cache gate alone: no snapshot or output is
      // removed while any render is in a recoverable state.
      if (options.repository.listRecoverableRenderJobs().length > 0)
        return preview
          ? RetentionReclaimPreviewSchema.parse({
              reclaimable: emptyUsage(),
              skipped: true,
            })
          : RetentionReclaimResultSchema.parse({
              reclaimed: emptyUsage(),
              skipped: true,
            });

      const settings = options.repository.getRetentionSettings();
      const cacheResult = await options.speechCacheSweeper.sweep({
        ttl: settings.speechCacheTtl,
        sizeCapBytes: settings.speechCacheSizeCapBytes,
        preview,
        now,
        pinnedProjectIds: options.repository.listPinnedRenderProjectIds(),
        maintenanceLease: maintenance,
      });
      if (cacheResult.skipped)
        return preview
          ? RetentionReclaimPreviewSchema.parse({
              reclaimable: emptyUsage(),
              skipped: true,
            })
          : RetentionReclaimResultSchema.parse({
              reclaimed: emptyUsage(),
              skipped: true,
            });

      const directories = await directoryUsage();
      const at = now();
      const selected = {
        jobSnapshots: directories.snapshots.filter(({ job }) =>
          expired(job, settings.jobSnapshotTtl, at),
        ),
        renderArtifacts: directories.artifacts.filter(({ job }) =>
          expired(job, settings.renderArtifactTtl, at),
        ),
      };
      const reclaimed = RetentionUsageSchema.parse({
        speechCache: {
          entries: cacheResult.entriesRemoved,
          bytes: cacheResult.bytesFreed,
        },
        jobSnapshots: {
          entries: selected.jobSnapshots.length,
          bytes: selected.jobSnapshots.reduce(
            (total, item) => total + item.bytes,
            0,
          ),
        },
        renderArtifacts: {
          entries: selected.renderArtifacts.length,
          bytes: selected.renderArtifacts.reduce(
            (total, item) => total + item.bytes,
            0,
          ),
        },
      });
      if (!preview) {
        for (const item of selected.jobSnapshots)
          await rm(item.path, { recursive: true, force: true });
        for (const item of selected.renderArtifacts) {
          await rm(item.path, { recursive: true, force: true });
          options.repository.clearRenderMedia(item.job.id);
        }
      }
      return preview
        ? RetentionReclaimPreviewSchema.parse({
            reclaimable: reclaimed,
            skipped: false,
          })
        : RetentionReclaimResultSchema.parse({ reclaimed, skipped: false });
    } finally {
      maintenance.release();
    }
  };

  return {
    usage,
    previewReclaim: async () =>
      (await reclaim(true)) as RetentionReclaimPreview,
    reclaim: async (input: unknown) => {
      RetentionReclaimInputSchema.parse(input);
      return (await reclaim(false)) as RetentionReclaimResult;
    },
  };
}
