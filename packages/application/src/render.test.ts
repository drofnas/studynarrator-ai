import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import type {
  SpeachesConnection,
  ProjectDetail,
  RenderArtifact,
  RenderJob,
  RenderSegment,
} from "@studynarrator/shared-types";
import {
  createPcmSilence,
  probeAudioFile,
  withProjectSnapshotHash,
  withRenderPlanHash,
  type RenderPlanStore,
} from "@studynarrator/rendering";
import { createRenderService, type RenderRepository } from "./render.js";
import { type ComputedRenderPlan } from "./renderPlan.js";

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
  constructor(
    readonly connection: SpeachesConnection,
    readonly project: ProjectDetail,
  ) {}
  getSpeachesConnection() {
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
    this.segments.set(key, item);
    this.segmentPaths.set(key, path);
    return item;
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
}

async function fixture() {
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
        speed: 1,
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
  const plan = withRenderPlanHash({
    schemaVersion: 1,
    id: planId,
    projectId,
    createdAt: timestamp,
    snapshotHash: snapshot.snapshotHash,
    scriptHash: project.scriptHash,
    entries: [
      {
        type: "speech",
        ordinal: 1,
        nodeOrdinal: 1,
        sectionTitle: null,
        sourceRange: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 21 },
        },
        speakerId: "narrator",
        voiceId: "voice",
        speed: 1,
        gainDb: 0,
        originalText: "Render me.",
        readableText: "Render me.",
        ttsText: "Render me.",
        chunks: [
          { ordinal: 1, text: "Render me.", cacheKey, cacheStatus: "miss" },
        ],
      },
    ],
    summary: {
      sectionCount: 0,
      speechCount: 1,
      pauseCount: 0,
      cacheHits: 0,
      cacheMisses: 1,
      silenceDurationMs: 0,
    },
  });
  const plans: RenderPlanStore = {
    async snapshotJob(renderId) {
      if (!/^[0-9a-f-]{36}$/u.test(renderId))
        throw new Error("Invalid render id in test fixture.");
    },
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
  let nextId = 10;
  const computed: ComputedRenderPlan = {
    snapshot,
    plan,
    silenceAssets: new Map(),
  };
  const service = await createRenderService({
    repository,
    plans,
    dataDirectory,
    planComputer: { compute: async () => computed },
    speech: {
      async synthesize() {
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
            speed: 1,
            textHash: sha("Render me."),
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
      },
    },
    createId: () =>
      `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
  });
  return { service, repository, plan, projectId, dataDirectory };
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
  it("synthesizes, normalizes, encodes, validates, and atomically publishes the v1 bundle", async () => {
    const { service, repository, dataDirectory, projectId } =
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
