import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSpeechCache } from "./index.js";
import {
  createSpeechCacheActivityGate,
  createSpeechCacheSweeper,
} from "./speechCacheSweeper.js";

const paths: string[] = [];

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const rootDirectory = await mkdtemp(join(tmpdir(), "studynarrator-sweep-"));
  paths.push(rootDirectory);
  let clock = new Date("2026-01-10T00:00:00.000Z");
  const activityGate = createSpeechCacheActivityGate();
  const cache = createSpeechCache({
    rootDirectory,
    validateAudio: async () => true,
    now: () => clock,
    activityGate,
  });
  const add = async (text: string, bytes: number) => {
    const result = await cache.getOrCreate(
      {
        adapterId: "test",
        adapterVersion: 1,
        serverIdentity: "http://localhost",
        modelId: "model",
        voiceId: "voice",
        speed: 1,
        text,
        responseFormat: "wav",
      },
      {},
      async () => new Uint8Array(bytes).fill(1),
    );
    return result.key;
  };
  return {
    rootDirectory,
    cache,
    sweeper: createSpeechCacheSweeper({
      cache,
      rootDirectory,
      activityGate,
    }),
    activityGate,
    add,
    setClock: (value: string) => {
      clock = new Date(value);
    },
  };
}

function metadataPath(rootDirectory: string, key: string): string {
  return join(rootDirectory, key.slice(0, 2), `${key}.json`);
}

describe("speech cache sweeper", () => {
  it("evicts entries older than the configured TTL", async () => {
    const { add, cache, setClock, sweeper } = await fixture();
    const key = await add("old", 10);
    setClock("2026-01-18T00:00:00.000Z");

    await expect(
      sweeper.sweep({ ttl: "7d", sizeCapBytes: 100 }),
    ).resolves.toMatchObject({
      entriesRemoved: 1,
      bytesFreed: 10,
    });
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 0 });
    expect(key).toHaveLength(64);
  });

  it("evicts least-recently-used entries until the size cap is met", async () => {
    const { add, cache, setClock, sweeper } = await fixture();
    const oldest = await add("oldest", 10);
    setClock("2026-01-10T01:00:00.000Z");
    const newest = await add("newest", 20);

    await expect(
      sweeper.sweep({ ttl: "never", sizeCapBytes: 20 }),
    ).resolves.toMatchObject({
      entriesRemoved: 1,
      bytesFreed: 10,
    });
    await expect(cache.status()).resolves.toMatchObject({
      entryCount: 1,
      totalBytes: 20,
    });
    expect(oldest).not.toBe(newest);
  });

  it("orders offset timestamps by their epoch for LRU eviction", async () => {
    const { add, rootDirectory, sweeper } = await fixture();
    const older = await add("older", 10);
    const newer = await add("newer", 10);
    const rewriteLastUsedAt = async (key: string, lastUsedAt: string) => {
      const path = metadataPath(rootDirectory, key);
      const metadata = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
      >;
      await writeFile(path, JSON.stringify({ ...metadata, lastUsedAt }));
    };
    await rewriteLastUsedAt(older, "2026-01-10T00:00:00+05:00");
    await rewriteLastUsedAt(newer, "2026-01-09T23:00:00-05:00");

    await expect(
      sweeper.sweep({ ttl: "never", sizeCapBytes: 10 }),
    ).resolves.toMatchObject({ entriesRemoved: 1, bytesFreed: 10 });
    await expect(
      readFile(metadataPath(rootDirectory, older)),
    ).rejects.toThrow();
    await expect(
      readFile(metadataPath(rootDirectory, newer)),
    ).resolves.toBeTruthy();
  });

  it("collects entries whose metadata cannot be read", async () => {
    const { add, cache, rootDirectory, sweeper } = await fixture();
    const key = await add("broken", 12);
    await writeFile(metadataPath(rootDirectory, key), "not JSON");

    await expect(
      sweeper.sweep({ ttl: "never", sizeCapBytes: 100 }),
    ).resolves.toMatchObject({
      entriesRemoved: 1,
      bytesFreed: 12,
    });
    await expect(cache.status()).resolves.toMatchObject({ entryCount: 0 });
  });

  it("skips while an activity lease is active", async () => {
    const { activityGate, sweeper } = await fixture();
    const activity = await activityGate.beginActivity();

    await expect(
      sweeper.sweep({ ttl: "never", sizeCapBytes: 100 }),
    ).resolves.toMatchObject({ skipped: true });
    activity.release();
  });

  it("waits to begin cache activity until exclusive maintenance finishes", async () => {
    const { activityGate } = await fixture();
    const maintenance = activityGate.beginMaintenance();
    expect(maintenance).not.toBeNull();
    let started = false;
    const pending = activityGate.beginActivity().then((activity) => {
      started = true;
      return activity;
    });

    await Promise.resolve();
    expect(started).toBe(false);
    maintenance?.release();
    const activity = await pending;
    expect(started).toBe(true);
    activity.release();
  });

  it("skips while a cache render is in flight", async () => {
    const { cache, sweeper } = await fixture();
    let finish: () => void = () => undefined;
    let started: () => void = () => undefined;
    const synthesizing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = cache.getOrCreate(
      {
        adapterId: "test",
        adapterVersion: 1,
        serverIdentity: "http://localhost",
        modelId: "model",
        voiceId: "voice",
        speed: 1,
        text: "active",
        responseFormat: "wav",
      },
      {},
      async () => {
        started();
        return await new Promise<Uint8Array>((resolve) => {
          finish = () => resolve(new Uint8Array([1]));
        });
      },
    );
    await synthesizing;
    await expect(
      sweeper.sweep({ ttl: "never", sizeCapBytes: 100 }),
    ).resolves.toMatchObject({
      skipped: true,
    });
    finish();
    await pending;
  });

  it("reports preview totals without deleting entries", async () => {
    const { add, rootDirectory, setClock, sweeper } = await fixture();
    const key = await add("preview", 10);
    setClock("2026-01-18T00:00:00.000Z");

    await expect(
      sweeper.sweep({ ttl: "7d", sizeCapBytes: 100, preview: true }),
    ).resolves.toMatchObject({
      entriesRemoved: 1,
      bytesFreed: 10,
      preview: true,
    });
    await expect(
      readFile(metadataPath(rootDirectory, key), "utf8"),
    ).resolves.toContain(key);
  });
});
