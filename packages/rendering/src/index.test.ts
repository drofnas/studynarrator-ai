import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PROJECT_SNAPSHOT_SCHEMA_VERSION, RENDER_PLAN_SCHEMA_VERSION } from "@studynarrator/shared-types";
import {
  createPcmSilence,
  createRenderPlanStore,
  createSpeechCache,
  createSpeechCacheKey,
  extractWaveformPeaks,
  normalizeSpeechText,
  withProjectSnapshotHash,
  withRenderPlanHash,
  type SpeechCacheKeyInput
} from "./index.js";

const runFile = promisify(execFile);

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

  it("predicts hits without changing usage metadata or hit counters", async () => {
    const { cache } = await fixture();
    await expect(cache.inspect(input)).resolves.toMatchObject({ status: "miss", key: createSpeechCacheKey(input) });
    await cache.getOrCreate(input, { projectId: "project-a" }, async () => Uint8Array.from([82, 73, 70, 70]));
    await expect(cache.inspect(input)).resolves.toMatchObject({ status: "hit" });
    await expect(cache.status()).resolves.toMatchObject({ sessionHits: 0, sessionMisses: 1, sessionWrites: 1 });
  });

  it("deduplicates concurrent synthesis and isolates a cancelled waiter", async () => {
    const { cache } = await fixture();
    let finish: ((bytes: Uint8Array) => void) | undefined;
    const synthesize = vi.fn(async () => await new Promise<Uint8Array>((resolve) => { finish = resolve; }));
    const cancelled = new AbortController();
    const first = cache.getOrCreate(input, { projectId: "project-a" }, synthesize, cancelled.signal);
    const second = cache.getOrCreate(input, { projectId: "project-b", scratchpad: true }, synthesize);
    while (!finish) await new Promise<void>((resolve) => setImmediate(resolve));
    cancelled.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    finish?.(Uint8Array.from([82, 73, 70, 70]));
    await expect(second).resolves.toMatchObject({ status: "miss", metadata: { projectIds: ["project-a", "project-b"], scratchpadUsed: true } });
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

  it("retains one Scratchpad entry without deleting audio shared with projects", async () => {
    const { cache, rootDirectory } = await fixture();
    const oldScratchpad = await cache.getOrCreate(input, { scratchpad: true }, async () => Uint8Array.from([82, 1]));
    const sharedInput = { ...input, text: "shared" };
    const shared = await cache.getOrCreate(sharedInput, { scratchpad: true }, async () => Uint8Array.from([82, 2, 3]));
    await cache.getOrCreate(sharedInput, { projectId: "project-a" }, async () => Uint8Array.from([82, 2, 3]));
    const newest = await cache.getOrCreate({ ...input, text: "newest" }, { scratchpad: true }, async () => Uint8Array.from([82, 3, 4, 5]));

    await expect(cache.retainScratchpad(newest.key)).resolves.toEqual({ entriesRemoved: 1, bytesFreed: 2 });
    await expect(cache.inspect(input)).resolves.toMatchObject({ status: "miss", key: oldScratchpad.key });
    await expect(cache.inspect(sharedInput)).resolves.toMatchObject({ status: "hit", key: shared.key });
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 2, totalBytes: 7 });
    const sharedMetadata = JSON.parse(await readFile(join(rootDirectory, shared.key.slice(0, 2), `${shared.key}.json`), "utf8")) as { projectIds: string[]; scratchpadUsed: boolean };
    expect(sharedMetadata).toMatchObject({ projectIds: ["project-a"], scratchpadUsed: false });
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

describe("render plan silence and storage", () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const planId = "00000000-0000-4000-8000-000000000002";
  const timestamp = "2026-08-13T12:00:00.000Z";

  function bundle(durationMs = 750) {
    const silence = createPcmSilence(durationMs);
    const snapshot = withProjectSnapshotHash({
      schemaVersion: PROJECT_SNAPSHOT_SCHEMA_VERSION,
      capturedAt: timestamp,
      project: {
        contractVersion: 8,
        id: projectId,
        name: "Frozen plan",
        description: "",
        scriptSource: "[pause_medium]",
        scriptHash: "a".repeat(64),
        speakerMappings: [],
        pausePresets: [{ pauseId: "pause_medium", durationMs, description: "Paragraph" }],
        transitionPauses: { paragraph: { mode: "preset", pauseId: "pause_medium" }, speakerChange: { mode: "none" }, section: { mode: "none" } },
        lexiconEntries: [],
        createdAt: timestamp,
        updatedAt: timestamp
      },
      globalLexiconEntries: [],
      ignoredDiagnostics: [],
      connection: { modelId: "model", serverIdentityHash: "b".repeat(64) },
      versions: { scriptGrammar: 1, cirSchema: 1, lexiconTransform: 1, pacing: 1, speechCacheSchema: 1, speechNormalization: 1, speechChunking: 1, speechAdapter: 1 }
    });
    const plan = withRenderPlanHash({
      schemaVersion: RENDER_PLAN_SCHEMA_VERSION,
      id: planId,
      projectId,
      createdAt: timestamp,
      snapshotHash: snapshot.snapshotHash,
      scriptHash: "a".repeat(64),
      entries: [{
        type: "pause", ordinal: 1, sectionTitle: null, sourceRange: null, pauseKind: "automatic",
        reason: "paragraph", pauseId: "pause_medium", durationMs, silence: silence.asset
      }],
      summary: { sectionCount: 0, speechCount: 0, pauseCount: 1, cacheHits: 0, cacheMisses: 0, silenceDurationMs: durationMs }
    });
    return { silence, snapshot, plan };
  }

  it.each([350, 750, 1_500])("creates exact %d ms PCM silence", (durationMs) => {
    const { bytes, asset } = createPcmSilence(durationMs);
    expect(asset).toMatchObject({ sampleRate: 24_000, channels: 1, bitsPerSample: 16, frameCount: durationMs * 24 });
    expect(bytes?.byteLength).toBe(44 + durationMs * 24 * 2);
    expect(new TextDecoder().decode(bytes?.slice(0, 4))).toBe("RIFF");
  });

  it("represents zero duration without an invalid WAV", () => {
    expect(createPcmSilence(0)).toEqual({ bytes: null, asset: null });
  });

  it("writes, lists, and reopens an immutable validated bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "studynarrator-render-plan-"));
    const store = createRenderPlanStore(root);
    const { silence, snapshot, plan } = bundle();
    await store.save(snapshot, plan, new Map([[silence.asset!.checksum, silence.bytes!]]));
    await mkdir(join(root, `${planId}.interrupted.tmp`));
    await writeFile(join(root, `${planId}.interrupted.tmp`, "render-plan.json"), "{\"incomplete\":true}");
    await expect(store.save(snapshot, plan, new Map([[silence.asset!.checksum, silence.bytes!]]))).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([`${planId}.interrupted.tmp`]);
    await expect(store.list(projectId)).resolves.toEqual([expect.objectContaining({ id: planId, planHash: plan.planHash })]);
    await expect(store.get(planId)).resolves.toEqual(plan);
    const silencePath = join(root, planId, silence.asset!.relativePath);
    const probe = await runFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", silencePath]);
    expect(Number(probe.stdout.trim())).toBeCloseTo(0.75, 3);
  });

  it("rejects corrupt files, traversal-shaped IDs, and symlinked plan directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "studynarrator-render-plan-safety-"));
    const store = createRenderPlanStore(root);
    const { silence, snapshot, plan } = bundle();
    await store.save(snapshot, plan, new Map([[silence.asset!.checksum, silence.bytes!]]));
    await writeFile(join(root, planId, silence.asset!.relativePath), Uint8Array.from([1, 2, 3]));
    await expect(store.get(planId)).rejects.toThrow(/size|checksum/iu);
    await expect(store.get("../outside")).rejects.toThrow();
    const symlinkId = "00000000-0000-4000-8000-000000000003";
    await symlink(join(root, planId), join(root, symlinkId));
    await expect(store.get(symlinkId)).rejects.toThrow(/unsafe/iu);
  });

  it("rejects a schema-valid manifest whose checksum was changed after the atomic save", async () => {
    const root = await mkdtemp(join(tmpdir(), "studynarrator-render-plan-manifest-"));
    const store = createRenderPlanStore(root);
    const { silence, snapshot, plan } = bundle();
    await store.save(snapshot, plan, new Map([[silence.asset!.checksum, silence.bytes!]]));
    await writeFile(join(root, planId, "render-plan.json"), `${JSON.stringify({ ...plan, planHash: "0".repeat(64) })}\n`);
    await expect(store.get(planId)).rejects.toThrow(/hash/iu);
  });

  it("rejects a schema-valid manifest whose ID does not match its bundle directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "studynarrator-render-plan-id-"));
    const store = createRenderPlanStore(root);
    const { silence, snapshot, plan } = bundle();
    await store.save(snapshot, plan, new Map([[silence.asset!.checksum, silence.bytes!]]));
    const { planHash: _planHash, ...payload } = plan;
    void _planHash;
    const moved = withRenderPlanHash({ ...payload, id: "00000000-0000-4000-8000-000000000004" });
    await writeFile(join(root, planId, "render-plan.json"), `${JSON.stringify(moved)}\n`);
    await expect(store.get(planId)).rejects.toThrow(/hash/iu);
  });
});

describe("bounded waveform extraction", () => {
  it("streams audio into a bounded set of normalized peaks", async () => {
    const root = await mkdtemp(join(tmpdir(), "studynarrator-waveform-"));
    const inputPath = join(root, "silence.wav");
    await writeFile(inputPath, createPcmSilence(1_000).bytes!);
    const waveform = await extractWaveformPeaks({ inputPath, maxPeaks: 64 });
    expect(waveform).toMatchObject({ durationMs: 1_000, sampleRate: 8_000 });
    expect(waveform.peaks.length).toBeGreaterThan(0);
    expect(waveform.peaks.length).toBeLessThanOrEqual(64);
    expect(new Set(waveform.peaks)).toEqual(new Set([0]));
  });
});
