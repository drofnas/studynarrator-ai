import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  PROJECT_SNAPSHOT_SCHEMA_VERSION,
  RENDER_PLAN_SCHEMA_VERSION,
} from "@studynarrator/shared-types";
import {
  createPcmSilence,
  createRenderPlanStore,
  createSpeechCache,
  createSpeechCacheKey,
  extractWaveformPeaks,
  normalizeSpeechText,
  SPEECH_CACHE_SCHEMA_VERSION,
  SPEECH_CHUNKING_VERSION,
  SPEECH_NORMALIZATION_VERSION,
  readSpeechCacheMetadata,
  withProjectSnapshotHash,
  withRenderPlanHash,
  type SpeechCacheKeyInput,
} from "./index.js";

const runFile = promisify(execFile);

const input: SpeechCacheKeyInput = {
  adapterId: "speaches-openai",
  adapterVersion: 1,
  serverIdentity: "http://127.0.0.1:8000",
  modelId: "model-a",
  voiceId: "voice-a",
  speed: 1,
  text: "SQL indexes improve reads.",
  responseFormat: "wav",
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
    createId: (() => {
      let id = 0;
      return () => `temporary-${String(id++)}`;
    })(),
  });
  return { cache, rootDirectory };
}

describe("speech cache keys", () => {
  it("normalizes Unicode and line endings deterministically", () => {
    expect(normalizeSpeechText("  cafe\u0301\r\nline  ")).toBe("café\nline");
    expect(
      createSpeechCacheKey({ ...input, text: " cafe\u0301\r\nline " }),
    ).toBe(createSpeechCacheKey({ ...input, text: "café\nline" }));
  });

  it.each([
    "adapterId",
    "adapterVersion",
    "serverIdentity",
    "modelId",
    "voiceId",
    "speed",
    "text",
  ] as const)("changes when %s changes", (field) => {
    const changed =
      field === "adapterVersion"
        ? 2
        : field === "speed"
          ? 1.25
          : `${String(input[field])}-changed`;
    expect(createSpeechCacheKey({ ...input, [field]: changed })).not.toBe(
      createSpeechCacheKey(input),
    );
  });

  it("does not accept unrelated pause, gain, retry, or output settings", () => {
    const withUnrelated = {
      ...input,
      pauseDurationMs: 900,
      gainDb: 4,
      retryCount: 5,
      outputName: "chapter.mp3",
    };
    expect(createSpeechCacheKey(withUnrelated)).toBe(
      createSpeechCacheKey(input),
    );
  });
});

