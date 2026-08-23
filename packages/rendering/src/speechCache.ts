import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { missing, sha256 } from "./renderPlanStore.js";
import type { SpeechCacheActivityGate } from "./speechCacheSweeper.js";

export {
  createSpeechCacheActivityGate,
  createSpeechCacheSweeper,
  type SpeechCacheActivityGate,
  type SpeechCacheActivityLease,
} from "./speechCacheSweeper.js";

export const SPEECH_CACHE_SCHEMA_VERSION = 1;
export const SPEECH_NORMALIZATION_VERSION = 1;
export const SPEECH_CHUNKING_VERSION = 1;
const MAX_CACHED_SPEECH_BYTES = 5 * 1024 * 1024;
const CACHE_KEY_PATTERN = /^[a-f0-9]{64}$/u;
const SHARD_PATTERN = /^[a-f0-9]{2}$/u;
const MAX_CACHE_METADATA_BYTES = 64 * 1024;

export interface SpeechCacheKeyInput {
  adapterId: string;
  adapterVersion: number;
  serverIdentity: string;
  modelId: string;
  voiceId: string;
  speed: number;
  text: string;
  responseFormat: "wav";
}

interface NormalizedSpeechCacheInput extends Omit<
  SpeechCacheKeyInput,
  "serverIdentity" | "text"
> {
  serverIdentityHash: string;
  normalizedText: string;
  textHash: string;
}

export interface SpeechCacheUsage {
  projectId?: string;
  scratchpad?: boolean;
}

const SpeechCacheEntryMetadataSchema = z.object({
  schemaVersion: z.literal(SPEECH_CACHE_SCHEMA_VERSION),
  normalizationVersion: z.literal(SPEECH_NORMALIZATION_VERSION),
  chunkingVersion: z.literal(SPEECH_CHUNKING_VERSION),
  adapterId: z.string().min(1),
  adapterVersion: z.number().int(),
  serverIdentityHash: z.string().regex(CACHE_KEY_PATTERN),
  modelId: z.string().min(1),
  voiceId: z.string().min(1),
  speed: z.number().finite(),
  textHash: z.string().regex(CACHE_KEY_PATTERN),
  responseFormat: z.literal("wav"),
  key: z.string().regex(CACHE_KEY_PATTERN),
  audioChecksum: z.string().regex(CACHE_KEY_PATTERN),
  byteLength: z.number().int().min(1).max(MAX_CACHED_SPEECH_BYTES),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  lastUsedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  projectIds: z.array(z.string().min(1)),
  scratchpadUsed: z.boolean(),
});

export type SpeechCacheEntryMetadata = z.infer<
  typeof SpeechCacheEntryMetadataSchema
>;

export type SpeechCacheMetadataReadResult =
  | { status: "ok"; metadata: SpeechCacheEntryMetadata }
  | { status: "missing" }
  | { status: "unreadable"; path: string };

/**
 * Read one speech cache entry's metadata file. The result distinguishes
 * "not present" from "present but unreadable" (invalid JSON or a shape
 * this build does not understand). Unknown extra fields never invalidate
 * an entry: they are stripped, so future optional fields keep old entries
 * usable. Reporting only — this never deletes or rewrites anything.
 */
export async function readSpeechCacheMetadata(
  metadataPath: string,
): Promise<SpeechCacheMetadataReadResult> {
  let raw: string;
  try {
    raw = (
      await readBoundedFile(metadataPath, MAX_CACHE_METADATA_BYTES)
    ).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { status: "missing" };
    return { status: "unreadable", path: metadataPath };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { status: "unreadable", path: metadataPath };
  }
  const metadata = SpeechCacheEntryMetadataSchema.safeParse(decoded);
  if (!metadata.success) return { status: "unreadable", path: metadataPath };
  return { status: "ok", metadata: metadata.data };
}

export interface CachedSpeechResult {
  key: string;
  status: "hit" | "miss";
  bytes: Uint8Array;
  metadata: SpeechCacheEntryMetadata;
}

interface SpeechCacheStatus {
  entryCount: number;
  totalBytes: number;
  lastUsedAt: string | null;
  sessionHits: number;
  sessionMisses: number;
  sessionWrites: number;
  sessionCorruptMisses: number;
  inFlight: number;
}

interface SpeechCacheCleanupResult {
  entriesRemoved: number;
  bytesFreed: number;
}

