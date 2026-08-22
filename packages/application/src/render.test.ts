import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import type {
  SpeechBackendConnection,
  ProjectDetail,
  RenderArtifact,
  RenderJob,
  RenderSegment,
  VoiceTimingCalibration,
} from "@studynarrator/shared-types";
import {
  createPcmSilence,
  createSpeechCacheActivityGate,
  probeAudioFile,
  withProjectSnapshotHash,
  withRenderPlanHash,
  type RenderPlanStore,
  type SpeechCacheActivityGate,
} from "@studynarrator/rendering";
import type { CachedSpeechSynthesis } from "./cachedSpeech.js";
import { createRenderService, type RenderRepository } from "./render.js";
import type { ComputedRenderPlan } from "./renderPlan.js";
import { APPLICATION_SERVICE_MANIFEST } from "./serviceManifest.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function sha(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

class MemoryRepository implements RenderRepository {
  jobs = new Map<string, RenderJob>();
  artifacts = new Map<string, RenderArtifact & { path: string }>();
  segments = new Map<string, RenderSegment>();
  segmentPaths = new Map<string, string | null>();
  calibrations = new Map<string, VoiceTimingCalibration>();
  calibrationReads: Array<{ modelId: string; voiceId: string }> = [];
  calibrationUpserts: VoiceTimingCalibration[] = [];
  calibrationReadFailure: Error | null = null;
  calibrationUpsertFailure: Error | null = null;
  persistedSpeechAudioDurationMs: number | null | undefined;
  constructor(
    readonly connection: SpeechBackendConnection,
    readonly project: ProjectDetail,
  ) {}
  getSpeechBackendConnection() {
    return this.connection;
  }
  getProject(id: string) {
    if (id !== this.project.id) throw new Error("missing");
    return this.project;
  }
  createRenderJob(job: RenderJob, segments: RenderSegment[]) {
    this.jobs.set(job.id, job);
    segments.forEach((item) =>
      this.segments.set(`${item.renderId}:${String(item.ordinal)}`, item),
    );
    return job;
  }
  getRenderJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("missing");
    return job;
  }
  listRenderJobs(projectId: string) {
    return [...this.jobs.values()].filter((job) => job.projectId === projectId);
  }
  listRecoverableRenderJobs() {
    return [...this.jobs.values()].filter(
      (job) => !["complete", "failed", "canceled"].includes(job.state),
    );
  }
  updateRenderJob(job: RenderJob) {
    this.jobs.set(job.id, job);
    return job;
  }
  updateRenderSegment(item: RenderSegment, path: string | null = null) {
    const key = `${item.renderId}:${String(item.ordinal)}`;
    const persisted =
      item.type === "speech" &&
      item.state === "complete" &&
      this.persistedSpeechAudioDurationMs !== undefined
        ? {
            ...item,
            audioDurationMs: this.persistedSpeechAudioDurationMs,
          }
        : item;
    this.segments.set(key, persisted);
    this.segmentPaths.set(key, path);
    return persisted;
  }
  listRenderSegments(renderId: string) {
    return [...this.segments.values()]
      .filter((item) => item.renderId === renderId)
      .sort((left, right) => left.ordinal - right.ordinal);
  }
  getRenderSegmentPath(renderId: string, ordinal: number) {
    const key = `${renderId}:${String(ordinal)}`;
    const item = this.segments.get(key);
    if (!item) throw new Error("missing");
    return { segment: item, path: this.segmentPaths.get(key) ?? null };
  }
  replaceRenderArtifacts(
    renderId: string,
    values: Array<RenderArtifact & { path: string }>,
  ) {
    values.forEach((item) => this.artifacts.set(item.id, item));
    return values
      .filter((item) => item.renderId === renderId)
      .map(({ path: _path, ...item }) => item);
  }
  listRenderArtifacts(renderId: string) {
    return [...this.artifacts.values()]
      .filter((item) => item.renderId === renderId)
      .map(({ path: _path, ...item }) => item);
  }
  getRenderArtifactPath(id: string) {
    const item = this.artifacts.get(id);
    if (!item) throw new Error("missing");
    const { path, ...artifact } = item;
    return { artifact, path };
  }
  getVoiceTimingCalibration(modelId: string, voiceId: string) {
    this.calibrationReads.push({ modelId, voiceId });
    if (this.calibrationReadFailure) throw this.calibrationReadFailure;
    return this.calibrations.get(`${modelId}:${voiceId}`) ?? null;
  }
  upsertVoiceTimingCalibration(calibration: VoiceTimingCalibration) {
    this.calibrationUpserts.push(calibration);
    if (this.calibrationUpsertFailure) throw this.calibrationUpsertFailure;
    this.calibrations.set(
      `${calibration.modelId}:${calibration.voiceId}`,
      calibration,
    );
    return calibration;
  }
}

