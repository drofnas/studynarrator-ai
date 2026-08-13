import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpeechCache, createSpeechCacheKey, normalizeSpeechText, type SpeechCacheKeyInput } from "./index.js";

const input: SpeechCacheKeyInput = {
  adapterId: "speaches-openai",
  adapterVersion: 1,
  serverIdentity: "http://127.0.0.1:8000",
  profileId: "profile-a",
  modelId: "model-a",
  voiceId: "voice-a",
  speed: 1,
  text: "SQL indexes improve reads.",
  responseFormat: "wav"
};

async function fixture() {
  const rootDirectory = await mkdtemp(join(tmpdir(), "studynarrator-cache-"));
  const cache = createSpeechCache({
    rootDirectory,
    validateAudio: async (bytes) => bytes[0] === 82,
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 7, 13, 12, 0, tick++));
    })(),
    createId: (() => { let id = 0; return () => `temporary-${String(id++)}`; })()
  });
  return { cache, rootDirectory };
}

describe("speech cache keys", () => {
  it("normalizes Unicode and line endings deterministically", () => {
    expect(normalizeSpeechText("  cafe\u0301\r\nline  ")).toBe("café\nline");
    expect(createSpeechCacheKey({ ...input, text: " cafe\u0301\r\nline " })).toBe(
      createSpeechCacheKey({ ...input, text: "café\nline" })
    );
  });

  it.each(["adapterId", "adapterVersion", "serverIdentity", "profileId", "modelId", "voiceId", "speed", "text"] as const)(
    "changes when %s changes",
    (field) => {
      const changed = field === "adapterVersion" ? 2 : field === "speed" ? 1.25 : `${String(input[field])}-changed`;
      expect(createSpeechCacheKey({ ...input, [field]: changed })).not.toBe(createSpeechCacheKey(input));
    }
  );

  it("does not accept unrelated pause, gain, retry, or output settings", () => {
    const withUnrelated = { ...input, pauseDurationMs: 900, gainDb: 4, retryCount: 5, outputName: "chapter.mp3" };
    expect(createSpeechCacheKey(withUnrelated)).toBe(createSpeechCacheKey(input));
  });
});

describe("content-addressed speech cache", () => {
  it("writes once, reuses validated audio, and tracks project and Scratchpad use", async () => {
    const { cache, rootDirectory } = await fixture();
    const synthesize = vi.fn(async () => Uint8Array.from([82, 73, 70, 70]));
    const first = await cache.getOrCreate(input, { scratchpad: true }, synthesize);
    const second = await cache.getOrCreate(input, { projectId: "project-a" }, synthesize);
    expect(first.status).toBe("miss");
    expect(second.status).toBe("hit");
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(second.metadata).toMatchObject({ projectIds: ["project-a"], scratchpadUsed: true });
    const metadata = JSON.parse(await readFile(join(rootDirectory, second.key.slice(0, 2), `${second.key}.json`), "utf8")) as unknown;
    expect(metadata).not.toHaveProperty("serverIdentity");
    expect(metadata).not.toHaveProperty("normalizedText");
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 1, totalBytes: 4, sessionHits: 1, sessionMisses: 1, sessionWrites: 1 });
  });

  it("deduplicates concurrent synthesis and isolates a cancelled waiter", async () => {
    const { cache } = await fixture();
    let finish: ((bytes: Uint8Array) => void) | undefined;
    const synthesize = vi.fn(async () => await new Promise<Uint8Array>((resolve) => { finish = resolve; }));
    const cancelled = new AbortController();
    const first = cache.getOrCreate(input, { projectId: "project-a" }, synthesize, cancelled.signal);
    const second = cache.getOrCreate(input, { projectId: "project-a" }, synthesize);
    while (!finish) await new Promise<void>((resolve) => setImmediate(resolve));
    cancelled.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    finish?.(Uint8Array.from([82, 73, 70, 70]));
    await expect(second).resolves.toMatchObject({ status: "miss" });
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("rejects corrupt and partial entries before synthesizing a replacement", async () => {
    const { cache, rootDirectory } = await fixture();
    const first = await cache.getOrCreate(input, { projectId: "project-a" }, async () => Uint8Array.from([82, 73, 70, 70]));
    const audioPath = join(rootDirectory, first.key.slice(0, 2), `${first.key}.wav`);
    await writeFile(audioPath, Uint8Array.from([0, 1, 2]));
    const synthesize = vi.fn(async () => Uint8Array.from([82, 1, 2, 3]));
    await expect(cache.getOrCreate(input, { projectId: "project-a" }, synthesize)).resolves.toMatchObject({ status: "miss" });
    expect(synthesize).toHaveBeenCalledTimes(1);
    await expect(cache.status()).resolves.toMatchObject({ sessionCorruptMisses: 1 });
  });

  it("clears a selected key, project-associated keys, and all remaining entries", async () => {
    const { cache } = await fixture();
    const one = await cache.getOrCreate(input, { projectId: "project-a" }, async () => Uint8Array.from([82, 1]));
    const two = await cache.getOrCreate({ ...input, text: "second" }, { projectId: "project-a" }, async () => Uint8Array.from([82, 2, 3]));
    await cache.getOrCreate({ ...input, text: "third" }, { projectId: "project-b" }, async () => Uint8Array.from([82, 3, 4, 5]));
    await expect(cache.clearEntry(one.key)).resolves.toEqual({ entriesRemoved: 1, bytesFreed: 2 });
    await expect(cache.clearProject("project-a")).resolves.toEqual({ entriesRemoved: 1, bytesFreed: 3 });
    expect(two.key).not.toBe(one.key);
    await expect(cache.clearAll()).resolves.toEqual({ entriesRemoved: 1, bytesFreed: 4 });
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 0, totalBytes: 0 });
  });

  it("treats a symlinked cache entry as a safe miss and replaces only the link", async () => {
    const { cache, rootDirectory } = await fixture();
    const key = createSpeechCacheKey(input);
    const shard = join(rootDirectory, key.slice(0, 2));
    await cache.getOrCreate(input, {}, async () => Uint8Array.from([82, 1]));
    const target = join(rootDirectory, "outside.wav");
    await writeFile(target, Uint8Array.from([82]));
    const entry = join(shard, `${key}.wav`);
    await (await import("node:fs/promises")).unlink(entry);
    await symlink(target, entry);
    const synthesize = vi.fn(async () => Uint8Array.from([82, 2]));
    await expect(cache.getOrCreate(input, {}, synthesize)).resolves.toMatchObject({ status: "miss" });
    expect(synthesize).toHaveBeenCalledOnce();
    expect(await readFile(target)).toEqual(Buffer.from([82]));
  });
});
