import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ProjectSnapshotSchema,
  RenderIdSchema,
  RenderPlanSchema,
  type ProjectSnapshot,
  type RenderPlan,
  type SilenceAsset,
} from "@studynarrator/shared-types";

export const RENDER_PLAN_SAMPLE_RATE = 24_000;
export const RENDER_PLAN_CHANNELS = 1;
export const RENDER_PLAN_BITS_PER_SAMPLE = 16;
const MAX_RENDER_PLAN_JSON_BYTES = 12 * 1024 * 1024;

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function missing(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

type ProjectSnapshotWithoutHash = ProjectSnapshot extends infer T
  ? T extends { snapshotHash: string }
    ? Omit<T, "snapshotHash">
    : never
  : never;

export function withProjectSnapshotHash(
  input: ProjectSnapshotWithoutHash,
): ProjectSnapshot {
  const normalized = ProjectSnapshotSchema.parse({
    ...input,
    snapshotHash: "0".repeat(64),
  });
  const { snapshotHash: _snapshotHash, ...payload } = normalized;
  void _snapshotHash;
  return ProjectSnapshotSchema.parse({
    ...payload,
    snapshotHash: hashJson(payload),
  });
}

export function withRenderPlanHash(
  input: Omit<RenderPlan, "planHash">,
): RenderPlan {
  const normalized = RenderPlanSchema.parse({
    ...input,
    planHash: "0".repeat(64),
  });
  const { planHash: _planHash, ...payload } = normalized;
  void _planHash;
  return RenderPlanSchema.parse({ ...payload, planHash: hashJson(payload) });
}

export function createPcmSilence(durationMs: number): {
  bytes: Uint8Array | null;
  asset: SilenceAsset | null;
} {
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 30_000)
    throw new Error(
      "Silence duration must be an integer from 0 through 30000 milliseconds.",
    );
  if (durationMs === 0) return { bytes: null, asset: null };
  const frameCount = (RENDER_PLAN_SAMPLE_RATE * durationMs) / 1_000;
  const dataLength =
    frameCount * RENDER_PLAN_CHANNELS * (RENDER_PLAN_BITS_PER_SAMPLE / 8);
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      bytes[offset + index] = value.charCodeAt(index);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, RENDER_PLAN_CHANNELS, true);
  view.setUint32(24, RENDER_PLAN_SAMPLE_RATE, true);
  view.setUint32(
    28,
    RENDER_PLAN_SAMPLE_RATE *
      RENDER_PLAN_CHANNELS *
      (RENDER_PLAN_BITS_PER_SAMPLE / 8),
    true,
  );
  view.setUint16(
    32,
    RENDER_PLAN_CHANNELS * (RENDER_PLAN_BITS_PER_SAMPLE / 8),
    true,
  );
  view.setUint16(34, RENDER_PLAN_BITS_PER_SAMPLE, true);
  ascii(36, "data");
  view.setUint32(40, dataLength, true);
  const checksum = sha256(bytes);
  return {
    bytes,
    asset: {
      relativePath: `silence/${checksum}.wav`,
      checksum,
      byteLength: bytes.byteLength,
      sampleRate: RENDER_PLAN_SAMPLE_RATE,
      channels: RENDER_PLAN_CHANNELS,
      bitsPerSample: RENDER_PLAN_BITS_PER_SAMPLE,
      frameCount,
    },
  };
}

export interface RenderPlanStore {
  /** Freezes the computed plan, snapshot, and silence assets as an immutable per-render job snapshot. */
  snapshotJob(
    renderId: string,
    snapshot: ProjectSnapshot,
    plan: RenderPlan,
    silenceAssets: ReadonlyMap<string, Uint8Array>,
  ): Promise<void>;
  /** Copies an established job snapshot into a new job directory, reusing the identical silence bytes. */
  cloneJobSnapshot(renderId: string, sourceRenderId: string): Promise<void>;
  loadJob(renderId: string): Promise<{
    snapshot: ProjectSnapshot;
    plan: RenderPlan;
    silenceAssets: ReadonlyMap<string, Uint8Array>;
  }>;
}

function verifiedSnapshotHash(snapshot: ProjectSnapshot): boolean {
  const { snapshotHash, ...payload } = snapshot;
  return snapshotHash === hashJson(payload);
}

function verifiedPlanHash(plan: RenderPlan): boolean {
  const { planHash, ...payload } = plan;
  return planHash === hashJson(payload);
}

async function boundedRead(
  path: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size < 1 || details.size > maximumBytes)
      throw new Error("Render plan artifact size is invalid.");
    const bytes = new Uint8Array(details.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (bytesRead === 0)
        throw new Error("Render plan artifact was truncated.");
      offset += bytesRead;
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function boundedJson(path: string): Promise<unknown> {
  const text = new TextDecoder().decode(
    await boundedRead(path, MAX_RENDER_PLAN_JSON_BYTES),
  );
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error("The render plan store document is not valid JSON.", {
      cause: error,
    });
  }
}