export interface SpeechCache {
  getOrCreate(
    input: SpeechCacheKeyInput,
    usage: SpeechCacheUsage,
    synthesize: (
      normalizedText: string,
      signal: AbortSignal,
    ) => Promise<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<CachedSpeechResult>;
  inspect(
    input: SpeechCacheKeyInput,
    signal?: AbortSignal,
  ): Promise<{ key: string; status: "hit" | "miss" }>;
  status(): Promise<SpeechCacheStatus>;
  clearAll(): Promise<SpeechCacheCleanupResult>;
  clearProject(projectId: string): Promise<SpeechCacheCleanupResult>;
  clearEntry(key: string): Promise<SpeechCacheCleanupResult>;
  releaseProjectEntry?(
    projectId: string,
    key: string,
  ): Promise<SpeechCacheCleanupResult & { deferred: boolean }>;
  retainScratchpad(key: string): Promise<SpeechCacheCleanupResult>;
}

type CachedAudioValidator = (
  bytes: Uint8Array,
  signal?: AbortSignal,
) => Promise<boolean>;

interface SessionCounters {
  hits: number;
  misses: number;
  writes: number;
  corruptMisses: number;
}

interface Flight {
  controller: AbortController;
  promise: Promise<CachedSpeechResult>;
  usages: SpeechCacheUsage[];
  waiters: number;
  settled: boolean;
}

export function normalizeSpeechText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
}

function normalizeSpeechCacheInput(
  input: SpeechCacheKeyInput,
): NormalizedSpeechCacheInput {
  const normalizedText = normalizeSpeechText(input.text);
  if (
    !input.adapterId.trim() ||
    !Number.isInteger(input.adapterVersion) ||
    input.adapterVersion < 1
  ) {
    throw new Error("Speech cache adapter identity is invalid.");
  }
  if (
    !input.serverIdentity.trim() ||
    !input.modelId.trim() ||
    !input.voiceId.trim()
  ) {
    throw new Error("Speech cache synthesis identity is incomplete.");
  }
  if (
    !Number.isFinite(input.speed) ||
    input.speed <= 0 ||
    input.speed > 4 ||
    !normalizedText
  ) {
    throw new Error("Speech cache synthesis input is invalid.");
  }
  return {
    adapterId: input.adapterId.trim(),
    adapterVersion: input.adapterVersion,
    serverIdentityHash: sha256(input.serverIdentity.trim()),
    modelId: input.modelId.trim(),
    voiceId: input.voiceId.trim(),
    speed: input.speed,
    normalizedText,
    textHash: sha256(normalizedText),
    responseFormat: input.responseFormat,
  };
}

export function createSpeechCacheKey(input: SpeechCacheKeyInput): string {
  const normalized = normalizeSpeechCacheInput(input);
  return sha256(
    JSON.stringify({
      schemaVersion: SPEECH_CACHE_SCHEMA_VERSION,
      normalizationVersion: SPEECH_NORMALIZATION_VERSION,
      chunkingVersion: SPEECH_CHUNKING_VERSION,
      adapterId: normalized.adapterId,
      adapterVersion: normalized.adapterVersion,
      serverIdentityHash: normalized.serverIdentityHash,
      modelId: normalized.modelId,
      voiceId: normalized.voiceId,
      speed: normalized.speed,
      textHash: normalized.textHash,
      responseFormat: normalized.responseFormat,
    }),
  );
}

function assertCacheKey(value: string): string {
  if (!CACHE_KEY_PATTERN.test(value))
    throw new Error("Speech cache key is invalid.");
  return value;
}

function metadataMatchesInput(
  metadata: SpeechCacheEntryMetadata,
  input: NormalizedSpeechCacheInput,
): boolean {
  return (
    metadata.adapterId === input.adapterId &&
    metadata.adapterVersion === input.adapterVersion &&
    metadata.serverIdentityHash === input.serverIdentityHash &&
    metadata.modelId === input.modelId &&
    metadata.voiceId === input.voiceId &&
    metadata.speed === input.speed &&
    metadata.textHash === input.textHash &&
    metadata.responseFormat === input.responseFormat
  );
}

