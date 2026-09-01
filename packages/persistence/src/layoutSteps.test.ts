import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSpeechCacheSweep,
  removeLegacyRenderProvenance,
  removeStandaloneRenderPlans,
} from "./layoutSteps.js";

const directories: string[] = [];

async function makeDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "studynarrator-layout-"));
  directories.push(directory);
  return directory;
}

async function has(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
  vi.restoreAllMocks();
});

describe("remove-legacy-render-provenance", () => {
  it("tolerates a missing render root and repeats as a no-op", async () => {
    const dataDirectory = await makeDataDirectory();

    await removeLegacyRenderProvenance.run(dataDirectory);
    await removeLegacyRenderProvenance.run(dataDirectory);

    expect(await has(join(dataDirectory, "renders"))).toBe(false);
  });

  it("removes only the exact legacy files from managed render directories", async () => {
    const dataDirectory = await makeDataDirectory();
    const renderDirectory = join(
      dataDirectory,
      "renders",
      "00000000-0000-4000-8000-000000000001",
    );
    await mkdir(renderDirectory, { recursive: true });
    await writeFile(join(renderDirectory, "render-manifest.json"), "{}", {
      flag: "wx",
    });
    await writeFile(join(renderDirectory, "checksums.txt"), "obsolete", {
      flag: "wx",
    });
    await writeFile(join(renderDirectory, "project-snapshot.json"), "{}", {
      flag: "wx",
    });
    await removeLegacyRenderProvenance.run(dataDirectory);
    expect(await has(join(renderDirectory, "render-manifest.json"))).toBe(
      false,
    );
    expect(await has(join(renderDirectory, "checksums.txt"))).toBe(false);
    expect(await has(join(renderDirectory, "project-snapshot.json"))).toBe(
      true,
    );
  });

  it("does not follow a provenance symlink and retries remaining cleanup safely", async () => {
    const dataDirectory = await makeDataDirectory();
    const renderDirectory = join(
      dataDirectory,
      "renders",
      "00000000-0000-4000-8000-000000000001",
    );
    const outside = join(dataDirectory, "outside-checksums.txt");
    await mkdir(renderDirectory, { recursive: true });
    await writeFile(join(renderDirectory, "render-manifest.json"), "{}", {
      flag: "wx",
    });
    await writeFile(outside, "preserve", { flag: "wx" });
    await symlink(outside, join(renderDirectory, "checksums.txt"), "file");

    await expect(
      removeLegacyRenderProvenance.run(dataDirectory),
    ).rejects.toThrow("does not follow symlinks");
    expect(await has(join(renderDirectory, "render-manifest.json"))).toBe(
      false,
    );
    expect(await readFile(outside, "utf8")).toBe("preserve");

    await rm(join(renderDirectory, "checksums.txt"));
    await writeFile(join(renderDirectory, "checksums.txt"), "obsolete", {
      flag: "wx",
    });
    await removeLegacyRenderProvenance.run(dataDirectory);
    expect(await has(join(renderDirectory, "checksums.txt"))).toBe(false);
  });

  it("rejects a render-directory symlink without touching its target", async () => {
    const dataDirectory = await makeDataDirectory();
    const rendersRoot = join(dataDirectory, "renders");
    const outside = join(dataDirectory, "outside-render");
    await mkdir(rendersRoot, { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "render-manifest.json"), "{}", {
      flag: "wx",
    });
    await symlink(
      outside,
      join(rendersRoot, "00000000-0000-4000-8000-000000000001"),
      "dir",
    );

    await expect(
      removeLegacyRenderProvenance.run(dataDirectory),
    ).rejects.toThrow("does not follow symlinks");
    expect(await has(join(outside, "render-manifest.json"))).toBe(true);
  });
});

describe("remove-standalone-render-plans", () => {
  it("removes legacy plan directories while preserving .jobs and strays", async () => {
    const dataDirectory = await makeDataDirectory();
    const plansRoot = join(dataDirectory, "render-plans");
    const legacyPlan = join(plansRoot, "legacy-plan", "assets");
    const keptJob = join(plansRoot, ".jobs", "render-keep");
    await mkdir(legacyPlan, { recursive: true });
    await mkdir(keptJob, { recursive: true });
    await writeFile(
      join(plansRoot, "legacy-plan", "plan.json"),
      JSON.stringify({ plan: "legacy" }),
      { mode: 0o600, flag: "wx" },
    );
    await writeFile(
      join(keptJob, "plan.json"),
      JSON.stringify({ snapshot: "kept" }),
      { mode: 0o600, flag: "wx" },
    );
    await writeFile(join(plansRoot, "note.txt"), "stray", {
      mode: 0o600,
      flag: "wx",
    });

    await removeStandaloneRenderPlans.run(dataDirectory);

    expect(await has(join(plansRoot, "legacy-plan"))).toBe(false);
    expect(await has(join(keptJob, "plan.json"))).toBe(true);
    expect(await has(join(plansRoot, "note.txt"))).toBe(true);
    const kept = await readFile(join(keptJob, "plan.json"), "utf8");
    expect(kept).toContain("kept");
  });

  it("never follows a symlink standing in for a plan directory", async () => {
    const dataDirectory = await makeDataDirectory();
    const plansRoot = join(dataDirectory, "render-plans");
    const outside = join(dataDirectory, "elsewhere", "real-plan");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "plan.json"), "{}", {
      mode: 0o600,
      flag: "wx",
    });
    await mkdir(plansRoot, { recursive: true });
    await symlink(outside, join(plansRoot, "linked-plan"), "dir");

    await removeStandaloneRenderPlans.run(dataDirectory);

    const linkedStat = await lstat(join(plansRoot, "linked-plan"));
    expect(await has(join(outside, "plan.json"))).toBe(true);
    expect(linkedStat?.isSymbolicLink()).toBe(true);
  });

  it("tolerates a missing render-plans directory and repeats as a no-op", async () => {
    const dataDirectory = await makeDataDirectory();

    await removeStandaloneRenderPlans.run(dataDirectory);
    await removeStandaloneRenderPlans.run(dataDirectory);

    expect(await has(join(dataDirectory, "render-plans"))).toBe(false);
  });
});