export function createRenderPlanStore(
  rootDirectoryInput: string,
): RenderPlanStore {
  const rootDirectory = resolve(rootDirectoryInput);
  if (!rootDirectoryInput.trim() || rootDirectory === resolve("/"))
    throw new Error("Render plan root must be a scoped directory.");

  const ensureRoot = async () => {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
    const root = await lstat(rootDirectory);
    if (!root.isDirectory() || root.isSymbolicLink())
      throw new Error("Render plan root must be a real directory.");
    await chmod(rootDirectory, 0o700);
  };

  const jobsDirectory = join(rootDirectory, ".jobs");
  const readBundleAt = async (
    directory: string,
    expectedPlanId?: string,
  ): Promise<{ snapshot: ProjectSnapshot; plan: RenderPlan }> => {
    const details = await lstat(directory);
    if (!details.isDirectory() || details.isSymbolicLink())
      throw new Error("Render plan directory is unsafe.");
    const snapshot = ProjectSnapshotSchema.parse(
      await boundedJson(join(directory, "project-snapshot.json")),
    );
    const plan = RenderPlanSchema.parse(
      await boundedJson(join(directory, "render-plan.json")),
    );
    if (
      (expectedPlanId !== undefined && plan.id !== expectedPlanId) ||
      snapshot.project.id !== plan.projectId ||
      snapshot.project.scriptHash !== plan.scriptHash ||
      snapshot.snapshotHash !== plan.snapshotHash ||
      !verifiedSnapshotHash(snapshot) ||
      !verifiedPlanHash(plan)
    )
      throw new Error("Render plan hashes are inconsistent.");
    const silenceDirectory = join(directory, "silence");
    const silenceEntries = plan.entries.filter(
      (entry) => entry.type === "pause" && entry.silence !== null,
    );
    if (silenceEntries.length > 0) {
      const silenceDetails = await lstat(silenceDirectory);
      if (!silenceDetails.isDirectory() || silenceDetails.isSymbolicLink())
        throw new Error("Render plan silence directory is unsafe.");
    }
    for (const entry of silenceEntries) {
      const asset = entry.type === "pause" ? entry.silence : null;
      if (!asset) continue;
      const bytes = await boundedRead(
        join(directory, asset.relativePath),
        asset.byteLength,
      );
      if (
        bytes.byteLength !== asset.byteLength ||
        sha256(bytes) !== asset.checksum
      )
        throw new Error("Render plan silence checksum is invalid.");
    }
    return { snapshot, plan };
  };
  const writeBundle = async (
    directory: string,
    snapshot: ProjectSnapshot,
    plan: RenderPlan,
    silenceAssets: ReadonlyMap<string, Uint8Array>,
  ) => {
    const parent = resolve(directory, "..");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporaryDirectory = join(parent, `${plan.id}.${randomUUID()}.tmp`);
    const backupDirectory = `${directory}.${randomUUID()}.backup`;
    let backedUp = false;
    try {
      await mkdir(temporaryDirectory, { mode: 0o700 });
      await mkdir(join(temporaryDirectory, "silence"), { mode: 0o700 });
      await writeFile(
        join(temporaryDirectory, "project-snapshot.json"),
        `${JSON.stringify(snapshot, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await writeFile(
        join(temporaryDirectory, "render-plan.json"),
        `${JSON.stringify(plan, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      const expected = new Map(
        plan.entries.flatMap((entry) =>
          entry.type === "pause" && entry.silence
            ? [[entry.silence.checksum, entry.silence] as const]
            : [],
        ),
      );
      for (const [checksum, asset] of expected) {
        const bytes = silenceAssets.get(checksum);
        if (
          !bytes ||
          bytes.byteLength !== asset.byteLength ||
          sha256(bytes) !== checksum
        )
          throw new Error(
            "Render plan silence bytes do not match the manifest.",
          );
        await writeFile(join(temporaryDirectory, asset.relativePath), bytes, {
          mode: 0o600,
          flag: "wx",
        });
      }
      if (!(await missing(directory))) {
        await rename(directory, backupDirectory);
        backedUp = true;
      }
      await rename(temporaryDirectory, directory);
      if (backedUp) await rm(backupDirectory, { recursive: true });
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
      if (backedUp && (await missing(directory)))
        await rename(backupDirectory, directory).catch(() => undefined);
      throw error;
    }
  };

  return {
    async snapshotJob(renderIdInput, snapshotInput, planInput, silenceAssets) {
      const renderId = RenderIdSchema.parse(renderIdInput);
      const snapshot = ProjectSnapshotSchema.parse(snapshotInput);
      const plan = RenderPlanSchema.parse(planInput);
      if (
        !verifiedSnapshotHash(snapshot) ||
        !verifiedPlanHash(plan) ||
        snapshot.snapshotHash !== plan.snapshotHash ||
        snapshot.project.id !== plan.projectId ||
        snapshot.project.scriptHash !== plan.scriptHash
      ) {
        throw new Error(
          "Render plan snapshot cannot be frozen with inconsistent hashes.",
        );
      }
      await ensureRoot();
      await writeBundle(
        join(jobsDirectory, renderId),
        snapshot,
        plan,
        silenceAssets,
      );
    },
    async cloneJobSnapshot(renderIdInput, sourceRenderIdInput) {
      const renderId = RenderIdSchema.parse(renderIdInput);
      const loaded = await this.loadJob(
        RenderIdSchema.parse(sourceRenderIdInput),
      );
      await writeBundle(
        join(jobsDirectory, renderId),
        loaded.snapshot,
        loaded.plan,
        loaded.silenceAssets,
      );
    },
    async loadJob(renderIdInput) {
      const renderId = RenderIdSchema.parse(renderIdInput);
      const bundle = await readBundleAt(join(jobsDirectory, renderId));
      const directory = join(jobsDirectory, renderId);
      const silenceAssets = new Map<string, Uint8Array>();
      for (const entry of bundle.plan.entries) {
        if (
          entry.type !== "pause" ||
          !entry.silence ||
          silenceAssets.has(entry.silence.checksum)
        )
          continue;
        silenceAssets.set(
          entry.silence.checksum,
          await boundedRead(
            join(directory, entry.silence.relativePath),
            entry.silence.byteLength,
          ),
        );
      }
      return { ...bundle, silenceAssets };
    },
  };
}
