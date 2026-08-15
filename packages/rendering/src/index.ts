import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  ProjectSnapshotSchema,
  RenderPlanIdSchema,
  RenderPlanSchema,
  RenderPlanSummaryCollectionSchema,
  type ProjectSnapshot,
  type RenderPlan,
  type RenderPlanSummary,
  type SilenceAsset
} from "@studynarrator/shared-types";

export const SPEECH_CACHE_SCHEMA_VERSION = 1;
export const SPEECH_NORMALIZATION_VERSION = 1;
export const SPEECH_CHUNKING_VERSION = 1;
const MAX_CACHED_SPEECH_BYTES = 5 * 1024 * 1024;
const CACHE_KEY_PATTERN = /^[a-f0-9]{64}$/u;
const SHARD_PATTERN = /^[a-f0-9]{2}$/u;
const MAX_CACHE_METADATA_BYTES = 64 * 1024;
const METADATA_KEYS = new Set([
  "schemaVersion", "normalizationVersion", "chunkingVersion", "adapterId", "adapterVersion",
  "serverIdentityHash", "modelId", "voiceId", "speed", "textHash", "responseFormat",
  "key", "audioChecksum", "byteLength", "createdAt", "lastUsedAt", "projectIds", "scratchpadUsed"
]);

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

interface NormalizedSpeechCacheInput extends Omit<SpeechCacheKeyInput, "serverIdentity" | "text"> {
  serverIdentityHash: string;
  normalizedText: string;
  textHash: string;
}

export interface SpeechCacheUsage {
  projectId?: string;
  scratchpad?: boolean;
}

interface SpeechCacheEntryMetadata extends Omit<NormalizedSpeechCacheInput, "normalizedText"> {
  schemaVersion: typeof SPEECH_CACHE_SCHEMA_VERSION;
  normalizationVersion: typeof SPEECH_NORMALIZATION_VERSION;
  chunkingVersion: typeof SPEECH_CHUNKING_VERSION;
  key: string;
  audioChecksum: string;
  byteLength: number;
  createdAt: string;
  lastUsedAt: string;
  projectIds: string[];
  scratchpadUsed: boolean;
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
    synthesize: (normalizedText: string, signal: AbortSignal) => Promise<Uint8Array>,
    signal?: AbortSignal
  ): Promise<CachedSpeechResult>;
  inspect(input: SpeechCacheKeyInput, signal?: AbortSignal): Promise<{ key: string; status: "hit" | "miss" }>;
  status(): Promise<SpeechCacheStatus>;
  clearAll(): Promise<SpeechCacheCleanupResult>;
  clearProject(projectId: string): Promise<SpeechCacheCleanupResult>;
  clearEntry(key: string): Promise<SpeechCacheCleanupResult>;
  retainScratchpad(key: string): Promise<SpeechCacheCleanupResult>;
}

type CachedAudioValidator = (bytes: Uint8Array, signal?: AbortSignal) => Promise<boolean>;

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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeSpeechText(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
}

function normalizeSpeechCacheInput(input: SpeechCacheKeyInput): NormalizedSpeechCacheInput {
  const normalizedText = normalizeSpeechText(input.text);
  if (!input.adapterId.trim() || !Number.isInteger(input.adapterVersion) || input.adapterVersion < 1) {
    throw new Error("Speech cache adapter identity is invalid.");
  }
  if (!input.serverIdentity.trim() || !input.modelId.trim() || !input.voiceId.trim()) {
    throw new Error("Speech cache synthesis identity is incomplete.");
  }
  if (!Number.isFinite(input.speed) || input.speed <= 0 || input.speed > 4 || !normalizedText) {
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
    responseFormat: input.responseFormat
  };
}

export function createSpeechCacheKey(input: SpeechCacheKeyInput): string {
  const normalized = normalizeSpeechCacheInput(input);
  return sha256(JSON.stringify({
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
    responseFormat: normalized.responseFormat
  }));
}

