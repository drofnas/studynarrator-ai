import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { PersistenceLogger } from "./migrations.js";

/**
 * Format tag of the manifest file itself.
 */
export const DATA_DIRECTORY_MANIFEST_VERSION = 1 as const;

/**
 * Data directory layout this build understands. Layout steps (task 10.2)
 * record completion against this version; a manifest whose layout is newer
 * is refused with `LayoutTooNewError` rather than migrated downward.
 */
export const DATA_DIRECTORY_LAYOUT_VERSION = 2;

const TimestampSchema = z.iso.datetime({ offset: true });

const DataDirectoryManifestSchema = z
  .object({
    manifestVersion: z.literal(DATA_DIRECTORY_MANIFEST_VERSION),
    appVersion: z.string().min(1).max(100),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    layoutVersion: z.number().int().positive(),
    completedSteps: z.array(z.string().min(1).max(200)).max(1_000),
  })
  .strict();

export type DataDirectoryManifest = z.infer<typeof DataDirectoryManifestSchema>;

/**
 * A one-time data directory layout step (task 10.4 registers the first
 * real steps). `id` is recorded in the manifest exactly once, after a
 * successful `run`; a step that throws is never recorded, so it retries
 * on the next launch.
 */
export interface LayoutStep {
  id: string;
  targetLayoutVersion?: number;
  run(dataDirectory: string): Promise<void>;
}

export class LayoutTooNewError extends Error {
  readonly code = "LAYOUT_TOO_NEW";

  constructor(
    readonly dataDirectory: string,
    readonly manifestLayoutVersion: number,
    readonly supportedLayoutVersion: number,
  ) {
    super(
      `This data was created by a newer version of StudyNarrator (data layout ${String(manifestLayoutVersion)}). ` +
        `This version supports data layout ${String(supportedLayoutVersion)}.`,
    );
  }
}

const MANIFEST_FILE_NAME = "manifest.json";
const MANIFEST_TEMPORARY_FILE_NAME = "manifest.json.tmp";

/**
 * Parse the existing manifest, or report `null` when the directory has
 * none yet. A manifest whose layout this build does not support throws
 * `LayoutTooNewError` and is never modified.
 */
async function loadManifest(
  dataDirectory: string,
): Promise<DataDirectoryManifest | null> {
  let rawManifest: string;
  try {
    rawManifest = await readFile(
      join(dataDirectory, MANIFEST_FILE_NAME),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawManifest);
  } catch (error) {
    throw new Error(
      "The data directory manifest is not valid JSON and could not be read.",
      { cause: error },
    );
  }
  const manifest = DataDirectoryManifestSchema.parse(decoded);
  if (manifest.layoutVersion > DATA_DIRECTORY_LAYOUT_VERSION) {
    throw new LayoutTooNewError(
      dataDirectory,
      manifest.layoutVersion,
      DATA_DIRECTORY_LAYOUT_VERSION,
    );
  }
  return manifest;
}

