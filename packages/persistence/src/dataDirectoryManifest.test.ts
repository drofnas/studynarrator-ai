import { lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DATA_DIRECTORY_LAYOUT_VERSION,
  DATA_DIRECTORY_MANIFEST_VERSION,
  LayoutTooNewError,
  readDataDirectoryManifest,
  runLayoutSteps,
  writeDataDirectoryManifest,
  type DataDirectoryManifest,
} from "./index.js";

const BASE_TIME = "2026-08-18T00:00:00.000Z";
const LATER_TIME = "2026-08-19T06:30:00.000Z";

function manifestDirectory(prefix: string) {
  return join(
    tmpdir(),
    `studynarrator-manifest-${String(prefix)}-${String(process.pid)}-${String(Math.round(Math.random() * 1e9))}`,
  );
}

function manifestPath(directory: string) {
  return join(directory, "manifest.json");
}

async function readManifestJson(directory: string): Promise<unknown> {
  return JSON.parse(await readFile(manifestPath(directory), "utf8"));
}

async function writeFileRaw(directory: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    manifestPath(directory),
    `${JSON.stringify(value, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function baseManifest(overrides: Partial<DataDirectoryManifest> = {}) {
  return {
    manifestVersion: DATA_DIRECTORY_MANIFEST_VERSION,
    appVersion: "0.1.0",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    layoutVersion: DATA_DIRECTORY_LAYOUT_VERSION,
    completedSteps: [],
    ...overrides,
  };
}

describe("readDataDirectoryManifest", () => {
  it("creates the manifest in a fresh empty data directory", async () => {
    const directory = manifestDirectory("fresh");
    await mkdir(directory, { mode: 0o700 });

    const manifest = await readDataDirectoryManifest(directory, {
      appVersion: "0.1.0",
      now: () => new Date(BASE_TIME),
    });

    expect(manifest).toEqual(baseManifest());
    expect(await readManifestJson(directory)).toEqual(manifest);
    const leftover = await lstat(join(directory, "manifest.json.tmp")).catch(
      () => null,
    );
    expect(leftover).toBeNull();
  });

  it("creates the manifest even when the data directory does not exist yet", async () => {
    const directory = manifestDirectory("missing-dir");

    const manifest = await readDataDirectoryManifest(directory, {
      appVersion: "0.1.0",
      now: () => new Date(BASE_TIME),
    });

    expect(manifest.layoutVersion).toBe(DATA_DIRECTORY_LAYOUT_VERSION);
    expect(await stat(manifestPath(directory))).toBeDefined();
  });

  it("treats a pre-manifest installation as new rather than unrecoverable", async () => {
    const directory = manifestDirectory("pre-manifest");
    await mkdir(directory, { mode: 0o700 });
    const databasePath = join(directory, "studynarrator.sqlite");
    await writeFile(databasePath, "existing rows", {
      encoding: "utf8",
      mode: 0o600,
    });

    const manifest = await readDataDirectoryManifest(directory, {
      appVersion: "0.3.0",
      now: () => new Date(BASE_TIME),
    });

    expect(manifest.layoutVersion).toBe(DATA_DIRECTORY_LAYOUT_VERSION);
    expect(manifest.completedSteps).toEqual([]);
    expect(await readFile(databasePath, "utf8")).toBe("existing rows");
  });

  it("refreshes appVersion and updatedAt but preserves the rest of the manifest", async () => {
    const directory = manifestDirectory("refresh");
    await writeDataDirectoryManifest(
      directory,
      baseManifest({
        appVersion: "0.1.0",
        updatedAt: "2026-08-18T12:00:00.000Z",
        completedSteps: ["retain-legacy-cache"],
      }),
    );

    const refreshed = await readDataDirectoryManifest(directory, {
      appVersion: "0.2.0",
      now: () => new Date(LATER_TIME),
    });

    expect(refreshed.appVersion).toBe("0.2.0");
    expect(refreshed.updatedAt).toBe(LATER_TIME);
    expect(refreshed.createdAt).toBe(BASE_TIME);
    expect(refreshed.completedSteps).toEqual(["retain-legacy-cache"]);
    expect(await readManifestJson(directory)).toEqual(refreshed);
  });

  it("refuses a manifest whose layout this build does not support", async () => {
    const directory = manifestDirectory("too-new");
    const tooNew = baseManifest({
      layoutVersion: DATA_DIRECTORY_LAYOUT_VERSION + 1,
    });
    await writeFileRaw(directory, tooNew);

    await expect(
      readDataDirectoryManifest(directory, {
        appVersion: "0.1.0",
        now: () => new Date(LATER_TIME),
      }),
    ).rejects.toMatchObject({
      code: "LAYOUT_TOO_NEW",
      dataDirectory: directory,
      manifestLayoutVersion: tooNew.layoutVersion,
      supportedLayoutVersion: DATA_DIRECTORY_LAYOUT_VERSION,
    });

    const failure = new LayoutTooNewError(
      directory,
      tooNew.layoutVersion,
      DATA_DIRECTORY_LAYOUT_VERSION,
    );
    expect(failure.message).toContain("newer version of StudyNarrator");
    expect(await readManifestJson(directory)).toEqual(tooNew);
    const leftover = await lstat(join(directory, "manifest.json.tmp")).catch(
      () => null,
    );
    expect(leftover).toBeNull();
  });

  it("rejects a manifest with fields this build does not understand", async () => {
    const directory = manifestDirectory("unknown-shape");
    await writeFileRaw(
      directory,
      baseManifest({ futureField: "no" } as unknown as Record<string, unknown>),
    );

    await expect(
      readDataDirectoryManifest(directory, {
        appVersion: "0.1.0",
        now: () => new Date(LATER_TIME),
      }),
    ).rejects.toThrow();
  });

  it("rejects a manifest that is not valid JSON", async () => {
    const directory = manifestDirectory("corrupt");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(manifestPath(directory), "not json", {
      encoding: "utf8",
      mode: 0o600,
    });

    await expect(
      readDataDirectoryManifest(directory, {
        appVersion: "0.1.0",
        now: () => new Date(LATER_TIME),
      }),
    ).rejects.toThrow("not valid JSON");
  });
});

describe("writeDataDirectoryManifest", () => {
  it("writes the manifest atomically with restrictive permissions", async () => {
    const directory = manifestDirectory("write");
    const manifest = baseManifest();

    await writeDataDirectoryManifest(directory, manifest);

    expect(await readManifestJson(directory)).toEqual(manifest);
    const { mode } = await stat(manifestPath(directory));
    expect(mode & 0o777).toBe(0o600);
  });

  it("refuses to write over a leftover tmp file and keeps the live manifest", async () => {
    const directory = manifestDirectory("tmp-conflict");
    const live = baseManifest();
    await writeDataDirectoryManifest(directory, live);
    await writeFile(join(directory, "manifest.json.tmp"), "someone else", {
      encoding: "utf8",
      mode: 0o600,
    });

    const failure = (await writeDataDirectoryManifest(
      directory,
      baseManifest({ appVersion: "0.2.0" }),
    ).catch((error: unknown) => error)) as NodeJS.ErrnoException;

    expect(failure.code).toBe("EEXIST");
    expect(await readManifestJson(directory)).toEqual(live);
  });

  it("rejects a manifest that fails validation", async () => {
    const directory = manifestDirectory("invalid");

    await expect(
      writeDataDirectoryManifest(
        directory,
        baseManifest({ appVersion: "" }) as DataDirectoryManifest,
      ),
    ).rejects.toThrow();
    expect(await lstat(manifestPath(directory)).catch(() => null)).toBeNull();
  });
});

describe("runLayoutSteps", () => {
  async function seededDirectory(prefix: string) {
    const directory = manifestDirectory(prefix);
    await readDataDirectoryManifest(directory, {
      appVersion: "0.1.0",
      now: () => new Date(BASE_TIME),
    });
    return directory;
  }

  it("runs steps in array order and records their completion", async () => {
    const directory = await seededDirectory("steps-run");
    const calls: string[] = [];

    const result = await runLayoutSteps(directory, [
      {
        id: "step-a",
        run: async () => {
          calls.push("step-a");
        },
      },
      {
        id: "step-b",
        run: async () => {
          calls.push("step-b");
        },
      },
    ]);

    expect(calls).toEqual(["step-a", "step-b"]);
    expect(result).toEqual({ completed: ["step-a", "step-b"], failed: [] });
    expect(await readManifestJson(directory)).toMatchObject({
      completedSteps: ["step-a", "step-b"],
    });
  });

  it("skips steps already recorded in the manifest", async () => {
    const directory = await seededDirectory("steps-skip");
    await writeDataDirectoryManifest(
      directory,
      baseManifest({ completedSteps: ["step-a"] }),
    );
    let ran = false;

    const result = await runLayoutSteps(directory, [
      {
        id: "step-a",
        run: async () => {
          ran = true;
        },
      },
    ]);

    expect(ran).toBe(false);
    expect(result).toEqual({ completed: [], failed: [] });
    expect(await readManifestJson(directory)).toMatchObject({
      completedSteps: ["step-a"],
    });
  });

  it("collects a failing step without recording it or stopping later steps", async () => {
    const directory = await seededDirectory("steps-fail");
    const failure = new Error("step-a exploded");

    const result = await runLayoutSteps(directory, [
      {
        id: "step-a",
        run: async () => {
          throw failure;
        },
      },
      {
        id: "step-b",
        run: async () => {
          /* succeeds */
        },
      },
    ]);

    expect(result.completed).toEqual(["step-b"]);
    expect(result.failed).toEqual([{ id: "step-a", error: failure }]);
    expect(await readManifestJson(directory)).toMatchObject({
      completedSteps: ["step-b"],
    });
  });

  it("logs skipped, completed, and failed layout step outcomes", async () => {
    const directory = await seededDirectory("steps-log");
    await writeDataDirectoryManifest(
      directory,
      baseManifest({ completedSteps: ["step-skipped"] }),
    );
    const failure = new Error("step failed");
    const logger = { info: vi.fn(), warn: vi.fn() };

    const result = await runLayoutSteps(
      directory,
      [
        { id: "step-skipped", run: vi.fn() },
        { id: "step-completed", run: vi.fn() },
        {
          id: "step-failed",
          run: async () => {
            throw failure;
          },
        },
      ],
      { logger },
    );

    expect(result).toEqual({
      completed: ["step-completed"],
      failed: [{ id: "step-failed", error: failure }],
    });
    expect(logger.info.mock.calls).toEqual([
      [
        {
          event: "data-directory-layout-step",
          layoutStepId: "step-skipped",
          outcome: "skipped",
        },
        "Data directory layout step skipped",
      ],
      [
        {
          event: "data-directory-layout-step",
          layoutStepId: "step-completed",
          outcome: "completed",
        },
        "Data directory layout step completed",
      ],
    ]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      {
        event: "data-directory-layout-step",
        layoutStepId: "step-failed",
        outcome: "failed",
        err: failure,
      },
      "Data directory layout step failed",
    );
  });

  it("retries a failed step on the next launch", async () => {
    const directory = await seededDirectory("steps-retry");
    let attempts = 0;
    const flaky = {
      id: "flaky",
      run: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("flaky first launch");
      },
    };

    const first = await runLayoutSteps(directory, [flaky]);
    expect(first.completed).toEqual([]);
    expect(first.failed.map((entry) => entry.id)).toEqual(["flaky"]);

    const second = await runLayoutSteps(directory, [flaky]);
    expect(second).toEqual({ completed: ["flaky"], failed: [] });
    expect(await readManifestJson(directory)).toMatchObject({
      completedSteps: ["flaky"],
    });
  });

  it("refuses to run steps against a layout this build does not support", async () => {
    const directory = manifestDirectory("steps-too-new");
    await writeFileRaw(
      directory,
      baseManifest({ layoutVersion: DATA_DIRECTORY_LAYOUT_VERSION + 1 }),
    );
    let ran = false;

    await expect(
      runLayoutSteps(directory, [
        {
          id: "step-a",
          run: async () => {
            ran = true;
          },
        },
      ]),
    ).rejects.toBeInstanceOf(LayoutTooNewError);

    expect(ran).toBe(false);
  });

  it("returns empty results and writes nothing when no steps are registered", async () => {
    const directory = manifestDirectory("steps-empty");
    await mkdir(directory, { mode: 0o700 });

    const result = await runLayoutSteps(directory, []);

    expect(result).toEqual({ completed: [], failed: [] });
    expect(await lstat(manifestPath(directory)).catch(() => null)).toBeNull();
  });
});