function assertCacheKey(value: string): string {
  if (!CACHE_KEY_PATTERN.test(value)) throw new Error("Speech cache key is invalid.");
  return value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function parseMetadata(value: unknown): SpeechCacheEntryMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== METADATA_KEYS.size || Object.keys(item).some((key) => !METADATA_KEYS.has(key))
    || item.schemaVersion !== SPEECH_CACHE_SCHEMA_VERSION
    || item.normalizationVersion !== SPEECH_NORMALIZATION_VERSION
    || item.chunkingVersion !== SPEECH_CHUNKING_VERSION
    || typeof item.key !== "string" || !CACHE_KEY_PATTERN.test(item.key)
    || typeof item.adapterId !== "string" || !item.adapterId
    || typeof item.adapterVersion !== "number" || !Number.isInteger(item.adapterVersion)
    || typeof item.serverIdentityHash !== "string" || !CACHE_KEY_PATTERN.test(item.serverIdentityHash)
    || typeof item.modelId !== "string" || !item.modelId
    || typeof item.voiceId !== "string" || !item.voiceId
    || typeof item.speed !== "number" || !Number.isFinite(item.speed)
    || item.responseFormat !== "wav"
    || typeof item.textHash !== "string" || !CACHE_KEY_PATTERN.test(item.textHash)
    || typeof item.audioChecksum !== "string" || !CACHE_KEY_PATTERN.test(item.audioChecksum)
    || typeof item.byteLength !== "number" || !Number.isInteger(item.byteLength) || item.byteLength < 1 || item.byteLength > MAX_CACHED_SPEECH_BYTES
    || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))
    || typeof item.lastUsedAt !== "string" || !Number.isFinite(Date.parse(item.lastUsedAt))
    || !isStringArray(item.projectIds)
    || typeof item.scratchpadUsed !== "boolean") return null;
  return item as unknown as SpeechCacheEntryMetadata;
}

function metadataMatchesInput(metadata: SpeechCacheEntryMetadata, input: NormalizedSpeechCacheInput): boolean {
  return metadata.adapterId === input.adapterId
    && metadata.adapterVersion === input.adapterVersion
    && metadata.serverIdentityHash === input.serverIdentityHash
    && metadata.modelId === input.modelId
    && metadata.voiceId === input.voiceId
    && metadata.speed === input.speed
    && metadata.textHash === input.textHash
    && metadata.responseFormat === input.responseFormat;
}

function mergedUsage(metadata: SpeechCacheEntryMetadata, usage: SpeechCacheUsage, lastUsedAt: string): SpeechCacheEntryMetadata {
  const projectIds = new Set(metadata.projectIds);
  if (usage.projectId) projectIds.add(usage.projectId);
  return {
    ...metadata,
    lastUsedAt,
    projectIds: [...projectIds].sort((left, right) => left.localeCompare(right, "en-US")),
    scratchpadUsed: metadata.scratchpadUsed || usage.scratchpad === true
  };
}

function mergedUsages(metadata: SpeechCacheEntryMetadata, usages: readonly SpeechCacheUsage[], lastUsedAt: string): SpeechCacheEntryMetadata {
  return usages.reduce((current, usage) => mergedUsage(current, usage, lastUsedAt), metadata);
}