function mergedUsage(
  metadata: SpeechCacheEntryMetadata,
  usage: SpeechCacheUsage,
  lastUsedAt: string,
): SpeechCacheEntryMetadata {
  const projectIds = new Set(metadata.projectIds);
  if (usage.projectId) projectIds.add(usage.projectId);
  return {
    ...metadata,
    lastUsedAt,
    projectIds: [...projectIds].sort((left, right) =>
      left.localeCompare(right, "en-US"),
    ),
    scratchpadUsed: metadata.scratchpadUsed || usage.scratchpad === true,
  };
}

function mergedUsages(
  metadata: SpeechCacheEntryMetadata,
  usages: readonly SpeechCacheUsage[],
  lastUsedAt: string,
): SpeechCacheEntryMetadata {
  return usages.reduce(
    (current, usage) => mergedUsage(current, usage, lastUsedAt),
    metadata,
  );
}

function aborted(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

async function regularFile(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path);
    return entry.isFile() && !entry.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readBoundedFile(
  path: string,
  maximumBytes: number,
): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size < 1 || details.size > maximumBytes)
      throw new Error("Speech cache file size is invalid.");
    const bytes = Buffer.allocUnsafe(details.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (bytesRead === 0)
        throw new Error(
          "Speech cache file was truncated during its bounded read.",
        );
      offset += bytesRead;
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (!entry.isFile() && !entry.isSymbolicLink())
      throw new Error("Refusing to remove an unsafe speech cache path.");
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function createSpeechCache(options: {
  rootDirectory: string;
  validateAudio: CachedAudioValidator;
  now?: () => Date;
  createId?: () => string;
  activityGate?: SpeechCacheActivityGate;
}): SpeechCache {
  if (!options.rootDirectory.trim())
    throw new Error("Speech cache root is required.");
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const flights = new Map<string, Flight>();
  const cleanups = new Map<string, Promise<void>>();
  const counters: SessionCounters = {
    hits: 0,
    misses: 0,
    writes: 0,
    corruptMisses: 0,
  };

  const paths = (keyValue: string) => {
    const key = assertCacheKey(keyValue);
    const directory = join(options.rootDirectory, key.slice(0, 2));
    return {
      key,
      directory,
      audio: join(directory, `${key}.wav`),
      metadata: join(directory, `${key}.json`),
    };
  };

  const ensureDirectory = async (directory: string) => {
    await mkdir(options.rootDirectory, { recursive: true, mode: 0o700 });
    const root = await lstat(options.rootDirectory);
    if (!root.isDirectory() || root.isSymbolicLink())
      throw new Error("Speech cache root must be a real directory.");
    await chmod(options.rootDirectory, 0o700);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const shard = await lstat(directory);
    if (!shard.isDirectory() || shard.isSymbolicLink())
      throw new Error("Speech cache shard must be a real directory.");
    await chmod(directory, 0o700);
  };

  const writeMetadata = async (metadata: SpeechCacheEntryMetadata) => {
    const entryPaths = paths(metadata.key);
    await ensureDirectory(entryPaths.directory);
    const temporary = join(
      entryPaths.directory,
      `${metadata.key}.${createId()}.tmp.json`,
    );
    try {
      await writeFile(temporary, `${JSON.stringify(metadata)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await chmod(temporary, 0o600);
      await rename(temporary, entryPaths.metadata);
    } catch (error) {
      await safeUnlink(temporary).catch(() => undefined);
      throw error;
    }
  };

  const removeEntry = async (
    keyValue: string,
  ): Promise<SpeechCacheCleanupResult> => {
    const entryPaths = paths(keyValue);
    let bytesFreed = 0;
    let found = false;
    try {
      const audio = await lstat(entryPaths.audio);
      if (!audio.isFile() && !audio.isSymbolicLink())
        throw new Error(
          "Refusing to remove an unsafe speech cache audio path.",
        );
      bytesFreed = audio.isSymbolicLink() ? 0 : audio.size;
      found = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!(await missing(entryPaths.metadata))) found = true;
    await safeUnlink(entryPaths.audio);
    await safeUnlink(entryPaths.metadata);
    return { entriesRemoved: found ? 1 : 0, bytesFreed };
  };

  const loadEntry = async (
    key: string,
    normalized: NormalizedSpeechCacheInput,
    usages: readonly SpeechCacheUsage[],
    signal?: AbortSignal,
    touch = true,
  ): Promise<CachedSpeechResult | null> => {
    const entryPaths = paths(key);
    const audioExists = await regularFile(entryPaths.audio);
    const metadataExists = await regularFile(entryPaths.metadata);
    if (!audioExists && !metadataExists) return null;
    if (!audioExists || !metadataExists) {
      if (touch) counters.corruptMisses += 1;
      await removeEntry(key);
      return null;
    }
    try {
      if (signal?.aborted) throw aborted(signal);
      const [metadataRead, audioBuffer] = await Promise.all([
        readSpeechCacheMetadata(entryPaths.metadata),
        readBoundedFile(entryPaths.audio, MAX_CACHED_SPEECH_BYTES),
      ]);
      const metadata =
        metadataRead.status === "ok" ? metadataRead.metadata : null;
      if (
        metadata === null ||
        metadata.key !== key ||
        !metadataMatchesInput(metadata, normalized) ||
        metadata.byteLength !== audioBuffer.byteLength ||
        metadata.audioChecksum !== sha256(audioBuffer)
      ) {
        throw new Error("Cached speech metadata failed integrity validation.");
      }
      if (!(await options.validateAudio(audioBuffer, signal)))
        throw new Error("Cached speech audio failed decoding validation.");
      const updated = touch
        ? mergedUsages(metadata, usages, now().toISOString())
        : metadata;
      if (touch) {
        await writeMetadata(updated);
        counters.hits += 1;
      }
      return {
        key,
        status: "hit",
        bytes: new Uint8Array(audioBuffer),
        metadata: updated,
      };
    } catch {
      if (signal?.aborted) throw aborted(signal);
      if (touch) counters.corruptMisses += 1;
      await removeEntry(key);
      return null;
    }
  };

  const writeEntry = async (
    key: string,
    normalized: NormalizedSpeechCacheInput,
    bytes: Uint8Array,
    usages: readonly SpeechCacheUsage[],
    signal?: AbortSignal,
  ): Promise<SpeechCacheEntryMetadata> => {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_CACHED_SPEECH_BYTES)
      throw new Error("Synthesized speech exceeds the cache size limit.");
    if (!(await options.validateAudio(bytes, signal)))
      throw new Error("Synthesized speech failed cache validation.");
    if (signal?.aborted) throw aborted(signal);
    const entryPaths = paths(key);
    await ensureDirectory(entryPaths.directory);
    const createdAt = now().toISOString();
    const cacheIdentity: Omit<NormalizedSpeechCacheInput, "normalizedText"> = {
      adapterId: normalized.adapterId,
      adapterVersion: normalized.adapterVersion,
      serverIdentityHash: normalized.serverIdentityHash,
      modelId: normalized.modelId,
      voiceId: normalized.voiceId,
      speed: normalized.speed,
      textHash: normalized.textHash,
      responseFormat: normalized.responseFormat,
    };
    const metadata: SpeechCacheEntryMetadata = {
      schemaVersion: SPEECH_CACHE_SCHEMA_VERSION,
      normalizationVersion: SPEECH_NORMALIZATION_VERSION,
      chunkingVersion: SPEECH_CHUNKING_VERSION,
      ...cacheIdentity,
      key,
      audioChecksum: sha256(bytes),
      byteLength: bytes.byteLength,
      createdAt,
      lastUsedAt: createdAt,
      projectIds: [
        ...new Set(
          usages.flatMap((usage) => (usage.projectId ? [usage.projectId] : [])),
        ),
      ].sort((left, right) => left.localeCompare(right, "en-US")),
      scratchpadUsed: usages.some((usage) => usage.scratchpad === true),
    };
    const suffix = createId();
    const temporaryAudio = join(
      entryPaths.directory,
      `${key}.${suffix}.tmp.wav`,
    );
    const temporaryMetadata = join(
      entryPaths.directory,
      `${key}.${suffix}.tmp.json`,
    );
    try {
      await writeFile(temporaryAudio, bytes, { mode: 0o600, flag: "wx" });
      await writeFile(temporaryMetadata, `${JSON.stringify(metadata)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await chmod(temporaryAudio, 0o600);
      await chmod(temporaryMetadata, 0o600);
      await rename(temporaryAudio, entryPaths.audio);
      await rename(temporaryMetadata, entryPaths.metadata);
      counters.writes += 1;
      return metadata;
    } catch (error) {
      await Promise.all([
        safeUnlink(temporaryAudio).catch(() => undefined),
        safeUnlink(temporaryMetadata).catch(() => undefined),
      ]);
      throw error;
    }
  };

  const produce = async (
    key: string,
    normalized: NormalizedSpeechCacheInput,
    usages: readonly SpeechCacheUsage[],
    synthesize: (
      normalizedText: string,
      signal: AbortSignal,
    ) => Promise<Uint8Array>,
    signal: AbortSignal,
  ): Promise<CachedSpeechResult> => {
    const cached = await loadEntry(key, normalized, usages, signal);
    if (cached) return cached;
    counters.misses += 1;
    const bytes = await synthesize(normalized.normalizedText, signal);
    const metadata = await writeEntry(key, normalized, bytes, usages, signal);
    return { key, status: "miss", bytes, metadata };
  };

  const waitForFlight = async (
    flight: Flight,
    signal?: AbortSignal,
  ): Promise<CachedSpeechResult> => {
    if (signal?.aborted) throw aborted(signal);
    flight.waiters += 1;
    try {
      if (!signal) return await flight.promise;
      return await Promise.race([
        flight.promise,
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(aborted(signal)), {
            once: true,
          }),
        ),
      ]);
    } finally {
      flight.waiters -= 1;
      if (flight.waiters === 0 && !flight.settled) flight.controller.abort();
    }
  };

  const cache: SpeechCache = {
    async getOrCreate(input, usage, synthesize, signal) {
      const activity = await options.activityGate?.beginActivity();
      try {
        const normalized = normalizeSpeechCacheInput(input);
        const key = createSpeechCacheKey(input);
        const cleanup = cleanups.get(key);
        if (cleanup) await cleanup;
        const existing = flights.get(key);
        if (existing) {
          existing.usages.push(usage);
          return await waitForFlight(existing, signal);
        }
        const controller = new AbortController();
        const flight: Flight = {
          controller,
          waiters: 0,
          usages: [usage],
          settled: false,
          promise: Promise.resolve(undefined as never),
        };
        flight.promise = produce(
          key,
          normalized,
          flight.usages,
          synthesize,
          controller.signal,
        ).finally(() => {
          flight.settled = true;
          flights.delete(key);
        });
        flights.set(key, flight);
        return await waitForFlight(flight, signal);
      } finally {
        activity?.release();
      }
    },
    async inspect(input, signal) {
      const normalized = normalizeSpeechCacheInput(input);
      const key = createSpeechCacheKey(input);
      const cleanup = cleanups.get(key);
      if (cleanup) await cleanup;
      const cached = await loadEntry(key, normalized, [], signal, false);
      return { key, status: cached ? "hit" : "miss" };
    },
    async status() {
      const keys = await listKeys();
      let totalBytes = 0;
      let lastUsedAt: string | null = null;
      let entryCount = 0;
      for (const key of keys) {
        const entryPaths = paths(key);
        if (
          !(await regularFile(entryPaths.audio)) ||
          !(await regularFile(entryPaths.metadata))
        )
          continue;
        try {
          const metadataRead = await readSpeechCacheMetadata(
            entryPaths.metadata,
          );
          if (metadataRead.status !== "ok") continue;
          const metadata = metadataRead.metadata;
          if (metadata.key !== key) continue;
          totalBytes += metadata.byteLength;
          entryCount += 1;
          if (lastUsedAt === null || metadata.lastUsedAt > lastUsedAt)
            lastUsedAt = metadata.lastUsedAt;
        } catch {
          /* invalid entries are reported as misses when accessed */
        }
      }
      return {
        entryCount,
        totalBytes,
        lastUsedAt,
        sessionHits: counters.hits,
        sessionMisses: counters.misses,
        sessionWrites: counters.writes,
        sessionCorruptMisses: counters.corruptMisses,
        inFlight: flights.size,
      };
    },
    async clearAll() {
      let entriesRemoved = 0;
      let bytesFreed = 0;
      for (const key of await listKeys()) {
        const removed = await removeEntry(key);
        entriesRemoved += removed.entriesRemoved;
        bytesFreed += removed.bytesFreed;
      }
      return { entriesRemoved, bytesFreed };
    },
    async clearProject(projectId) {
      if (!projectId.trim())
        throw new Error("Project ID is required for cache cleanup.");
      let entriesRemoved = 0;
      let bytesFreed = 0;
      for (const key of await listKeys()) {
        const entryPaths = paths(key);
        if (!(await regularFile(entryPaths.metadata))) continue;
        try {
          const metadataRead = await readSpeechCacheMetadata(
            entryPaths.metadata,
          );
          if (metadataRead.status !== "ok") continue;
          if (!metadataRead.metadata.projectIds.includes(projectId)) continue;
          const removed = await removeEntry(key);
          entriesRemoved += removed.entriesRemoved;
          bytesFreed += removed.bytesFreed;
        } catch {
          /* malformed metadata has no trusted project association */
        }
      }
      return { entriesRemoved, bytesFreed };
    },
    async clearEntry(key) {
      return await removeEntry(assertCacheKey(key));
    },
    async releaseProjectEntry(projectId, keyValue) {
      if (!projectId.trim())
        throw new Error("Project ID is required for cache cleanup.");
      const key = assertCacheKey(keyValue);
      if (flights.has(key) || cleanups.has(key))
        return { entriesRemoved: 0, bytesFreed: 0, deferred: true };
      let finishCleanup: () => void = () => undefined;
      const cleanup = new Promise<void>((resolveCleanup) => {
        finishCleanup = resolveCleanup;
      });
      cleanups.set(key, cleanup);
      try {
        const entryPaths = paths(key);
        if (!(await regularFile(entryPaths.metadata)))
          return { entriesRemoved: 0, bytesFreed: 0, deferred: false };
        const metadataRead = await readSpeechCacheMetadata(entryPaths.metadata);
        if (
          metadataRead.status !== "ok" ||
          !metadataRead.metadata.projectIds.includes(projectId)
        )
          return { entriesRemoved: 0, bytesFreed: 0, deferred: false };
        const metadata = metadataRead.metadata;
        const projectIds = metadata.projectIds.filter(
          (candidate) => candidate !== projectId,
        );
        if (projectIds.length > 0 || metadata.scratchpadUsed) {
          await writeMetadata({ ...metadata, projectIds });
          return { entriesRemoved: 0, bytesFreed: 0, deferred: false };
        }
        return { ...(await removeEntry(key)), deferred: false };
      } catch {
        return { entriesRemoved: 0, bytesFreed: 0, deferred: false };
      } finally {
        cleanups.delete(key);
        finishCleanup();
      }
    },
    async retainScratchpad(keyValue) {
      const retainedKey = assertCacheKey(keyValue);
      let entriesRemoved = 0;
      let bytesFreed = 0;
      for (const key of await listKeys()) {
        if (key === retainedKey) continue;
        const entryPaths = paths(key);
        if (!(await regularFile(entryPaths.metadata))) continue;
        try {
          const metadataRead = await readSpeechCacheMetadata(
            entryPaths.metadata,
          );
          if (
            metadataRead.status !== "ok" ||
            !metadataRead.metadata.scratchpadUsed
          )
            continue;
          const metadata = metadataRead.metadata;
          if (metadata.projectIds.length > 0) {
            await writeMetadata({ ...metadata, scratchpadUsed: false });
            continue;
          }
          const removed = await removeEntry(key);
          entriesRemoved += removed.entriesRemoved;
          bytesFreed += removed.bytesFreed;
        } catch {
          /* malformed metadata has no trusted Scratchpad association */
        }
      }
      return { entriesRemoved, bytesFreed };
    },
  };

  async function listKeys(): Promise<string[]> {
    if (await missing(options.rootDirectory)) return [];
    const root = await lstat(options.rootDirectory);
    if (!root.isDirectory() || root.isSymbolicLink())
      throw new Error("Speech cache root must be a real directory.");
    const keys = new Set<string>();
    for (const shard of await readdir(options.rootDirectory, {
      withFileTypes: true,
    })) {
      if (!SHARD_PATTERN.test(shard.name)) continue;
      if (!shard.isDirectory() || shard.isSymbolicLink())
        throw new Error("Speech cache contains an unsafe shard.");
      for (const file of await readdir(
        join(options.rootDirectory, shard.name),
        { withFileTypes: true },
      )) {
        if (file.isSymbolicLink())
          throw new Error("Speech cache contains an unsafe entry.");
        const match = /^([a-f0-9]{64})\.(?:wav|json)$/u.exec(file.name);
        if (file.isFile() && match?.[1]?.startsWith(shard.name))
          keys.add(match[1]);
      }
    }
    return [...keys].sort();
  }

  return cache;
}
