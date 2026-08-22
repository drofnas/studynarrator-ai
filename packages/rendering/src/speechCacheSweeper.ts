import { lstat, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  readSpeechCacheMetadata,
  type SpeechCache,
  type SpeechCacheMetadataReadResult,
} from "./index.js";

type SpeechCacheTtl = "8h" | "24h" | "7d" | "never";

export interface SpeechCacheActivityGate {
  beginActivity(): Promise<SpeechCacheActivityLease>;
  beginMaintenance(): SpeechCacheActivityLease | null;
}

export interface SpeechCacheActivityLease {
  release(): void;
}

/** Coordinates in-process cache activity with exclusive cache maintenance. */
export function createSpeechCacheActivityGate(): SpeechCacheActivityGate {
  let active = 0;
  let maintaining = false;
  const waiting: Array<() => void> = [];
  const activityLease = (): SpeechCacheActivityLease => {
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        active -= 1;
      },
    };
  };
  return {
    async beginActivity() {
      while (maintaining)
        await new Promise<void>((resolve) => waiting.push(resolve));
      active += 1;
      return activityLease();
    },
    beginMaintenance() {
      if (maintaining || active > 0) return null;
      maintaining = true;
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          maintaining = false;
          for (const resolve of waiting.splice(0)) resolve();
        },
      };
    },
  };
}

interface SpeechCacheSweepResult {
  entriesRemoved: number;
  bytesFreed: number;
  skipped: boolean;
  preview: boolean;
}

interface SpeechCacheEntry {
  key: string;
  metadata: SpeechCacheMetadataReadResult;
  byteLength: number;
}

const SHARD_PATTERN = /^[a-f0-9]{2}$/u;
const METADATA_FILE_PATTERN = /^([a-f0-9]{64})\.json$/u;
const TTL_MILLISECONDS: Readonly<
  Record<Exclude<SpeechCacheTtl, "never">, number>
> = {
  "8h": 8 * 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
};

async function regularFileBytes(path: string): Promise<number> {
  try {
    const details = await lstat(path);
    return details.isFile() && !details.isSymbolicLink() ? details.size : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function removeEntry(rootDirectory: string, key: string): Promise<void> {
  const directory = join(rootDirectory, key.slice(0, 2));
  for (const path of [
    join(directory, `${key}.json`),
    join(directory, `${key}.wav`),
  ]) {
    try {
      const details = await lstat(path);
      if (!details.isFile() || details.isSymbolicLink()) return;
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function listEntries(rootDirectory: string): Promise<SpeechCacheEntry[]> {
  let shards;
  try {
    shards = await readdir(rootDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries: SpeechCacheEntry[] = [];
  for (const shard of shards) {
    if (
      !shard.isDirectory() ||
      shard.isSymbolicLink() ||
      !SHARD_PATTERN.test(shard.name)
    )
      continue;
    const directory = join(rootDirectory, shard.name);
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const match = METADATA_FILE_PATTERN.exec(file.name);
      const key = match?.[1];
      if (
        !file.isFile() ||
        file.isSymbolicLink() ||
        !key ||
        !key.startsWith(shard.name)
      )
        continue;
      const metadataPath = join(directory, file.name);
      entries.push({
        key,
        metadata: await readSpeechCacheMetadata(metadataPath),
        byteLength: await regularFileBytes(join(directory, `${key}.wav`)),
      });
    }
  }
  return entries;
}

function isExpired(
  entry: SpeechCacheEntry,
  ttl: SpeechCacheTtl,
  now: Date,
): boolean {
  return (
    ttl !== "never" &&
    entry.metadata.status === "ok" &&
    Date.parse(entry.metadata.metadata.lastUsedAt) <=
      now.getTime() - TTL_MILLISECONDS[ttl]
  );
}

/** Reclaims only validated key-pairs below the speech cache's managed root. */
export function createSpeechCacheSweeper(options: {
  cache: SpeechCache;
  rootDirectory: string;
  activityGate?: SpeechCacheActivityGate;
}) {
  const rootDirectory = resolve(options.rootDirectory);
  return {
    async sweep(optionsInput: {
      ttl: SpeechCacheTtl;
      sizeCapBytes: number;
      preview?: boolean;
      now?: () => Date;
    }): Promise<SpeechCacheSweepResult> {
      if (
        !Number.isSafeInteger(optionsInput.sizeCapBytes) ||
        optionsInput.sizeCapBytes < 1
      )
        throw new Error("Speech cache size cap is invalid.");
      const preview = optionsInput.preview === true;
      const maintenance = options.activityGate?.beginMaintenance();
      if (options.activityGate && !maintenance)
        return { entriesRemoved: 0, bytesFreed: 0, skipped: true, preview };
      if (!options.activityGate && (await options.cache.status()).inFlight > 0)
        return { entriesRemoved: 0, bytesFreed: 0, skipped: true, preview };
      try {
        try {
          const root = await lstat(rootDirectory);
          if (!root.isDirectory() || root.isSymbolicLink())
            return { entriesRemoved: 0, bytesFreed: 0, skipped: true, preview };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return {
              entriesRemoved: 0,
              bytesFreed: 0,
              skipped: false,
              preview,
            };
          throw error;
        }
        const selected = new Map<string, SpeechCacheEntry>();
        const now = (optionsInput.now ?? (() => new Date()))();
        const entries = await listEntries(rootDirectory);
        for (const entry of entries) {
          if (
            entry.metadata.status === "unreadable" ||
            (entry.metadata.status === "ok" &&
              entry.metadata.metadata.key !== entry.key) ||
            isExpired(entry, optionsInput.ttl, now)
          )
            selected.set(entry.key, entry);
        }
        const retained = entries.filter(
          (entry) => entry.metadata.status === "ok" && !selected.has(entry.key),
        );
        let totalBytes = retained.reduce(
          (total, entry) => total + entry.byteLength,
          0,
        );
        for (const entry of retained.sort((left, right) => {
          if (left.metadata.status !== "ok" || right.metadata.status !== "ok")
            return 0;
          return (
            Date.parse(left.metadata.metadata.lastUsedAt) -
              Date.parse(right.metadata.metadata.lastUsedAt) ||
            left.key.localeCompare(right.key)
          );
        })) {
          if (totalBytes <= optionsInput.sizeCapBytes) break;
          selected.set(entry.key, entry);
          totalBytes -= entry.byteLength;
        }
        const reclaimable = [...selected.values()];
        if (!preview)
          for (const entry of reclaimable)
            await removeEntry(rootDirectory, entry.key);
        return {
          entriesRemoved: reclaimable.length,
          bytesFreed: reclaimable.reduce(
            (total, entry) => total + entry.byteLength,
            0,
          ),
          skipped: false,
          preview,
        };
      } finally {
        maintenance?.release();
      }
    },
  };
}