function aborted(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

async function missing(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
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

async function readBoundedFile(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size < 1 || details.size > maximumBytes) throw new Error("Speech cache file size is invalid.");
    const bytes = Buffer.allocUnsafe(details.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) throw new Error("Speech cache file was truncated during its bounded read.");
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
    if (!entry.isFile() && !entry.isSymbolicLink()) throw new Error("Refusing to remove an unsafe speech cache path.");
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
}): SpeechCache {
  if (!options.rootDirectory.trim()) throw new Error("Speech cache root is required.");
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const flights = new Map<string, Flight>();
  const counters: SessionCounters = { hits: 0, misses: 0, writes: 0, corruptMisses: 0 };

  const paths = (keyValue: string) => {
    const key = assertCacheKey(keyValue);
    const directory = join(options.rootDirectory, key.slice(0, 2));
    return { key, directory, audio: join(directory, `${key}.wav`), metadata: join(directory, `${key}.json`) };
  };

  const ensureDirectory = async (directory: string) => {
    await mkdir(options.rootDirectory, { recursive: true, mode: 0o700 });
    const root = await lstat(options.rootDirectory);
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Speech cache root must be a real directory.");
    await chmod(options.rootDirectory, 0o700);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const shard = await lstat(directory);
    if (!shard.isDirectory() || shard.isSymbolicLink()) throw new Error("Speech cache shard must be a real directory.");
    await chmod(directory, 0o700);
  };

  const writeMetadata = async (metadata: SpeechCacheEntryMetadata) => {
    const entryPaths = paths(metadata.key);
    await ensureDirectory(entryPaths.directory);
    const temporary = join(entryPaths.directory, `${metadata.key}.${createId()}.tmp.json`);
    try {
      await writeFile(temporary, `${JSON.stringify(metadata)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporary, 0o600);
      await rename(temporary, entryPaths.metadata);
    } catch (error) {
      await safeUnlink(temporary).catch(() => undefined);
      throw error;
    }
  };

  const removeEntry = async (keyValue: string): Promise<SpeechCacheCleanupResult> => {
    const entryPaths = paths(keyValue);
    let bytesFreed = 0;
    let found = false;
    try {
      const audio = await lstat(entryPaths.audio);
      if (!audio.isFile() && !audio.isSymbolicLink()) throw new Error("Refusing to remove an unsafe speech cache audio path.");
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
    touch = true
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
      const [metadataJson, audioBuffer] = await Promise.all([
        readBoundedFile(entryPaths.metadata, MAX_CACHE_METADATA_BYTES),
        readBoundedFile(entryPaths.audio, MAX_CACHED_SPEECH_BYTES)
      ]);
      const metadata = parseMetadata(JSON.parse(metadataJson.toString("utf8")) as unknown);
      if (!metadata || metadata.key !== key || !metadataMatchesInput(metadata, normalized)
        || metadata.byteLength !== audioBuffer.byteLength || metadata.audioChecksum !== sha256(audioBuffer)) {
        throw new Error("Cached speech metadata failed integrity validation.");
      }
      if (!(await options.validateAudio(audioBuffer, signal))) throw new Error("Cached speech audio failed decoding validation.");
      const updated = touch ? mergedUsages(metadata, usages, now().toISOString()) : metadata;
      if (touch) {
        await writeMetadata(updated);
        counters.hits += 1;
      }
      return { key, status: "hit", bytes: new Uint8Array(audioBuffer), metadata: updated };
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
    signal?: AbortSignal
  ): Promise<SpeechCacheEntryMetadata> => {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_CACHED_SPEECH_BYTES) throw new Error("Synthesized speech exceeds the cache size limit.");
    if (!(await options.validateAudio(bytes, signal))) throw new Error("Synthesized speech failed cache validation.");
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
      responseFormat: normalized.responseFormat
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
      projectIds: [...new Set(usages.flatMap((usage) => usage.projectId ? [usage.projectId] : []))].sort((left, right) => left.localeCompare(right, "en-US")),
      scratchpadUsed: usages.some((usage) => usage.scratchpad === true)
    };
    const suffix = createId();
    const temporaryAudio = join(entryPaths.directory, `${key}.${suffix}.tmp.wav`);
    const temporaryMetadata = join(entryPaths.directory, `${key}.${suffix}.tmp.json`);
    try {
      await writeFile(temporaryAudio, bytes, { mode: 0o600, flag: "wx" });
      await writeFile(temporaryMetadata, `${JSON.stringify(metadata)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporaryAudio, 0o600);
      await chmod(temporaryMetadata, 0o600);
      await rename(temporaryAudio, entryPaths.audio);
      await rename(temporaryMetadata, entryPaths.metadata);
      counters.writes += 1;
      return metadata;
    } catch (error) {
      await Promise.all([safeUnlink(temporaryAudio).catch(() => undefined), safeUnlink(temporaryMetadata).catch(() => undefined)]);
      throw error;
    }
  };

  const produce = async (
    key: string,
    normalized: NormalizedSpeechCacheInput,
    usages: readonly SpeechCacheUsage[],
    synthesize: (normalizedText: string, signal: AbortSignal) => Promise<Uint8Array>,
    signal: AbortSignal
  ): Promise<CachedSpeechResult> => {
    const cached = await loadEntry(key, normalized, usages, signal);
    if (cached) return cached;
    counters.misses += 1;
    const bytes = await synthesize(normalized.normalizedText, signal);
    const metadata = await writeEntry(key, normalized, bytes, usages, signal);
    return { key, status: "miss", bytes, metadata };
  };

  const waitForFlight = async (flight: Flight, signal?: AbortSignal): Promise<CachedSpeechResult> => {
    if (signal?.aborted) throw aborted(signal);
    flight.waiters += 1;
    try {
      if (!signal) return await flight.promise;
      return await Promise.race([
        flight.promise,
        new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(aborted(signal)), { once: true }))
      ]);
    } finally {
      flight.waiters -= 1;
      if (flight.waiters === 0 && !flight.settled) flight.controller.abort();
    }
  };

  const cache: SpeechCache = {
    async getOrCreate(input, usage, synthesize, signal) {
      const normalized = normalizeSpeechCacheInput(input);
      const key = createSpeechCacheKey(input);
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
        promise: Promise.resolve(undefined as never)
      };
      flight.promise = produce(key, normalized, flight.usages, synthesize, controller.signal).finally(() => {
        flight.settled = true;
        flights.delete(key);
      });
      flights.set(key, flight);
      return await waitForFlight(flight, signal);
    },
    async inspect(input, signal) {
      const normalized = normalizeSpeechCacheInput(input);
      const key = createSpeechCacheKey(input);
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
        if (!(await regularFile(entryPaths.audio)) || !(await regularFile(entryPaths.metadata))) continue;
        try {
          const metadata = parseMetadata(JSON.parse((await readBoundedFile(entryPaths.metadata, MAX_CACHE_METADATA_BYTES)).toString("utf8")) as unknown);
          if (!metadata || metadata.key !== key) continue;
          totalBytes += metadata.byteLength;
          entryCount += 1;
          if (lastUsedAt === null || metadata.lastUsedAt > lastUsedAt) lastUsedAt = metadata.lastUsedAt;
        } catch { /* invalid entries are reported as misses when accessed */ }
      }
      return {
        entryCount,
        totalBytes,
        lastUsedAt,
        sessionHits: counters.hits,
        sessionMisses: counters.misses,
        sessionWrites: counters.writes,
        sessionCorruptMisses: counters.corruptMisses,
        inFlight: flights.size
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
      if (!projectId.trim()) throw new Error("Project ID is required for cache cleanup.");
      let entriesRemoved = 0;
      let bytesFreed = 0;
      for (const key of await listKeys()) {
        const entryPaths = paths(key);
        if (!(await regularFile(entryPaths.metadata))) continue;
        try {
          const metadata = parseMetadata(JSON.parse((await readBoundedFile(entryPaths.metadata, MAX_CACHE_METADATA_BYTES)).toString("utf8")) as unknown);
          if (!metadata?.projectIds.includes(projectId)) continue;
          const removed = await removeEntry(key);
          entriesRemoved += removed.entriesRemoved;
          bytesFreed += removed.bytesFreed;
        } catch { /* malformed metadata has no trusted project association */ }
      }
      return { entriesRemoved, bytesFreed };
    },
    async clearEntry(key) {
      return await removeEntry(assertCacheKey(key));
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
          const metadata = parseMetadata(JSON.parse((await readBoundedFile(entryPaths.metadata, MAX_CACHE_METADATA_BYTES)).toString("utf8")) as unknown);
          if (!metadata?.scratchpadUsed) continue;
          if (metadata.projectIds.length > 0) {
            await writeMetadata({ ...metadata, scratchpadUsed: false });
            continue;
          }
          const removed = await removeEntry(key);
          entriesRemoved += removed.entriesRemoved;
          bytesFreed += removed.bytesFreed;
        } catch { /* malformed metadata has no trusted Scratchpad association */ }
      }
      return { entriesRemoved, bytesFreed };
    }
  };

  async function listKeys(): Promise<string[]> {
    if (await missing(options.rootDirectory)) return [];
    const root = await lstat(options.rootDirectory);
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Speech cache root must be a real directory.");
    const keys = new Set<string>();
    for (const shard of await readdir(options.rootDirectory, { withFileTypes: true })) {
      if (!SHARD_PATTERN.test(shard.name)) continue;
      if (!shard.isDirectory() || shard.isSymbolicLink()) throw new Error("Speech cache contains an unsafe shard.");
      for (const file of await readdir(join(options.rootDirectory, shard.name), { withFileTypes: true })) {
        if (file.isSymbolicLink()) throw new Error("Speech cache contains an unsafe entry.");
        const match = /^([a-f0-9]{64})\.(?:wav|json)$/u.exec(file.name);
        if (file.isFile() && match?.[1]?.startsWith(shard.name)) keys.add(match[1]);
      }
    }
    return [...keys].sort();
  }

  return cache;
}

