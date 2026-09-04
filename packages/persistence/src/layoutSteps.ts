import { lstat, readdir, rm, stat, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LayoutStep } from "./dataDirectoryManifest.js";

/**
 * The first real one-time data directory layout steps (task 10.4),
 * registered in order by the server and desktop bootstraps.
 *
 * Both steps are idempotent and tolerate a missing directory: re-running
 * them after completion is a no-op, and a fresh data directory simply has
 * nothing to clean up. Each deletion is logged with `console.warn` until
 * task 18 provides the real logging sink.
 *
 * They never touch `render-plans/.jobs/` (render history snapshots), the
 * `renders/` artifact directory, or anything outside the data directory.
 */

const RENDER_PLANS_DIRECTORY = "render-plans";
const RENDER_JOBS_DIRECTORY = ".jobs";
const RENDERS_DIRECTORY = "renders";
const LEGACY_RENDER_PROVENANCE_FILES = new Set([
  "render-manifest.json",
  "checksums.txt",
]);
const RENDER_DIRECTORY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isContainedPath(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent.length > 0 &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

/** Remove only R02's obsolete provenance files from managed render directories. */
export const removeLegacyRenderProvenance: LayoutStep = {
  id: "remove-legacy-render-provenance",
  targetLayoutVersion: 2,
  async run(dataDirectory: string) {
    const root = resolve(dataDirectory, RENDERS_DIRECTORY);
    const dataRoot = resolve(dataDirectory);
    if (!isContainedPath(dataRoot, root))
      throw new Error("The render provenance cleanup root is invalid.");
    let entries;
    try {
      const rootDetails = await lstat(root);
      if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory())
        throw new Error(
          "The render provenance cleanup root must be a real directory.",
        );
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (!RENDER_DIRECTORY_PATTERN.test(entry.name)) continue;
      const directory = resolve(root, entry.name);
      if (!isContainedPath(root, directory))
        throw new Error("The render provenance cleanup path is invalid.");
      const details = await lstat(directory);
      if (details.isSymbolicLink())
        throw new Error(
          "The render provenance cleanup does not follow symlinks.",
        );
      if (!details.isDirectory()) continue;
      for (const fileName of LEGACY_RENDER_PROVENANCE_FILES) {
        const path = resolve(directory, fileName);
        if (!isContainedPath(directory, path))
          throw new Error("The render provenance cleanup path is invalid.");
        try {
          const file = await lstat(path);
          if (file.isSymbolicLink())
            throw new Error(
              "The render provenance cleanup does not follow symlinks.",
            );
          if (!file.isFile()) continue;
          await unlink(path);
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error;
        }
      }
    }
  },
};

/**
 * Delete legacy standalone render plan directories: everything in
 * `render-plans/` except the `.jobs/` directory (task 8h deferred this
 * cleanup to now that the standalone plan API is gone). Top level
 * directories only — stray files and symlinks are left in place, and
 * `render-plans/.jobs/` is always preserved. Missing `render-plans/` is
 * tolerated.
 */
export const removeStandaloneRenderPlans: LayoutStep = {
  id: "remove-standalone-render-plans",
  async run(dataDirectory: string) {
    const plansRoot = resolve(dataDirectory, RENDER_PLANS_DIRECTORY);
    let rootStat;
    try {
      rootStat = await stat(plansRoot);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return;
      throw error;
    }
    if (!rootStat.isDirectory()) return;
    const entries = await readdir(plansRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === RENDER_JOBS_DIRECTORY) continue;
      if (!entry.isDirectory()) continue;
      const planPath = join(plansRoot, entry.name);
      await rm(planPath, { recursive: true, force: true });
      console.warn(
        `[study-narrator] removed orphaned render plan directory: ${planPath}`,
      );
    }
  },
};

interface SpeechCacheSweepRules {
  /**
   * The speech cache root relative to the data directory (the
   * bootstraps pass `"cache/speech"`, matching
   * `createApplicationSpeechCache`).
   */
  relativeCacheRoot: string;
  /**
   * Decide whether the cache entry whose metadata file lives at
   * `metadataPath` should be deleted. The bootstraps provide the task
   * 10.3 classifier (unreadable metadata, or a schema version this
   * build does not use); the walk itself stays independent of the
   * rendering package.
   */
  shouldDeleteEntry(metadataPath: string): Promise<boolean>;
}

const SHARD_PATTERN = /^[a-f0-9]{2}$/u;
const METADATA_FILE_PATTERN = /^[a-f0-9]{64}\.json$/u;

/**
 * Walk the speech cache layout (`<shard>/<key>.json` metadata files with
 * a paired `<key>.wav`) and delete the entries the caller classifies for
 * removal, along with their audio file. Unrecognized shards, files, or
 * orphan audio are left untouched, and a missing cache root is
 * tolerated.
 */
export function createSpeechCacheSweep(
  rules: SpeechCacheSweepRules,
): LayoutStep {
  return {
    id: "sweep-unreadable-cache-entries",
    async run(dataDirectory: string) {
      const cacheRoot = resolve(dataDirectory, rules.relativeCacheRoot);
      if (!isAbsolute(cacheRoot) || cacheRoot === dataDirectory) {
        throw new Error(
          "The speech cache sweep requires a real subdirectory of the data directory.",
        );
      }
      let shards;
      try {
        shards = await readdir(cacheRoot, { withFileTypes: true });
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return;
        throw error;
      }
      for (const shard of shards) {
        if (!shard.isDirectory() || !SHARD_PATTERN.test(shard.name)) continue;
        const shardDirectory = join(cacheRoot, shard.name);
        let entries;
        try {
          entries = await readdir(shardDirectory, { withFileTypes: true });
        } catch (error) {
          if ((error as { code?: string }).code === "ENOENT") continue;
          throw error;
        }
        for (const entry of entries) {
          if (!entry.isFile() || !METADATA_FILE_PATTERN.test(entry.name)) {
            continue;
          }
          const metadataPath = join(shardDirectory, entry.name);
          if (!(await rules.shouldDeleteEntry(metadataPath))) continue;
          const key = entry.name.slice(0, -".json".length);
          await unlink(metadataPath).catch(() => undefined);
          // The paired audio is removed best-effort: the entry's metadata
          // is already gone, so a missing wav only leaves an orphan that
          // this step (by design) does not chase.
          await unlink(join(shardDirectory, `${key}.wav`)).catch((error) => {
            if ((error as { code?: string }).code !== "ENOENT") {
              throw error;
            }
          });
          console.warn(
            `[study-narrator] removed unreadable speech cache entry: ${metadataPath} and its audio file ${join(shardDirectory, `${key}.wav`)}`,
          );
        }
      }
    },
  };
}
