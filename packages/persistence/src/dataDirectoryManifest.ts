import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * Format tag of the manifest file itself.
 */
export const DATA_DIRECTORY_MANIFEST_VERSION = 1 as const;

/**
 * Data directory layout this build understands. Layout steps (task 10.2)
 * record completion against this version; a manifest whose layout is newer
 * is refused with `LayoutTooNewError` rather than migrated downward.
 */
export const DATA_DIRECTORY_LAYOUT_VERSION = 1;

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
  const manifestPath = join(dataDirectory, MANIFEST_FILE_NAME);
  let rawManifest: string | null;
  try {
    rawManifest = await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    rawManifest = null;
  }
  if (rawManifest === null) {
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
  const updated: DataDirectoryManifest = {
    ...manifest,
    appVersion: options.appVersion,
    updatedAt: now().toISOString(),
  };
  await writeDataDirectoryManifest(dataDirectory, updated);
  return updated;
}