const RENDER_PLAN_SAMPLE_RATE = 24_000;
const RENDER_PLAN_CHANNELS = 1;
const RENDER_PLAN_BITS_PER_SAMPLE = 16;
const MAX_RENDER_PLAN_JSON_BYTES = 12 * 1024 * 1024;

interface AudioProbeMetadata {
  decodable: boolean;
  durationMs: number;
  bitRate: number | null;
  formatName: string | null;
}

interface WaveformPeaks {
  durationMs: number;
  sampleRate: number;
  peaks: number[];
}

function processError(name: string): Error {
  return new Error(`${name} could not complete the audio operation.`);
}

async function runAudioProcess(command: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
  return await new Promise<string>((resolveProcess, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderrBytes = 0;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { if (stdout.length < 256_000) stdout += chunk.slice(0, 256_000 - stdout.length); });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.byteLength; });
    child.once("error", () => finish(() => reject(processError(command))));
    child.once("close", (code) => finish(() => code === 0 && stderrBytes <= 256_000 ? resolveProcess(stdout) : reject(processError(command))));
  });
}

export async function extractWaveformPeaks(options: {
  inputPath: string;
  maxPeaks?: number;
  sampleRate?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  signal?: AbortSignal;
}): Promise<WaveformPeaks> {
  const maxPeaks = options.maxPeaks ?? 1_024;
  const sampleRate = options.sampleRate ?? 8_000;
  if (!Number.isInteger(maxPeaks) || maxPeaks < 1 || maxPeaks > 1_024) throw new Error("Waveform peak count is invalid.");
  if (!Number.isInteger(sampleRate) || sampleRate < 1_000 || sampleRate > 48_000) throw new Error("Waveform sample rate is invalid.");
  const probe = await probeAudioFile({
    inputPath: options.inputPath,
    ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
    ...(options.signal ? { signal: options.signal } : {})
  });
  if (!probe.decodable) throw new Error("Waveform source audio did not decode.");
  if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new DOMException("The operation was aborted.", "AbortError");

  return await new Promise<WaveformPeaks>((resolvePeaks, reject) => {
    const child = spawn(options.ffmpegPath ?? "ffmpeg", [
      "-v", "error", "-i", options.inputPath, "-map", "0:a:0", "-ac", "1", "-ar", String(sampleRate),
      "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"
    ], { shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const peaks: number[] = [];
    let samplesPerPeak = Math.max(1, Math.ceil((probe.durationMs / 1_000 * sampleRate) / maxPeaks));
    let bucketSamples = 0;
    let bucketPeak = 0;
    let trailingByte: number | null = null;
    let stderrBytes = 0;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const compact = () => {
      const compacted: number[] = [];
      for (let index = 0; index < peaks.length; index += 2) compacted.push(Math.max(peaks[index] ?? 0, peaks[index + 1] ?? 0));
      peaks.splice(0, peaks.length, ...compacted);
      samplesPerPeak *= 2;
    };
    const emitPeak = () => {
      if (peaks.length >= maxPeaks) compact();
      peaks.push(bucketPeak);
      bucketSamples = 0;
      bucketPeak = 0;
    };
    const acceptSample = (sample: number) => {
      bucketPeak = Math.max(bucketPeak, Math.min(255, Math.round(Math.abs(sample) / 32_768 * 255)));
      bucketSamples += 1;
      if (bucketSamples >= samplesPerPeak) emitPeak();
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(options.signal?.reason instanceof Error ? options.signal.reason : new DOMException("The operation was aborted.", "AbortError")));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      let offset = 0;
      if (trailingByte !== null && chunk.byteLength > 0) {
        const unsigned = trailingByte | chunk[0]! << 8;
        acceptSample(unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned);
        trailingByte = null;
        offset = 1;
      }
      for (; offset + 1 < chunk.byteLength; offset += 2) acceptSample(chunk.readInt16LE(offset));
      if (offset < chunk.byteLength) trailingByte = chunk[offset]!;
    });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.byteLength; });
    child.once("error", () => finish(() => reject(processError(options.ffmpegPath ?? "ffmpeg"))));
    child.once("close", (code) => finish(() => {
      if (code !== 0 || stderrBytes > 256_000) reject(processError(options.ffmpegPath ?? "ffmpeg"));
      else {
        if (bucketSamples > 0) emitPeak();
        while (peaks.length > maxPeaks) compact();
        resolvePeaks({ durationMs: probe.durationMs, sampleRate, peaks: peaks.length > 0 ? peaks : [0] });
      }
    }));
  });
}