describe("sweep-unreadable-cache-entries", () => {
  function key(prefix: string): string {
    const value = Buffer.from(prefix, "utf8")
      .toString("hex")
      .padEnd(64, "0")
      .slice(0, 64)
      .replace(/[^a-f0-9]/gu, "f");
    expect(value).toMatch(/^[a-f0-9]{64}$/u);
    return value;
  }

  const flagging =
    (needle: string) =>
    async (metadataPath: string): Promise<boolean> =>
      metadataPath.includes(needle);

  async function seedEntry(
    dataDirectory: string,
    shard: string,
    shardKey: string,
    metadata: string,
    audio = true,
  ) {
    const shardDirectory = join(dataDirectory, "cache", "speech", shard);
    await mkdir(shardDirectory, { recursive: true });
    await writeFile(join(shardDirectory, `${shardKey}.json`), metadata, {
      mode: 0o600,
      flag: "wx",
    });
    if (audio) {
      await writeFile(join(shardDirectory, `${shardKey}.wav`), "RIFF", {
        mode: 0o600,
        flag: "wx",
      });
    }
  }

  it.each([
    ["unreadable", "not-json{{{"],
    ["old schema version", JSON.stringify({ schemaVersion: 0, key: "any" })],
    ["empty", ""],
  ])("removes the entry and audio flagged #%s", async (_label, metadata) => {
    const dataDirectory = await makeDataDirectory();
    const doomedKey = key("doomed");
    const keptKey = key("kept");
    await seedEntry(dataDirectory, "a1", doomedKey, metadata);
    await seedEntry(
      dataDirectory,
      "a1",
      keptKey,
      JSON.stringify({ schemaVersion: 1, key: keptKey }),
    );

    await createSpeechCacheSweep({
      relativeCacheRoot: "cache/speech",
      shouldDeleteEntry: flagging(doomedKey),
    }).run(dataDirectory);

    const shardDirectory = join(dataDirectory, "cache", "speech", "a1");
    expect(await has(join(shardDirectory, `${doomedKey}.json`))).toBe(false);
    expect(await has(join(shardDirectory, `${doomedKey}.wav`))).toBe(false);
    expect(await has(join(shardDirectory, `${keptKey}.json`))).toBe(true);
    expect(await has(join(shardDirectory, `${keptKey}.wav`))).toBe(true);
  });

  it("ignores non-shard directories, stray files, and orphan audio", async () => {
    const dataDirectory = await makeDataDirectory();
    const foreign = join(dataDirectory, "cache", "speech", "foreign");
    const shardDirectory = join(dataDirectory, "cache", "speech", "d4");
    await mkdir(foreign, { recursive: true });
    await mkdir(shardDirectory, { recursive: true });
    await writeFile(join(foreign, "whatever.json"), "{}", {
      mode: 0o600,
      flag: "wx",
    });
    const orphanKey = key("orphan");
    await writeFile(join(shardDirectory, `${orphanKey}.wav`), "RIFF", {
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(join(shardDirectory, "stray.txt"), "stray", {
      mode: 0o600,
      flag: "wx",
    });

    await createSpeechCacheSweep({
      relativeCacheRoot: "cache/speech",
      shouldDeleteEntry: async () => true,
    }).run(dataDirectory);

    expect(await has(join(foreign, "whatever.json"))).toBe(true);
    expect(await has(join(shardDirectory, `${orphanKey}.wav`))).toBe(true);
    expect(await has(join(shardDirectory, "stray.txt"))).toBe(true);
  });

  it("deletes a metadata file whose audio file is already gone", async () => {
    const dataDirectory = await makeDataDirectory();
    const shardKey = key("noaudio");
    await seedEntry(dataDirectory, "e5", shardKey, "not-json", false);

    await createSpeechCacheSweep({
      relativeCacheRoot: "cache/speech",
      shouldDeleteEntry: flagging(shardKey),
    }).run(dataDirectory);

    expect(
      await has(
        join(dataDirectory, "cache", "speech", "e5", `${shardKey}.json`),
      ),
    ).toBe(false);
  });

  it("tolerates a missing cache root and repeats as a no-op", async () => {
    const dataDirectory = await makeDataDirectory();
    const step = createSpeechCacheSweep({
      relativeCacheRoot: "cache/speech",
      shouldDeleteEntry: async () => true,
    });

    await step.run(dataDirectory);
    await step.run(dataDirectory);

    expect(await has(join(dataDirectory, "cache", "speech"))).toBe(false);
  });

  it("logs every entry it removes", async () => {
    const dataDirectory = await makeDataDirectory();
    const shardKey = key("logged");
    await seedEntry(dataDirectory, "f6", shardKey, "garbage");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await createSpeechCacheSweep({
      relativeCacheRoot: "cache/speech",
      shouldDeleteEntry: flagging(shardKey),
    }).run(dataDirectory);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(shardKey);
    expect(String(warn.mock.calls[0]?.[0])).toContain(".wav");
  });
});