async function atomicWriteManifestFile(
  dataDirectory: string,
  manifest: DataDirectoryManifest,
): Promise<void> {
  const temporaryPath = join(dataDirectory, MANIFEST_TEMPORARY_FILE_NAME);
  const manifestPath = join(dataDirectory, MANIFEST_FILE_NAME);
  // `wx` refuses to overwrite a leftover tmp file from a crashed writer
  // instead of silently clobbering its in-flight bytes.
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  try {
    await rename(temporaryPath, manifestPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

/**
 * Validate and atomically replace `<dataDirectory>/manifest.json`
 * (write `manifest.json.tmp`, then rename — the G6 pattern). Never writes
 * user preferences or connection settings: layout bookkeeping only.
 */
export async function writeDataDirectoryManifest(
  dataDirectory: string,
  manifest: DataDirectoryManifest,
): Promise<void> {
  const parsed = DataDirectoryManifestSchema.parse(manifest);
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  await atomicWriteManifestFile(dataDirectory, parsed);
}

/**
 * Read, create, or refresh the data directory manifest.
 *
 * - Missing manifest: a pre-manifest installation (the directory already
 *   holds `studynarrator.sqlite`) is not treated as new — like a fresh
 *   empty directory it simply gets a manifest carrying the current
 *   `layoutVersion` and an empty `completedSteps`.
 * - Readable manifest: `appVersion` and `updatedAt` are refreshed to the
 *   injected values and the file is rewritten; `createdAt`,
 *   `layoutVersion`, and `completedSteps` are preserved.
 * - `layoutVersion` newer than this build throws `LayoutTooNewError` and
 *   leaves the file untouched.
 *
 * `appVersion` is injected by the caller (server or desktop bootstrap); it
 * is never read from `package.json`. `now` defaults to `Date` for tests.
 */
export async function readDataDirectoryManifest(
  dataDirectory: string,
  options: { appVersion: string; now?: () => Date },
): Promise<DataDirectoryManifest> {
  const now = options.now ?? (() => new Date());
  const existing = await loadManifest(dataDirectory);
  if (existing === null) {
    const stamp = now().toISOString();
    const manifest: DataDirectoryManifest = {
      manifestVersion: DATA_DIRECTORY_MANIFEST_VERSION,
      appVersion: options.appVersion,
      createdAt: stamp,
      updatedAt: stamp,
      layoutVersion: DATA_DIRECTORY_LAYOUT_VERSION,
      completedSteps: [],
    };
    await writeDataDirectoryManifest(dataDirectory, manifest);
    return manifest;
  }
  const updated: DataDirectoryManifest = {
    ...existing,
    appVersion: options.appVersion,
    updatedAt: now().toISOString(),
  };
  await writeDataDirectoryManifest(dataDirectory, updated);
  return updated;
}

/**
 * Run one-time layout steps in array order against the data directory.
 *
 * - A step already in `completedSteps` is skipped.
 * - A step that succeeds is appended to `completedSteps` and the manifest
 *   is rewritten before the next step runs, so a crash loses at most the
 *   step in flight (which simply retries next launch).
 * - A step that throws is caught and collected in `failed`, and is NOT
 *   recorded; it must never prevent the application from starting, and it
 *   retries on the next launch.
 *
 * Only a manifest whose layout this build does not support is a genuine
 * blocker (`LayoutTooNewError`); callers must surface that state.
 */
export async function runLayoutSteps(
  dataDirectory: string,
  steps: readonly LayoutStep[],
  options: { logger?: PersistenceLogger } = {},
): Promise<{
  completed: string[];
  failed: { id: string; error: unknown }[];
}> {
  const manifest = await loadManifest(dataDirectory);
  const completedSteps = [...(manifest?.completedSteps ?? [])];
  const completed: string[] = [];
  const failed: { id: string; error: unknown }[] = [];
  for (const step of steps) {
    if (completedSteps.includes(step.id)) {
      options.logger?.info(
        {
          event: "data-directory-layout-step",
          layoutStepId: step.id,
          outcome: "skipped",
        },
        "Data directory layout step skipped",
      );
      continue;
    }
    try {
      await step.run(dataDirectory);
    } catch (error) {
      failed.push({ id: step.id, error });
      options.logger?.warn(
        {
          event: "data-directory-layout-step",
          layoutStepId: step.id,
          outcome: "failed",
          err: error,
        },
        "Data directory layout step failed",
      );
      continue;
    }
    completedSteps.push(step.id);
    const stamp = new Date().toISOString();
    await writeDataDirectoryManifest(dataDirectory, {
      manifestVersion: DATA_DIRECTORY_MANIFEST_VERSION,
      // A missing manifest here means the bootstrap read was skipped; the
      // next readDataDirectoryManifest refreshes the version on startup.
      appVersion: manifest?.appVersion ?? "unknown",
      createdAt: manifest?.createdAt ?? stamp,
      updatedAt: stamp,
      layoutVersion: Math.max(
        manifest?.layoutVersion ?? DATA_DIRECTORY_LAYOUT_VERSION,
        step.targetLayoutVersion ?? 1,
      ),
      completedSteps,
    });
    completed.push(step.id);
    options.logger?.info(
      {
        event: "data-directory-layout-step",
        layoutStepId: step.id,
        outcome: "completed",
      },
      "Data directory layout step completed",
    );
  }
  return { completed, failed };
}