export async function normalizeSpeechWav(options: {
  inputPath: string; outputPath: string; gainDb: number; ffmpegPath?: string; signal?: AbortSignal;
}): Promise<void> {
  await runAudioProcess(options.ffmpegPath ?? "ffmpeg", [
    "-y", "-v", "error", "-i", options.inputPath,
    "-af", `volume=${String(options.gainDb)}dB,alimiter=limit=0.95`,
    "-ar", String(RENDER_PLAN_SAMPLE_RATE), "-ac", String(RENDER_PLAN_CHANNELS),
    "-c:a", "pcm_s16le", options.outputPath
  ], options.signal);
}

export async function concatenateWavs(options: {
  listPath: string; outputPath: string; ffmpegPath?: string; signal?: AbortSignal;
}): Promise<void> {
  await runAudioProcess(options.ffmpegPath ?? "ffmpeg", [
    "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", options.listPath,
    "-ar", String(RENDER_PLAN_SAMPLE_RATE), "-ac", String(RENDER_PLAN_CHANNELS),
    "-c:a", "pcm_s16le", options.outputPath
  ], options.signal);
}

export async function encodeMp3(options: {
  inputPath: string; outputPath: string; ffmpegPath?: string; signal?: AbortSignal;
}): Promise<void> {
  await runAudioProcess(options.ffmpegPath ?? "ffmpeg", [
    "-y", "-v", "error", "-i", options.inputPath, "-c:a", "libmp3lame", "-b:a", "192k", options.outputPath
  ], options.signal);
}