async function fixture(
  options: {
    synthesisFailure?: Error;
    synthesisGate?: Promise<void>;
    speechEntryCount?: number;
    speed?: number;
    readableText?: string;
    normalizedText?: string;
    statfs?: (path: string) => Promise<{ bavail: bigint; bsize: bigint }>;
    activityGate?: SpeechCacheActivityGate;
  } = {},
) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "studynarrator-render-"));
  roots.push(dataDirectory);
  const projectId = "00000000-0000-4000-8000-000000000001";
  const planId = "00000000-0000-4000-8000-000000000002";
  const baseUrl = "http://127.0.0.1:8765";
  const timestamp = "2026-08-13T12:00:00.000Z";
  const project = {
    contractVersion: 1 as const,
    id: projectId,
    name: "Render fixture",
    description: "",
    scriptSource: "narrator: Render me.",
    scriptHash: sha("narrator: Render me."),
    speakerMappings: [
      {
        speakerId: "narrator",
        displayName: "Narrator",
        voiceId: "voice",
        speed: options.speed ?? 1,
        gainDb: 0,
        roleDescription: "",
        sampleText: "",
      },
    ],
    lexiconEntries: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const snapshot = withProjectSnapshotHash({
    schemaVersion: 1,
    capturedAt: timestamp,
    project,
    timing: {
      pausePresets: [
        { pauseId: "pause_short", durationMs: 350, description: "Short" },
        { pauseId: "pause_medium", durationMs: 750, description: "Medium" },
        { pauseId: "pause_long", durationMs: 1_500, description: "Long" },
      ],
      transitionPauses: {
        paragraph: { mode: "none" },
        speakerChange: { mode: "none" },
        section: { mode: "none" },
      },
    },
    globalLexiconEntries: [],
    ignoredDiagnostics: [],
    connection: { modelId: "model", serverIdentityHash: sha(baseUrl) },
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
  const cacheKey = "a".repeat(64);
  const speechEntryCount = options.speechEntryCount ?? 1;
  const speed = options.speed ?? 1;
  const readableText = options.readableText ?? "Render me.";
  const normalizedText = options.normalizedText ?? "Render me.";
  const plan = withRenderPlanHash({
    schemaVersion: 1,
    id: planId,
    projectId,
    createdAt: timestamp,
    snapshotHash: snapshot.snapshotHash,
    scriptHash: project.scriptHash,
    entries: Array.from({ length: speechEntryCount }, (_, index) => ({
      type: "speech" as const,
      ordinal: index + 1,
      nodeOrdinal: index + 1,
      sectionTitle: null,
      sourceRange: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 21 },
      },
      speakerId: "narrator",
      voiceId: "voice",
      speed,
      gainDb: 0,
      originalText: readableText,
      readableText,
      ttsText: normalizedText,
      chunks: [
        {
          ordinal: 1,
          text: normalizedText,
          cacheKey,
          cacheStatus: "miss" as const,
        },
      ],
    })),
    summary: {
      sectionCount: 0,
      speechCount: speechEntryCount,
      pauseCount: 0,
      cacheHits: 0,
      cacheMisses: speechEntryCount,
      silenceDurationMs: 0,
    },
  });
  const snapshotJob = vi.fn(async (renderId: string) => {
    if (!/^[0-9a-f-]{36}$/u.test(renderId))
      throw new Error("Invalid render id in test fixture.");
  });
  const plans: RenderPlanStore = {
    snapshotJob,
    async cloneJobSnapshot(renderId) {
      if (!/^[0-9a-f-]{36}$/u.test(renderId))
        throw new Error("Invalid render id in test fixture.");
    },
    async loadJob() {
      return { snapshot, plan, silenceAssets: new Map() };
    },
  };
  const repository = new MemoryRepository(
    {
      backendId: "speaches",
      baseUrl,
      suppliedUrlForm: "root",
      configured: true,
      defaultModelId: "model",
      defaultVoiceId: "voice",
      timeoutSeconds: 120,
      retryCount: 0,
      responseFormat: "wav",
      lastTestedAt: null,
      lastSuccessfulTestAt: null,
      lastTestSummary: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    project,
  );
  const wav = createPcmSilence(1_000).bytes!;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let nextId = 10;
  const computed: ComputedRenderPlan = {
    snapshot,
    plan,
    silenceAssets: new Map(),
  };
  const computePlan = vi.fn(async () => computed);
  const synthesize = vi.fn<CachedSpeechSynthesis["synthesize"]>(async () => {
    if (options.synthesisGate) await options.synthesisGate;
    if (options.synthesisFailure) throw options.synthesisFailure;
    return {
      key: cacheKey,
      status: "miss",
      bytes: wav,
      metadata: {
        schemaVersion: 1,
        normalizationVersion: 1,
        chunkingVersion: 1,
        adapterId: "test",
        adapterVersion: 1,
        serverIdentityHash: sha(baseUrl),
        modelId: "model",
        voiceId: "voice",
        speed,
        textHash: sha(normalizedText),
        responseFormat: "wav",
        key: cacheKey,
        audioChecksum: sha(wav),
        byteLength: wav.byteLength,
        createdAt: timestamp,
        lastUsedAt: timestamp,
        projectIds: [projectId],
        scratchpadUsed: false,
      },
    };
  });
  const service = await createRenderService({
    repository,
    plans,
    dataDirectory,
    planComputer: { compute: computePlan },
    speech: { synthesize },
    createId: () =>
      `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    now: () => new Date(timestamp),
    logger,
    ...(options.activityGate ? { activityGate: options.activityGate } : {}),
    ...(options.statfs ? { statfs: options.statfs } : {}),
  });
  return {
    service,
    repository,
    plan,
    projectId,
    dataDirectory,
    logger,
    computePlan,
    snapshotJob,
    synthesize,
  };
}

async function terminal(
  service: Awaited<ReturnType<typeof createRenderService>>,
  renderId: string,
): Promise<RenderJob> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = await service.get(renderId);
    if (["complete", "failed", "canceled"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("render did not finish");
}

describe("render coordinator", () => {
  it("declares the progress observer and estimate context in the application-service manifest", () => {
    expect(APPLICATION_SERVICE_MANIFEST).toContain("renders.subscribe");
    expect(APPLICATION_SERVICE_MANIFEST).toContain(
      "renders.getEstimateContext",
    );
  });

  it("waits for exclusive cache maintenance before starting a render", async () => {
    const activityGate = createSpeechCacheActivityGate();
    const maintenance = activityGate.beginMaintenance();
    expect(maintenance).not.toBeNull();
    const { service, projectId, computePlan } = await fixture({ activityGate });
    const pending = service.startProject(projectId, {
      diskSpaceCheckEnabled: false,
    });

    await Promise.resolve();
    expect(computePlan).not.toHaveBeenCalled();
    maintenance?.release();
    const job = await pending;
    expect(computePlan).toHaveBeenCalledWith(projectId);
    await service.cancel(job.id);
    await service.close();
  });

  it("reads free bytes from the exact data volume and returns only requested calibrations", async () => {
    const readStats = vi.fn(async () => ({ bavail: 1_234n, bsize: 4_096n }));
    const { service, repository, dataDirectory } = await fixture({
      statfs: readStats,
    });
    const calibration: VoiceTimingCalibration = {
      modelId: "model",
      voiceId: "voice",
      millisecondsPerNormalizedCharacter: 72,
      sampleCount: 3,
      updatedAt: "2026-08-13T12:00:00.000Z",
    };
    repository.calibrations.set("model:voice", calibration);
    repository.calibrations.set("model:other", {
      ...calibration,
      voiceId: "other",
    });

    await expect(
      service.getEstimateContext({
        modelId: "model",
        voiceIds: ["voice", "missing"],
      }),
    ).resolves.toEqual({
      freeSpaceBytes: 1_234 * 4_096,
      calibrations: [calibration],
    });
    expect(readStats).toHaveBeenCalledWith(dataDirectory);
    expect(repository.calibrationReads).toEqual([
      { modelId: "model", voiceId: "voice" },
      { modelId: "model", voiceId: "missing" },
    ]);
    expect(repository.calibrationUpserts).toEqual([]);
    expect(repository.jobs.size).toBe(0);
  });

  it("skips calibration reads without a model and safely bounds huge volumes", async () => {
    const { service, repository } = await fixture({
      statfs: async () => ({
        bavail: BigInt(Number.MAX_SAFE_INTEGER),
        bsize: 4_096n,
      }),
    });

    await expect(
      service.getEstimateContext({ modelId: null, voiceIds: ["voice"] }),
    ).resolves.toEqual({
      freeSpaceBytes: Number.MAX_SAFE_INTEGER,
      calibrations: [],
    });
    expect(repository.calibrationReads).toEqual([]);
  });

  it("blocks before creating render work when the default peak estimate exceeds the exact hard reserve", async () => {
    const readStats = vi.fn(async () => ({ bavail: 100_000n, bsize: 1n }));
    const {
      service,
      repository,
      projectId,
      dataDirectory,
      computePlan,
      snapshotJob,
      synthesize,
      logger,
    } = await fixture({ statfs: readStats });

    await expect(service.startProject(projectId)).rejects.toMatchObject({
      name: "RenderDiskSpaceError",
      code: "RENDER_DISK_SPACE_INSUFFICIENT",
      estimatedPeakBytes: 96_000,
      freeSpaceBytes: 100_000n,
      usableBytes: 90_000n,
      message:
        "Render blocked: estimated peak disk use is 96000 bytes, but the data volume has 100000 free bytes and 90000 usable bytes after the required 10% reserve.",
    });
    expect(computePlan).toHaveBeenCalledWith(projectId);
    expect(readStats).toHaveBeenCalledWith(dataDirectory);
    expect(repository.jobs.size).toBe(0);
    expect(repository.segments.size).toBe(0);
    expect(snapshotJob).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    await service.close();
  });

  it("allows the same insufficient render when the check is disabled", async () => {
    const readStats = vi.fn(async () => ({ bavail: 100_000n, bsize: 1n }));
    const { service, projectId, synthesize, logger } = await fixture({
      statfs: readStats,
    });

    const completed = await terminal(
      service,
      (
        await service.startProject(projectId, {
          diskSpaceCheckEnabled: false,
        })
      ).id,
    );

    expect(completed.state).toBe("complete");
    expect(readStats).not.toHaveBeenCalled();
    expect(synthesize).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
    await service.close();
  });

  it("warns with byte-only metadata inside the soft reserve and continues", async () => {
    const { service, projectId, logger } = await fixture({
      statfs: async () => ({ bavail: 120_000n, bsize: 1n }),
    });

    const completed = await terminal(
      service,
      (await service.startProject(projectId)).id,
    );

    expect(completed.state).toBe("complete");
    expect(logger.warn).toHaveBeenCalledWith(
      {
        event: "render-disk-space-warning",
        projectId,
        estimatedPeakBytes: "96000",
        freeSpaceBytes: "120000",
        usableBytes: "90000",
        reservePercent: 25,
      },
      "Render is approaching available disk space",
    );
    await service.close();
  });

  it("allows the exact hard boundary and uses persisted calibration in the peak math", async () => {
    const { service, repository, projectId, logger } = await fixture({
      statfs: async () => ({ bavail: 53_334n, bsize: 1n }),
    });
    repository.calibrations.set("model:voice", {
      modelId: "model",
      voiceId: "voice",
      millisecondsPerNormalizedCharacter: 40,
      sampleCount: 3,
      updatedAt: "2026-08-13T12:00:00.000Z",
    });

    const completed = await terminal(
      service,
      (await service.startProject(projectId)).id,
    );

    expect(completed.state).toBe("complete");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "render-disk-space-warning",
        estimatedPeakBytes: "48000",
        freeSpaceBytes: "53334",
        usableBytes: "40000",
      }),
      "Render is approaching available disk space",
    );
    expect(repository.calibrationReads).toEqual([
      { modelId: "model", voiceId: "voice" },
      { modelId: "model", voiceId: "voice" },
    ]);
    await service.close();
  });

  it("allows the exact default hard boundary because refusal is strictly greater-than", async () => {
    const { service, projectId, logger } = await fixture({
      statfs: async () => ({ bavail: 106_667n, bsize: 1n }),
    });

    const completed = await terminal(
      service,
      (await service.startProject(projectId)).id,
    );

    expect(completed.state).toBe("complete");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedPeakBytes: "96000",
        freeSpaceBytes: "106667",
      }),
      "Render is approaching available disk space",
    );
    await service.close();
  });

  it("notifies observers for progress updates and the terminal state exactly once", async () => {
    const { service, projectId } = await fixture();
    const started = await service.startProject(projectId);
    const observed: RenderJob[] = [];
    service.subscribe(started.id, (job) => observed.push(job));

    const completed = await terminal(service, started.id);

    expect(completed.state).toBe("complete");
    expect(observed.map(({ state }) => state)).toEqual([
      "validating",
      "synthesizing",
      "synthesizing",
      "assembling",
      "encoding",
      "writing_artifacts",
      "complete",
    ]);
    expect(
      observed.filter(({ state }) =>
        ["complete", "failed", "canceled"].includes(state),
      ),
    ).toEqual([completed]);
    await service.close();
  });

  it("stops delivery after an idempotent unsubscribe", async () => {
    const { service, projectId } = await fixture();
    const started = await service.startProject(projectId);
    let unsubscribe: () => void = () => undefined;
    const observer = vi.fn(() => unsubscribe());
    unsubscribe = service.subscribe(started.id, observer);

    await terminal(service, started.id);
    unsubscribe();
    unsubscribe();

    expect(observer).toHaveBeenCalledOnce();
    await service.close();
  });

  it("isolates throwing observers from the render and other observers", async () => {
    const { service, projectId } = await fixture();
    const started = await service.startProject(projectId);
    const throwingObserver = vi.fn(() => {
      throw new Error("observer failure");
    });
    const observed: RenderJob[] = [];
    service.subscribe(started.id, throwingObserver);
    service.subscribe(started.id, (job) => observed.push(job));

    const completed = await terminal(service, started.id);

    expect(completed.state).toBe("complete");
    expect(throwingObserver).toHaveBeenCalledTimes(observed.length);
    expect(observed.filter(({ state }) => state === "complete")).toHaveLength(
      1,
    );
    await service.close();
  });

  it("records persisted, speed-normalized segment timing and rolls it into one calibration per voice", async () => {
    const { service, repository, plan, projectId } = await fixture({
      speechEntryCount: 2,
      speed: 1.5,
      readableText: "Readable text that is deliberately not normalized.",
      normalizedText: "Normalize.",
    });
    const firstEntry = plan.entries[0];
    if (firstEntry?.type !== "speech")
      throw new Error("Expected a speech fixture entry.");
    const [frozenChunk] = firstEntry.chunks;
    if (!frozenChunk) throw new Error("Expected a frozen speech chunk.");
    const normalizedCharacters = frozenChunk.text.length;
    expect(normalizedCharacters).toBe(10);
    expect(firstEntry.readableText.length).not.toBe(normalizedCharacters);
    expect(repository.project.scriptSource.length).not.toBe(
      normalizedCharacters,
    );
    repository.persistedSpeechAudioDurationMs = 1_200;

    const first = await terminal(
      service,
      (await service.startProject(projectId)).id,
    );

    expect(first.state).toBe("complete");
    expect(repository.listRenderSegments(first.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ audioDurationMs: 1_200 }),
      ]),
    );
    expect(repository.calibrationUpserts).toEqual([
      {
        modelId: "model",
        voiceId: "voice",
        millisecondsPerNormalizedCharacter: 180,
        sampleCount: 2,
        updatedAt: "2026-08-13T12:00:00.000Z",
      },
    ]);

    repository.persistedSpeechAudioDurationMs = 800;
    const second = await terminal(
      service,
      (await service.startProject(projectId)).id,
    );

    expect(second.state).toBe("complete");
    expect(repository.calibrationReads).toEqual([
      { modelId: "model", voiceId: "voice" },
      { modelId: "model", voiceId: "voice" },
      { modelId: "model", voiceId: "voice" },
      { modelId: "model", voiceId: "voice" },
    ]);
    expect(repository.calibrationUpserts).toHaveLength(2);
    expect(repository.calibrationUpserts.at(-1)).toEqual({
      modelId: "model",
      voiceId: "voice",
      millisecondsPerNormalizedCharacter: 150,
      sampleCount: 4,
      updatedAt: "2026-08-13T12:00:00.000Z",
    });
    await service.close();
  });

  it.each(["read", "upsert"] as const)(
    "keeps the render complete and logs only safe metadata when calibration %s fails",
    async (operation) => {
      const privateFailure = Object.assign(
        new Error(
          "Private project Render fixture: narrator: Render me. at http://127.0.0.1:8765/private",
        ),
        {
          name: "PrivateCalibrationError",
          code: "PRIVATE_RENDER_FIXTURE",
        },
      );
      const { service, repository, projectId, logger } = await fixture();
      if (operation === "read")
        repository.calibrationReadFailure = privateFailure;
      else repository.calibrationUpsertFailure = privateFailure;

      const completed = await terminal(
        service,
        (await service.startProject(projectId)).id,
      );

      expect(completed.state).toBe("complete");
      expect(await service.listArtifacts(completed.id)).not.toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        {
          event: "render-calibration-failed",
          renderId: completed.id,
          projectId,
          cause: {
            name: "Error",
            code: "RENDER_CALIBRATION_FAILED",
          },
        },
        "Render calibration failed",
      );
      const serializedLogs = JSON.stringify([
        ...logger.info.mock.calls,
        ...logger.error.mock.calls,
      ]);
      expect(serializedLogs).not.toContain(privateFailure.message);
      expect(serializedLogs).not.toContain(privateFailure.name);
      expect(serializedLogs).not.toContain(privateFailure.code);
      expect(serializedLogs).not.toContain("Render fixture");
      expect(serializedLogs).not.toContain("Render me.");
      expect(serializedLogs).not.toContain("http://127.0.0.1:8765");
      await service.close();
    },
  );

  it("never calibrates failed or canceled renders", async () => {
    const failedFixture = await fixture({
      synthesisFailure: new Error("synthesis failed"),
    });
    const failed = await terminal(
      failedFixture.service,
      (await failedFixture.service.startProject(failedFixture.projectId)).id,
    );
    expect(failed.state).toBe("failed");
    expect(failedFixture.repository.calibrationReads).toEqual([
      { modelId: "model", voiceId: "voice" },
    ]);
    expect(failedFixture.repository.calibrationUpserts).toEqual([]);
    await failedFixture.service.close();

    let releaseSynthesis: () => void = () => undefined;
    const synthesisGate = new Promise<void>((resolve) => {
      releaseSynthesis = resolve;
    });
    const canceledFixture = await fixture({ synthesisGate });
    const started = await canceledFixture.service.startProject(
      canceledFixture.projectId,
    );
    await canceledFixture.service.cancel(started.id);
    releaseSynthesis();
    const canceled = await terminal(canceledFixture.service, started.id);

    expect(canceled.state).toBe("canceled");
    expect(canceledFixture.repository.calibrationReads).toEqual([
      { modelId: "model", voiceId: "voice" },
    ]);
    expect(canceledFixture.repository.calibrationUpserts).toEqual([]);
    await canceledFixture.service.close();
  });

  it("synthesizes, normalizes, encodes, validates, and atomically publishes the v1 bundle", async () => {
    const { service, repository, dataDirectory, projectId, logger } =
      await fixture();
    const started = await service.startProject(projectId);
    await expect(service.startProject(projectId)).resolves.toHaveProperty(
      "id",
      started.id,
    );
    const completed = await terminal(service, started.id);
    expect(completed.state).toBe("complete");
    expect(completed.progress).toMatchObject({
      completedChunks: 1,
      cacheMisses: 1,
      ttsRequests: 1,
    });
    const infoEvents = logger.info.mock.calls.map(
      ([bindings]) => bindings as Record<string, unknown>,
    );
    expect(infoEvents.map(({ event }) => event)).toEqual([
      "render-phase-transition",
      "render-start",
      "render-phase-transition",
      "render-phase-transition",
      "render-phase-transition",
      "render-phase-transition",
      "render-phase-transition",
      "render-completed",
    ]);
    expect(
      infoEvents
        .filter(({ event }) => event === "render-phase-transition")
        .map(({ fromPhase, toPhase }) => [fromPhase, toPhase]),
    ).toEqual([
      ["queued", "validating"],
      ["validating", "synthesizing"],
      ["synthesizing", "assembling"],
      ["assembling", "encoding"],
      ["encoding", "writing_artifacts"],
      ["writing_artifacts", "complete"],
    ]);
    expect(infoEvents.at(-1)).toEqual({
      event: "render-completed",
      renderId: completed.id,
      projectId,
      durationMs: completed.progress.elapsedMs,
      cacheHits: 0,
      cacheMisses: 1,
    });
    expect(logger.error).not.toHaveBeenCalled();
    const artifacts = await service.listArtifacts(started.id);
    expect(artifacts.map(({ type }) => type).sort()).toEqual(
      [
        "checksums",
        "manifest",
        "mp3",
        "originalScript",
        "projectSnapshot",
        "readableTranscript",
        "ttsTranscript",
      ].sort(),
    );
    const mp3 = artifacts.find(({ type }) => type === "mp3")!;
    const resolved = await service.resolveArtifact(mp3.id);
    const probe = await probeAudioFile({ inputPath: resolved.path });
    expect(probe.decodable).toBe(true);
    expect(probe.formatName).toContain("mp3");
    const [reviewSegment] = repository.listRenderSegments(started.id);
    expect(reviewSegment?.state).toBe("complete");
    expect(reviewSegment?.audioFileName).toBe("000001.wav");
    expect(reviewSegment?.audioSizeBytes).toBeTypeOf("number");
    expect(reviewSegment?.audioChecksum).toMatch(/^[a-f0-9]{64}$/u);
    const retained = repository.getRenderSegmentPath(started.id, 1);
    expect(retained.path).toBe(
      join(dataDirectory, "renders", started.id, "segments", "000001.wav"),
    );
    expect((await readFile(retained.path!)).byteLength).toBe(
      reviewSegment!.audioSizeBytes,
    );
    const waveform = JSON.parse(
      await readFile(
        join(dataDirectory, "renders", started.id, "waveform.json"),
        "utf8",
      ),
    ) as { sourceChecksum: string; peaks: number[] };
    expect(waveform.sourceChecksum).toBe(mp3.checksum);
    expect(waveform.peaks.length).toBeGreaterThan(0);
    expect(waveform.peaks.length).toBeLessThanOrEqual(1_024);
    await expect(service.getWaveform(started.id)).resolves.toMatchObject({
      status: "available",
      sourceChecksum: mp3.checksum,
    });
    const [historySegment] = await service.listSegments(started.id);
    expect(historySegment?.type).toBe("speech");
    if (historySegment?.type !== "speech")
      throw new Error("Expected speech history.");
    expect(historySegment).toMatchObject({
      ordinal: 1,
      speakerLabel: "Narrator",
      modelId: "model",
      voiceId: "voice",
      readableText: "Render me.",
    });
    expect(historySegment.audio).toMatchObject({
      status: "available",
      mimeType: "audio/wav",
    });
    await expect(
      service.resolveSegmentAudio(started.id, 1),
    ).resolves.toMatchObject({ fileName: "000001.wav", mimeType: "audio/wav" });
    await unlink(retained.path!);
    const [missingSegment] = await service.listSegments(started.id);
    expect(missingSegment?.audio.status).toBe("unavailable");
    await expect(service.resolveSegmentAudio(started.id, 1)).rejects.toThrow(
      "unavailable",
    );
    const checksums = artifacts.find(({ type }) => type === "checksums")!;
    expect(
      await readFile(
        (await service.resolveArtifact(checksums.id)).path,
        "utf8",
      ),
    ).toContain(mp3.checksum);
    await expect(service.exportAudio!(started.id)).resolves.toEqual({
      disposition: "download",
      fileName: "render-fixture.mp3",
    });
    const details = await service.resolveDetailsArchive!(started.id);
    expect(details.fileName).toBe("render-fixture-render-details.zip");
    expect(Object.keys(unzipSync(details.bytes)).sort()).toEqual(
      artifacts.map(({ fileName }) => fileName).sort(),
    );
    expect(
      Object.keys(unzipSync(details.bytes)).some(
        (name) => name.includes("segment") || name.includes("waveform"),
      ),
    ).toBe(false);
    await writeFile(
      (await service.resolveArtifact(mp3.id)).path,
      Uint8Array.from([1, 2, 3]),
    );
    await expect(service.resolveDetailsArchive!(started.id)).rejects.toThrow(
      /integrity/iu,
    );
    await service.close();
  });

  it("logs a sanitized failure cause without private render inputs", async () => {
    const privateFailure =
      "Private project Render fixture: narrator: Render me. at http://127.0.0.1:8765/private";
    const { service, projectId, logger } = await fixture({
      synthesisFailure: new Error(privateFailure),
    });
    const failed = await terminal(
      service,
      (await service.startProject(projectId)).id,
    );

    expect(failed).toMatchObject({
      state: "failed",
      error: {
        code: "RENDER_SYNTHESIS_FAILED",
        message: "Speech generation failed for the current segment.",
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      {
        event: "render-failed",
        renderId: failed.id,
        projectId,
        phase: "synthesizing",
        cause: {
          code: "RENDER_SYNTHESIS_FAILED",
          message: "Speech generation failed for the current segment.",
        },
      },
      "Render failed",
    );
    const serializedLogs = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(serializedLogs).not.toContain(privateFailure);
    expect(serializedLogs).not.toContain("Render fixture");
    expect(serializedLogs).not.toContain("Render me.");
    expect(serializedLogs).not.toContain("http://127.0.0.1:8765");
    await service.close();
  });

  it("fails safely when the frozen endpoint identity changes", async () => {
    const { service, repository, projectId } = await fixture();
    repository.connection.baseUrl = "http://127.0.0.1:9999";
    const job = await terminal(
      service,
      (await service.startProject(projectId)).id,
    );
    expect(job).toMatchObject({
      state: "failed",
      error: { code: "RENDER_VALIDATION_FAILED", retryable: false },
    });
    expect(await service.listArtifacts(job.id)).toEqual([]);
    await service.close();
  });
});
