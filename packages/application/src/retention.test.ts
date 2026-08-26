import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSpeechCache,
  createSpeechCacheActivityGate,
  createSpeechCacheSweeper,
} from "@studynarrator/rendering";
import {
  DEFAULT_RETENTION_SETTINGS,
  type RenderJob,
  type RetentionSettings,
} from "@studynarrator/shared-types";
import { createRetentionMaintenance } from "./retention.js";

const roots: string[] = [];
const projectId = "00000000-0000-4000-8000-000000000001";
const renderId = "00000000-0000-4000-8000-000000000002";
const initial = new Date("2026-01-01T00:00:00.000Z");
const expired = new Date("2026-01-03T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

function job(id: string, pinned = false): RenderJob {
  return {
    contractVersion: 1,
    id,
    projectId,
    planId: "00000000-0000-4000-8000-000000000004",
    retryOfRenderId: null,
    pinned,
    state: "complete",
    progress: {
      phase: "complete",
      sectionTitle: null,
      sectionOrdinal: 0,
      sectionCount: 0,
      entryOrdinal: null,
      speechOrdinal: 0,
      speechCount: 0,
      chunkOrdinal: null,
      completedChunks: 0,
      totalChunks: 0,
      cacheHits: 0,
      cacheMisses: 0,
      ttsRequests: 0,
      speakerId: null,
      voiceId: null,
      excerpt: null,
      elapsedMs: 1,
    },
    error: null,
    createdAt: initial.toISOString(),
    startedAt: initial.toISOString(),
    finishedAt: initial.toISOString(),
  };
}

async function fixture(
  options: { pinned?: boolean; roots?: boolean; recoverable?: boolean } = {},
) {
  const dataDirectory = await mkdtemp(
    join(tmpdir(), "studynarrator-retention-"),
  );
  roots.push(dataDirectory);
  const activityGate = createSpeechCacheActivityGate();
  const cache = createSpeechCache({
    rootDirectory: join(dataDirectory, "cache", "speech"),
    validateAudio: async () => true,
    now: () => initial,
    activityGate,
  });
  const cacheKey = (
    await cache.getOrCreate(
      {
        adapterId: "test",
        adapterVersion: 1,
        serverIdentity: "http://localhost",
        modelId: "model",
        voiceId: "voice",
        speed: 1,
        text: "Retention fixture.",
        responseFormat: "wav",
      },
      { projectId },
      async () => new Uint8Array(7).fill(1),
    )
  ).key;
  const render = job(renderId, options.pinned);
  if (options.roots !== false) {
    await mkdir(join(dataDirectory, "render-plans", ".jobs", render.id), {
      recursive: true,
    });
    await writeFile(
      join(
        dataDirectory,
        "render-plans",
        ".jobs",
        render.id,
        "project-snapshot.json",
      ),
      "snapshot",
    );
    await mkdir(join(dataDirectory, "renders", render.id), { recursive: true });
    await writeFile(
      join(dataDirectory, "renders", render.id, "audio.mp3"),
      "artifact",
    );
  }
  let settings: RetentionSettings = {
    ...DEFAULT_RETENTION_SETTINGS,
    speechCacheTtl: "8h",
    jobSnapshotTtl: "8h",
    renderArtifactTtl: "8h",
    speechCacheSizeCapBytes: 1_024,
    updatedAt: initial.toISOString(),
  };
  const cleared: string[] = [];
  const repository = {
    getRetentionSettings: () => settings,
    listPinnedRenderProjectIds: () => (render.pinned ? [projectId] : []),
    listRecoverableRenderJobs: () => (options.recoverable ? [render] : []),
    listRetentionRenderJobs: () => [render],
    clearRenderMedia: (id: string) => cleared.push(id),
  };
  const maintenance = createRetentionMaintenance({
    repository,
    cache,
    speechCacheSweeper: createSpeechCacheSweeper({
      cache,
      rootDirectory: join(dataDirectory, "cache", "speech"),
      activityGate,
    }),
    activityGate,
    dataDirectory,
    now: () => expired,
  });
  return {
    dataDirectory,
    cache,
    cacheKey,
    maintenance,
    cleared,
    setSettings: (next: RetentionSettings) => {
      settings = next;
    },
  };
}

describe("retention maintenance", () => {
  it("clears selected terminal render clips while preserving snapshots and history", async () => {
    const { cache, cleared, dataDirectory, maintenance } = await fixture();

    await expect(
      maintenance.clearCacheAndRenderedProjectClips(),
    ).resolves.toEqual({ entriesRemoved: 1, bytesFreed: 7 });
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 0 });
    await expect(
      readFile(join(dataDirectory, "renders", renderId, "audio.mp3")),
    ).rejects.toThrow();
    await expect(
      readFile(
        join(
          dataDirectory,
          "render-plans",
          ".jobs",
          renderId,
          "project-snapshot.json",
        ),
      ),
    ).resolves.toEqual(Buffer.from("snapshot"));
    expect(cleared).toEqual([renderId]);
  });

  it("preserves pinned rendered clips while clearing cache", async () => {
    const { cache, cleared, dataDirectory, maintenance } = await fixture({
      pinned: true,
    });

    await expect(
      maintenance.clearCacheAndRenderedProjectClips(),
    ).resolves.toEqual({ entriesRemoved: 1, bytesFreed: 7 });
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 0 });
    await expect(
      readFile(join(dataDirectory, "renders", renderId, "audio.mp3")),
    ).resolves.toEqual(Buffer.from("artifact"));
    expect(cleared).toEqual([]);
  });

  it("preserves cache and media when a render is recoverable", async () => {
    const { cache, cleared, dataDirectory, maintenance } = await fixture({
      recoverable: true,
    });

    await expect(
      maintenance.clearCacheAndRenderedProjectClips(),
    ).rejects.toThrow("while a render is recoverable");
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 1 });
    await expect(
      readFile(join(dataDirectory, "renders", renderId, "audio.mp3")),
    ).resolves.toEqual(Buffer.from("artifact"));
    expect(cleared).toEqual([]);
  });

  it("honors saved TTLs for cache, job snapshots, and render artifacts", async () => {
    const { cache, cleared, dataDirectory, maintenance } = await fixture();

    await expect(maintenance.reclaim({ confirm: true })).resolves.toMatchObject(
      {
        reclaimed: {
          speechCache: { entries: 1, bytes: 7 },
          jobSnapshots: { entries: 1, bytes: 8 },
          renderArtifacts: { entries: 1, bytes: 8 },
        },
        skipped: false,
      },
    );
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 0 });
    await expect(
      readFile(
        join(
          dataDirectory,
          "render-plans",
          ".jobs",
          renderId,
          "project-snapshot.json",
        ),
      ),
    ).rejects.toThrow();
    await expect(
      readFile(join(dataDirectory, "renders", renderId, "audio.mp3")),
    ).rejects.toThrow();
    expect(cleared).toEqual([renderId]);
  });

  it("returns a non-destructive preview before explicit confirmation", async () => {
    const { cache, dataDirectory, maintenance } = await fixture();

    await expect(maintenance.previewReclaim()).resolves.toMatchObject({
      reclaimable: {
        speechCache: { entries: 1, bytes: 7 },
        jobSnapshots: { entries: 1, bytes: 8 },
        renderArtifacts: { entries: 1, bytes: 8 },
      },
      skipped: false,
    });
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 1 });
    await expect(
      readFile(
        join(
          dataDirectory,
          "render-plans",
          ".jobs",
          renderId,
          "project-snapshot.json",
        ),
      ),
    ).resolves.toEqual(Buffer.from("snapshot"));
    await expect(
      readFile(join(dataDirectory, "renders", renderId, "audio.mp3")),
    ).resolves.toEqual(Buffer.from("artifact"));
  });

  it("reports corrupt cache metadata in usage and reclaim previews", async () => {
    const { cacheKey, dataDirectory, maintenance } = await fixture();
    await writeFile(
      join(
        dataDirectory,
        "cache",
        "speech",
        cacheKey.slice(0, 2),
        `${cacheKey}.json`,
      ),
      "not JSON",
    );

    await expect(maintenance.usage()).resolves.toMatchObject({
      speechCache: { entries: 1, bytes: 7 },
    });
    await expect(maintenance.previewReclaim()).resolves.toMatchObject({
      reclaimable: { speechCache: { entries: 1, bytes: 7 } },
      skipped: false,
    });
  });

  it("keeps a pinned render and its cache dependencies out of reclaim", async () => {
    const { cache, cleared, dataDirectory, maintenance } = await fixture({
      pinned: true,
    });

    await expect(maintenance.reclaim({ confirm: true })).resolves.toMatchObject(
      {
        reclaimed: {
          speechCache: { entries: 0, bytes: 0 },
          jobSnapshots: { entries: 0, bytes: 0 },
          renderArtifacts: { entries: 0, bytes: 0 },
        },
      },
    );
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 1 });
    await expect(
      readFile(
        join(
          dataDirectory,
          "render-plans",
          ".jobs",
          renderId,
          "project-snapshot.json",
        ),
      ),
    ).resolves.toBeTruthy();
    expect(cleared).toEqual([]);
  });

  it("tolerates missing managed roots and rejects malformed confirmation", async () => {
    const { maintenance } = await fixture({ roots: false });

    await expect(maintenance.usage()).resolves.toEqual({
      speechCache: { entries: 1, bytes: 7 },
      jobSnapshots: { entries: 0, bytes: 0 },
      renderArtifacts: { entries: 0, bytes: 0 },
    });
    await expect(maintenance.reclaim({ confirm: false })).rejects.toThrow();
  });
});