export async function probeAudioFile(options: {
  inputPath: string; ffprobePath?: string; signal?: AbortSignal;
}): Promise<AudioProbeMetadata> {
  const stdout = await runAudioProcess(options.ffprobePath ?? "ffprobe", [
    "-v", "error", "-show_entries", "format=format_name,duration,bit_rate:stream=codec_type", "-of", "json", options.inputPath
  ], options.signal);
  try {
    const value = JSON.parse(stdout) as { format?: { format_name?: unknown; duration?: unknown; bit_rate?: unknown }; streams?: Array<{ codec_type?: unknown }> };
    const duration = typeof value.format?.duration === "string" ? Number(value.format.duration) : Number.NaN;
    const bitRate = typeof value.format?.bit_rate === "string" ? Number(value.format.bit_rate) : null;
    return {
      decodable: value.streams?.some(({ codec_type }) => codec_type === "audio") === true && Number.isFinite(duration),
      durationMs: Number.isFinite(duration) ? Math.max(0, Math.round(duration * 1_000)) : 0,
      bitRate: bitRate !== null && Number.isFinite(bitRate) ? Math.round(bitRate) : null,
      formatName: typeof value.format?.format_name === "string" ? value.format.format_name : null
    };
  } catch {
    return { decodable: false, durationMs: 0, bitRate: null, formatName: null };
  }
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

type ProjectSnapshotWithoutHash = ProjectSnapshot extends infer T
  ? T extends { snapshotHash: string } ? Omit<T, "snapshotHash"> : never
  : never;

export function withProjectSnapshotHash(input: ProjectSnapshotWithoutHash): ProjectSnapshot {
  const normalized = ProjectSnapshotSchema.parse({ ...input, snapshotHash: "0".repeat(64) });
  const { snapshotHash: _snapshotHash, ...payload } = normalized;
  void _snapshotHash;
  return ProjectSnapshotSchema.parse({ ...payload, snapshotHash: hashJson(payload) });
}

export function withRenderPlanHash(input: Omit<RenderPlan, "planHash">): RenderPlan {
  const normalized = RenderPlanSchema.parse({ ...input, planHash: "0".repeat(64) });
  const { planHash: _planHash, ...payload } = normalized;
  void _planHash;
  return RenderPlanSchema.parse({ ...payload, planHash: hashJson(payload) });
}

export function createPcmSilence(durationMs: number): { bytes: Uint8Array | null; asset: SilenceAsset | null } {
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 30_000) throw new Error("Silence duration must be an integer from 0 through 30000 milliseconds.");
  if (durationMs === 0) return { bytes: null, asset: null };
  const frameCount = RENDER_PLAN_SAMPLE_RATE * durationMs / 1_000;
  const dataLength = frameCount * RENDER_PLAN_CHANNELS * (RENDER_PLAN_BITS_PER_SAMPLE / 8);
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, RENDER_PLAN_CHANNELS, true);
  view.setUint32(24, RENDER_PLAN_SAMPLE_RATE, true);
  view.setUint32(28, RENDER_PLAN_SAMPLE_RATE * RENDER_PLAN_CHANNELS * (RENDER_PLAN_BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, RENDER_PLAN_CHANNELS * (RENDER_PLAN_BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, RENDER_PLAN_BITS_PER_SAMPLE, true);
  ascii(36, "data");
  view.setUint32(40, dataLength, true);
  const checksum = sha256(bytes);
  return {
    bytes,
    asset: {
      relativePath: `silence/${checksum}.wav`,
      checksum,
      byteLength: bytes.byteLength,
      sampleRate: RENDER_PLAN_SAMPLE_RATE,
      channels: RENDER_PLAN_CHANNELS,
      bitsPerSample: RENDER_PLAN_BITS_PER_SAMPLE,
      frameCount
    }
  };
}

export interface RenderPlanStore {
  save(snapshot: ProjectSnapshot, plan: RenderPlan, silenceAssets: ReadonlyMap<string, Uint8Array>): Promise<RenderPlan>;
  list(projectId: string): Promise<RenderPlanSummary[]>;
  get(planId: string): Promise<RenderPlan>;
  load(planId: string): Promise<{ snapshot: ProjectSnapshot; plan: RenderPlan; silenceAssets: ReadonlyMap<string, Uint8Array> }>;
}

function verifiedSnapshotHash(snapshot: ProjectSnapshot): boolean {
  const { snapshotHash, ...payload } = snapshot;
  return snapshotHash === hashJson(payload);
}

function verifiedPlanHash(plan: RenderPlan): boolean {
  const { planHash, ...payload } = plan;
  return planHash === hashJson(payload);
}

async function boundedRead(path: string, maximumBytes: number): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size < 1 || details.size > maximumBytes) throw new Error("Render plan artifact size is invalid.");
    const bytes = new Uint8Array(details.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) throw new Error("Render plan artifact was truncated.");
      offset += bytesRead;
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function boundedJson(path: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await boundedRead(path, MAX_RENDER_PLAN_JSON_BYTES))) as unknown;
}