describe("content-addressed speech cache", () => {
  it("writes once, reuses validated audio, and tracks project and Scratchpad use", async () => {
    const { cache, rootDirectory } = await fixture();
    const synthesize = vi.fn(async () => Uint8Array.from([82, 73, 70, 70]));
    const first = await cache.getOrCreate(
      input,
      { scratchpad: true },
      synthesize,
    );
    const second = await cache.getOrCreate(
      input,
      { projectId: "project-a" },
      synthesize,
    );
    expect(first.status).toBe("miss");
    expect(second.status).toBe("hit");
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(second.metadata).toMatchObject({
      projectIds: ["project-a"],
      scratchpadUsed: true,
    });
    const metadata = JSON.parse(
      await readFile(
        join(rootDirectory, second.key.slice(0, 2), `${second.key}.json`),
        "utf8",
      ),
    ) as unknown;
    expect(metadata).not.toHaveProperty("serverIdentity");
    expect(metadata).not.toHaveProperty("normalizedText");
    await expect(cache.status()).resolves.toMatchObject({
      entryCount: 1,
      totalBytes: 4,
      sessionHits: 1,
      sessionMisses: 1,
      sessionWrites: 1,
    });
  });

  it("predicts hits without changing usage metadata or hit counters", async () => {
    const { cache } = await fixture();
    await expect(cache.inspect(input)).resolves.toMatchObject({
      status: "miss",
      key: createSpeechCacheKey(input),
    });
    await cache.getOrCreate(input, { projectId: "project-a" }, async () =>
      Uint8Array.from([82, 73, 70, 70]),
    );
    await expect(cache.inspect(input)).resolves.toMatchObject({
      status: "hit",
    });
    await expect(cache.status()).resolves.toMatchObject({
      sessionHits: 0,
      sessionMisses: 1,
      sessionWrites: 1,
    });
  });

  it("deduplicates concurrent synthesis and isolates a cancelled waiter", async () => {
    const { cache } = await fixture();
    let finish: ((bytes: Uint8Array) => void) | undefined;
    const synthesize = vi.fn(
      async () =>
        await new Promise<Uint8Array>((resolve) => {
          finish = resolve;
        }),
    );
    const cancelled = new AbortController();
    const first = cache.getOrCreate(
      input,
      { projectId: "project-a" },
      synthesize,
      cancelled.signal,
    );
    const second = cache.getOrCreate(
      input,
      { projectId: "project-b", scratchpad: true },
      synthesize,
    );
    while (!finish) await new Promise<void>((resolve) => setImmediate(resolve));
    cancelled.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    finish?.(Uint8Array.from([82, 73, 70, 70]));
    await expect(second).resolves.toMatchObject({
      status: "miss",
      metadata: {
        projectIds: ["project-a", "project-b"],
        scratchpadUsed: true,
      },
    });
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("rejects corrupt and partial entries before synthesizing a replacement", async () => {
    const { cache, rootDirectory } = await fixture();
    const first = await cache.getOrCreate(
      input,
      { projectId: "project-a" },
      async () => Uint8Array.from([82, 73, 70, 70]),
    );
    const audioPath = join(
      rootDirectory,
      first.key.slice(0, 2),
      `${first.key}.wav`,
    );
    await writeFile(audioPath, Uint8Array.from([0, 1, 2]));
    const synthesize = vi.fn(async () => Uint8Array.from([82, 1, 2, 3]));
    await expect(
      cache.getOrCreate(input, { projectId: "project-a" }, synthesize),
    ).resolves.toMatchObject({ status: "miss" });
    expect(synthesize).toHaveBeenCalledTimes(1);
    await expect(cache.status()).resolves.toMatchObject({
      sessionCorruptMisses: 1,
    });
  });

  it("accepts legacy metadata with retired extra fields and strips them", async () => {
    const { cache, rootDirectory } = await fixture();
    const first = await cache.getOrCreate(input, {}, async () =>
      Uint8Array.from([82, 73, 70, 70]),
    );
    const metadataPath = join(
      rootDirectory,
      first.key.slice(0, 2),
      `${first.key}.json`,
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      metadataPath,
      `${JSON.stringify({ ...metadata, profileId: "removed-profile" })}\n`,
    );

    // Unknown extra fields no longer invalidate an entry; they are
    // stripped on the read and the rewrite heals the on-disk shape.
    const synthesize = vi.fn(async () => Uint8Array.from([82, 1, 2, 3]));
    await expect(
      cache.getOrCreate(input, {}, synthesize),
    ).resolves.toMatchObject({ status: "hit" });
    expect(synthesize).not.toHaveBeenCalled();
    expect(
      JSON.parse(await readFile(metadataPath, "utf8")) as Record<
        string,
        unknown
      >,
    ).not.toHaveProperty("profileId");
  });

  describe("metadata read results", () => {
    it("distinguishes an unreadable metadata file from a missing one", async () => {
      const { rootDirectory } = await fixture();
      const key = createSpeechCacheKey(input);
      const shardDirectory = join(rootDirectory, key.slice(0, 2));
      await mkdir(shardDirectory, { recursive: true, mode: 0o700 });
      const corruptPath = join(shardDirectory, `${key}.json`);
      await writeFile(corruptPath, "{ not valid metadata json");

      expect(await readSpeechCacheMetadata(corruptPath)).toEqual({
        status: "unreadable",
        path: corruptPath,
      });
      expect(
        await readSpeechCacheMetadata(join(shardDirectory, "absent.json")),
      ).toEqual({ status: "missing" });
    });

    it("accepts a future optional field without invalidating the entry", async () => {
      const { rootDirectory } = await fixture();
      const key = createSpeechCacheKey(input);
      const shardDirectory = join(rootDirectory, key.slice(0, 2));
      await mkdir(shardDirectory, { recursive: true, mode: 0o700 });
      const metadataPath = join(shardDirectory, `${key}.json`);
      const schemaVersion = SPEECH_CACHE_SCHEMA_VERSION;
      const normalizationVersion = SPEECH_NORMALIZATION_VERSION;
      const chunkingVersion = SPEECH_CHUNKING_VERSION;
      const identity = "a".repeat(64);
      const base = {
        schemaVersion,
        normalizationVersion,
        chunkingVersion,
        adapterId: "speaches-openai",
        adapterVersion: 1,
        serverIdentityHash: identity,
        modelId: "model-a",
        voiceId: "voice-a",
        speed: 1,
        textHash: identity,
        responseFormat: "wav",
        key,
        audioChecksum: identity,
        byteLength: 4,
        createdAt: "2026-08-13T12:00:00.000Z",
        lastUsedAt: "2026-08-13T12:00:01.000Z",
        projectIds: [],
        scratchpadUsed: false,
      };
      await writeFile(
        metadataPath,
        `${JSON.stringify({ ...base, futureOptionalField: 42 })}\n`,
      );

      const result = await readSpeechCacheMetadata(metadataPath);
      expect(result).toMatchObject({ status: "ok" });
      if (result.status !== "ok") throw new Error("expected ok metadata");
      expect(result.metadata).toEqual(base);
      expect(result.metadata).not.toHaveProperty("futureOptionalField");
    });

    it("reports structurally invalid metadata as unreadable", async () => {
      const { rootDirectory } = await fixture();
      const key = createSpeechCacheKey(input);
      const shardDirectory = join(rootDirectory, key.slice(0, 2));
      await mkdir(shardDirectory, { recursive: true, mode: 0o700 });
      const metadataPath = join(shardDirectory, `${key}.json`);
      const base = {
        responseFormat: "wav",
        key,
        byteLength: 0,
      };
      await writeFile(metadataPath, `${JSON.stringify(base)}\n`);

      expect(await readSpeechCacheMetadata(metadataPath)).toMatchObject({
        status: "unreadable",
        path: metadataPath,
      });
    });
  });

  it("clears a selected key, project-associated keys, and all remaining entries", async () => {
    const { cache } = await fixture();
    const one = await cache.getOrCreate(
      input,
      { projectId: "project-a" },
      async () => Uint8Array.from([82, 1]),
    );
    const two = await cache.getOrCreate(
      { ...input, text: "second" },
      { projectId: "project-a" },
      async () => Uint8Array.from([82, 2, 3]),
    );
    await cache.getOrCreate(
      { ...input, text: "third" },
      { projectId: "project-b" },
      async () => Uint8Array.from([82, 3, 4, 5]),
    );
    await expect(cache.clearEntry(one.key)).resolves.toEqual({
      entriesRemoved: 1,
      bytesFreed: 2,
    });
    await expect(cache.clearProject("project-a")).resolves.toEqual({
      entriesRemoved: 1,
      bytesFreed: 3,
    });
    expect(two.key).not.toBe(one.key);
    await expect(cache.clearAll()).resolves.toEqual({
      entriesRemoved: 1,
      bytesFreed: 4,
    });
    await expect(cache.status()).resolves.toMatchObject({
      entryCount: 0,
      totalBytes: 0,
    });
  });

  it("retains one Scratchpad entry without deleting audio shared with projects", async () => {
    const { cache, rootDirectory } = await fixture();
    const oldScratchpad = await cache.getOrCreate(
      input,
      { scratchpad: true },
      async () => Uint8Array.from([82, 1]),
    );
    const sharedInput = { ...input, text: "shared" };
    const shared = await cache.getOrCreate(
      sharedInput,
      { scratchpad: true },
      async () => Uint8Array.from([82, 2, 3]),
    );
    await cache.getOrCreate(sharedInput, { projectId: "project-a" }, async () =>
      Uint8Array.from([82, 2, 3]),
    );
    const newest = await cache.getOrCreate(
      { ...input, text: "newest" },
      { scratchpad: true },
      async () => Uint8Array.from([82, 3, 4, 5]),
    );

    await expect(cache.retainScratchpad(newest.key)).resolves.toEqual({
      entriesRemoved: 1,
      bytesFreed: 2,
    });
    await expect(cache.inspect(input)).resolves.toMatchObject({
      status: "miss",
      key: oldScratchpad.key,
    });
    await expect(cache.inspect(sharedInput)).resolves.toMatchObject({
      status: "hit",
      key: shared.key,
    });
    await expect(cache.status()).resolves.toMatchObject({
      entryCount: 2,
      totalBytes: 7,
    });
    const sharedMetadata = JSON.parse(
      await readFile(
        join(rootDirectory, shared.key.slice(0, 2), `${shared.key}.json`),
        "utf8",
      ),
    ) as { projectIds: string[]; scratchpadUsed: boolean };
    expect(sharedMetadata).toMatchObject({
      projectIds: ["project-a"],
      scratchpadUsed: false,
    });
  });

  it("releases one project owner, preserves shared audio, and defers in-flight deletion", async () => {
    const { cache } = await fixture();
    const shared = await cache.getOrCreate(
      input,
      { projectId: "project-a" },
      async () => Uint8Array.from([82, 1]),
    );
    await cache.getOrCreate(input, { projectId: "project-b" }, async () =>
      Uint8Array.from([82, 1]),
    );
    await expect(
      cache.releaseProjectEntry!("project-a", shared.key),
    ).resolves.toMatchObject({ deferred: false, entriesRemoved: 0 });
    await expect(cache.inspect(input)).resolves.toMatchObject({
      status: "hit",
    });
    await expect(
      cache.releaseProjectEntry!("project-b", shared.key),
    ).resolves.toMatchObject({ deferred: false, entriesRemoved: 1 });
    await expect(cache.inspect(input)).resolves.toMatchObject({
      status: "miss",
    });

    const cleanupInput = { ...input, text: "cleanup serialization" };
    const cleanupEntry = await cache.getOrCreate(
      cleanupInput,
      { projectId: "project-a" },
      async () => Uint8Array.from([82, 3]),
    );
    const cleanup = cache.releaseProjectEntry!("project-a", cleanupEntry.key);
    const inspection = cache.inspect(cleanupInput);
    await expect(cleanup).resolves.toMatchObject({
      deferred: false,
      entriesRemoved: 1,
    });
    await expect(inspection).resolves.toMatchObject({ status: "miss" });

    let finish: ((bytes: Uint8Array) => void) | undefined;
    const pendingInput = { ...input, text: "still synthesizing" };
    const pending = cache.getOrCreate(
      pendingInput,
      { projectId: "project-a" },
      async () =>
        await new Promise<Uint8Array>((resolve) => {
          finish = resolve;
        }),
    );
    while (!finish) await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(
      cache.releaseProjectEntry!(
        "project-a",
        createSpeechCacheKey(pendingInput),
      ),
    ).resolves.toMatchObject({ deferred: true, entriesRemoved: 0 });
    finish(Uint8Array.from([82, 2]));
    await pending;
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
    await expect(
      cache.getOrCreate(input, {}, synthesize),
    ).resolves.toMatchObject({ status: "miss" });
    expect(synthesize).toHaveBeenCalledOnce();
    expect(await readFile(target)).toEqual(Buffer.from([82]));
  });
});

describe("render plan silence and storage", () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const planId = "00000000-0000-4000-8000-000000000002";
  const timestamp = "2026-08-13T12:00:00.000Z";

  function bundle(durationMs = 750, id = planId, createdAt = timestamp) {
    const silence = createPcmSilence(durationMs);
    const snapshot = withProjectSnapshotHash({
      schemaVersion: PROJECT_SNAPSHOT_SCHEMA_VERSION,
      capturedAt: createdAt,
      project: {
        contractVersion: 1,
        id: projectId,
        name: "Frozen plan",
        description: "",
        scriptSource: "[pause_medium]",
        scriptHash: "a".repeat(64),
        speakerMappings: [],
        lexiconEntries: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      timing: {
        pausePresets: [
          { pauseId: "pause_short", durationMs: 350, description: "Short" },
          { pauseId: "pause_medium", durationMs, description: "Paragraph" },
          { pauseId: "pause_long", durationMs: 1_500, description: "Long" },
        ],
        transitionPauses: {
          paragraph: { mode: "preset", pauseId: "pause_medium" },
          speakerChange: { mode: "none" },
          section: { mode: "none" },
        },
      },
      globalLexiconEntries: [],
      ignoredDiagnostics: [],
      connection: { modelId: "model", serverIdentityHash: "b".repeat(64) },
      versions: {
        scriptGrammar: 1,
        cirSchema: 1,
        lexiconTransform: 1,
        pacing: 1,
        speechCacheSchema: 1,
        speechNormalization: 1,
        speechChunking: 1,
        speechAdapter: 1,
      },
    });
    const plan = withRenderPlanHash({
      schemaVersion: RENDER_PLAN_SCHEMA_VERSION,
      id,
      projectId,
      createdAt,
      snapshotHash: snapshot.snapshotHash,
      scriptHash: "a".repeat(64),
      entries: [
        {
          type: "pause",
          ordinal: 1,
          sectionTitle: null,
          sourceRange: null,
          pauseKind: "automatic",
          reason: "paragraph",
          pauseId: "pause_medium",
          durationMs,
          silence: silence.asset,
        },
      ],
      summary: {
        sectionCount: 0,
        speechCount: 0,
        pauseCount: 1,
        cacheHits: 0,
        cacheMisses: 0,
        silenceDurationMs: durationMs,
      },
    });
    return { silence, snapshot, plan };
  }

  it.each([350, 750, 1_500])(
    "creates exact %d ms PCM silence",
    (durationMs) => {
      const { bytes, asset } = createPcmSilence(durationMs);
      expect(asset).toMatchObject({
        sampleRate: 24_000,
        channels: 1,
        bitsPerSample: 16,
        frameCount: durationMs * 24,
      });
      expect(bytes?.byteLength).toBe(44 + durationMs * 24 * 2);
      expect(new TextDecoder().decode(bytes?.slice(0, 4))).toBe("RIFF");
    },
  );

  it("represents zero duration without an invalid WAV", () => {
    expect(createPcmSilence(0)).toEqual({ bytes: null, asset: null });
  });

  it("freezes and reopens an immutable render job bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "studynarrator-render-plan-"));
    const store = createRenderPlanStore(root);
    const renderId = "00000000-0000-4000-8000-000000000005";
    const { silence, snapshot, plan } = bundle();
    await store.snapshotJob(
      renderId,
      snapshot,
      plan,
      new Map([[silence.asset!.checksum, silence.bytes!]]),
    );
    const loaded = await store.loadJob(renderId);
    expect(loaded.plan).toEqual(plan);
    expect(loaded.snapshot).toEqual(snapshot);
    expect(loaded.silenceAssets.get(silence.asset!.checksum)).toEqual(
      silence.bytes,
    );
    const silencePath = join(
      root,
      ".jobs",
      renderId,
      silence.asset!.relativePath,
    );
    const probe = await runFile("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      silencePath,
    ]);
    expect(Number(probe.stdout.trim())).toBeCloseTo(0.75, 3);
  });

  it("rejects a job snapshot with missing silence or inconsistent hashes", async () => {
    const root = await mkdtemp(join(tmpdir(), "studynarrator-render-plan-"));
    const store = createRenderPlanStore(root);
    const renderId = "00000000-0000-4000-8000-000000000006";
    const { silence, snapshot, plan } = bundle();
    await expect(
      store.snapshotJob(renderId, snapshot, plan, new Map()),
    ).rejects.toThrow(/silence/iu);
    const tampered = { ...snapshot, capturedAt: "1999-01-01T00:00:00.000Z" };
    await expect(
      store.snapshotJob(
        renderId,
        tampered,
        plan,
        new Map([[silence.asset!.checksum, silence.bytes!]]),
      ),
    ).rejects.toThrow(/hash/iu);
    await expect(store.loadJob("not-a-render-id")).rejects.toThrow();
  });

  it("keeps job snapshots immutable and distinct across retries, including silence byte identity", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "studynarrator-render-job-snapshot-"),
    );
    const store = createRenderPlanStore(root);
    const first = bundle(350);
    const firstRenderId = "00000000-0000-4000-8000-000000000010";
    await store.snapshotJob(
      firstRenderId,
      first.snapshot,
      first.plan,
      new Map([[first.silence.asset!.checksum, first.silence.bytes!]]),
    );

    const second = bundle(1_500);
    const secondRenderId = "00000000-0000-4000-8000-000000000011";
    await store.snapshotJob(
      secondRenderId,
      second.snapshot,
      second.plan,
      new Map([[second.silence.asset!.checksum, second.silence.bytes!]]),
    );
    const retryRenderId = "00000000-0000-4000-8000-000000000012";
    await store.cloneJobSnapshot(retryRenderId, firstRenderId);
    await expect(store.loadJob(firstRenderId)).resolves.toMatchObject({
      plan: { entries: [{ durationMs: 350 }] },
    });
    await expect(store.loadJob(secondRenderId)).resolves.toMatchObject({
      plan: { entries: [{ durationMs: 1_500 }] },
    });
    const retry = await store.loadJob(retryRenderId);
    expect(retry.plan).toMatchObject({ entries: [{ durationMs: 350 }] });
    expect(retry.silenceAssets.get(first.silence.asset!.checksum)).toEqual(
      first.silence.bytes,
    );
  });

  it("rejects corrupt job bundles, traversal-shaped paths, and symlinked snapshot directories", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "studynarrator-render-plan-safety-"),
    );
    const store = createRenderPlanStore(root);
    const renderId = "00000000-0000-4000-8000-000000000007";
    const { silence, snapshot, plan } = bundle();
    await store.snapshotJob(
      renderId,
      snapshot,
      plan,
      new Map([[silence.asset!.checksum, silence.bytes!]]),
    );
    const silencePath = join(
      root,
      ".jobs",
      renderId,
      silence.asset!.relativePath,
    );
    await writeFile(silencePath, Uint8Array.from([1, 2, 3]));
    await expect(store.loadJob(renderId)).rejects.toThrow(/size|checksum/iu);
    await expect(store.loadJob("../outside")).rejects.toThrow();
    const symlinkRenderId = "00000000-0000-4000-8000-000000000003";
    await symlink(
      join(root, ".jobs", renderId),
      join(root, ".jobs", symlinkRenderId),
    );
    await expect(store.loadJob(symlinkRenderId)).rejects.toThrow(/unsafe/iu);
  });

  it("rejects a job manifest whose hash is mutated after the atomic write", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "studynarrator-render-plan-manifest-"),
    );
    const store = createRenderPlanStore(root);
    const renderId = "00000000-0000-4000-8000-000000000008";
    const { silence, snapshot, plan } = bundle();
    await store.snapshotJob(
      renderId,
      snapshot,
      plan,
      new Map([[silence.asset!.checksum, silence.bytes!]]),
    );
    await writeFile(
      join(root, ".jobs", renderId, "render-plan.json"),
      `${JSON.stringify({ ...plan, planHash: "0".repeat(64) })}\n`,
    );
    await expect(store.loadJob(renderId)).rejects.toThrow(/hash/iu);
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