export function createRenderPlanStore(rootDirectoryInput: string): RenderPlanStore {
  const rootDirectory = resolve(rootDirectoryInput);
  if (!rootDirectoryInput.trim() || rootDirectory === resolve("/")) throw new Error("Render plan root must be a scoped directory.");

  const ensureRoot = async () => {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
    const root = await lstat(rootDirectory);
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Render plan root must be a real directory.");
    await chmod(rootDirectory, 0o700);
  };

  const readBundle = async (planIdInput: string): Promise<{ snapshot: ProjectSnapshot; plan: RenderPlan }> => {
    const planId = RenderPlanIdSchema.parse(planIdInput);
    const directory = join(rootDirectory, planId);
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("Render plan directory is unsafe.");
    const snapshot = ProjectSnapshotSchema.parse(await boundedJson(join(directory, "project-snapshot.json")));
    const plan = RenderPlanSchema.parse(await boundedJson(join(directory, "render-plan.json")));
    if (plan.id !== planId || snapshot.project.id !== plan.projectId || snapshot.project.scriptHash !== plan.scriptHash || snapshot.snapshotHash !== plan.snapshotHash
      || !verifiedSnapshotHash(snapshot) || !verifiedPlanHash(plan)) throw new Error("Render plan hashes are inconsistent.");
    const silenceDirectory = join(directory, "silence");
    const silenceEntries = plan.entries.filter((entry) => entry.type === "pause" && entry.silence !== null);
    if (silenceEntries.length > 0) {
      const silenceDetails = await lstat(silenceDirectory);
      if (!silenceDetails.isDirectory() || silenceDetails.isSymbolicLink()) throw new Error("Render plan silence directory is unsafe.");
    }
    for (const entry of silenceEntries) {
      const asset = entry.type === "pause" ? entry.silence : null;
      if (!asset) continue;
      const bytes = await boundedRead(join(directory, asset.relativePath), asset.byteLength);
      if (bytes.byteLength !== asset.byteLength || sha256(bytes) !== asset.checksum) throw new Error("Render plan silence checksum is invalid.");
    }
    return { snapshot, plan };
  };

  return {
    async save(snapshotInput, planInput, silenceAssets) {
      const snapshot = ProjectSnapshotSchema.parse(snapshotInput);
      const plan = RenderPlanSchema.parse(planInput);
      if (!verifiedSnapshotHash(snapshot) || !verifiedPlanHash(plan) || snapshot.snapshotHash !== plan.snapshotHash
        || snapshot.project.id !== plan.projectId || snapshot.project.scriptHash !== plan.scriptHash) {
        throw new Error("Render plan cannot be saved with inconsistent hashes.");
      }
      await ensureRoot();
      const finalDirectory = join(rootDirectory, plan.id);
      const temporaryDirectory = join(rootDirectory, `${plan.id}.${randomUUID()}.tmp`);
      if (!temporaryDirectory.startsWith(`${rootDirectory}${sep}`)) throw new Error("Render plan temporary path escaped its root.");
      try {
        await mkdir(temporaryDirectory, { mode: 0o700 });
        await mkdir(join(temporaryDirectory, "silence"), { mode: 0o700 });
        await writeFile(join(temporaryDirectory, "project-snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await writeFile(join(temporaryDirectory, "render-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        const expected = new Map(plan.entries.flatMap((entry) => entry.type === "pause" && entry.silence ? [[entry.silence.checksum, entry.silence] as const] : []));
        for (const [checksum, asset] of expected) {
          const bytes = silenceAssets.get(checksum);
          if (!bytes || bytes.byteLength !== asset.byteLength || sha256(bytes) !== checksum) throw new Error("Render plan silence bytes do not match the manifest.");
          await writeFile(join(temporaryDirectory, asset.relativePath), bytes, { mode: 0o600, flag: "wx" });
        }
        await rename(temporaryDirectory, finalDirectory);
        return plan;
      } catch (error) {
        await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    },
    async list(projectId) {
      await ensureRoot();
      const summaries: RenderPlanSummary[] = [];
      for (const entry of await readdir(rootDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !RenderPlanIdSchema.safeParse(entry.name).success) continue;
        const { plan } = await readBundle(entry.name);
        if (plan.projectId === projectId) {
          summaries.push({
            id: plan.id, projectId: plan.projectId, createdAt: plan.createdAt, snapshotHash: plan.snapshotHash,
            planHash: plan.planHash, scriptHash: plan.scriptHash, summary: plan.summary
          });
        }
      }
      summaries.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
      return RenderPlanSummaryCollectionSchema.parse(summaries);
    },
    async get(planId) {
      await ensureRoot();
      return (await readBundle(planId)).plan;
    },
    async load(planId) {
      await ensureRoot();
      const bundle = await readBundle(planId);
      const directory = join(rootDirectory, bundle.plan.id);
      const silenceAssets = new Map<string, Uint8Array>();
      for (const entry of bundle.plan.entries) {
        if (entry.type !== "pause" || !entry.silence || silenceAssets.has(entry.silence.checksum)) continue;
        silenceAssets.set(entry.silence.checksum, await boundedRead(join(directory, entry.silence.relativePath), entry.silence.byteLength));
      }
      return { ...bundle, silenceAssets };
    }
  };
}
