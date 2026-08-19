import { chmod, copyFile, rename, rm, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { BackupRestoreError } from "./errors.js";
import type { DatabaseConstructor, DatabaseLike } from "./migrations.js";

interface BackupRestoreResult {
  restoredFrom: string;
  safetyCopyPath: string;
}

/**
 * Resolve `backupPath` and assert it lives inside `<dirname(databasePath)>/backups/`.
 * This is a path-traversal guard: restore must never read an arbitrary filesystem path.
 */
function assertInsideBackupsDirectory(
  databasePath: string,
  backupPath: string,
): string {
  const backupsDirectory = resolve(dirname(databasePath), "backups");
  const candidate = resolve(backupPath);
  const inside = relative(backupsDirectory, candidate);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside))
    throw new BackupRestoreError(
      "The selected backup is not part of this data directory.",
    );
  return candidate;
}

function assertBackupIntegrity(
  Database: DatabaseConstructor,
  backupPath: string,
): void {
  let database: DatabaseLike | undefined;
  try {
    database = new Database(backupPath, {
      readonly: true,
      fileMustExist: true,
    });
    const row = database.prepare("PRAGMA integrity_check;").get() as
      { integrity_check: string } | undefined;
    if (row?.integrity_check !== "ok")
      throw new BackupRestoreError(
        "The selected backup failed its integrity check and was not restored.",
      );
  } catch (error) {
    if (error instanceof BackupRestoreError) throw error;
    throw new BackupRestoreError(
      "The selected backup could not be verified and was not restored.",
    );
  } finally {
    database?.close();
  }
}

/**
 * Read the schema version of the database about to be set aside so a safety
 * copy can be named like the other backups in the directory. A database with
 * no readable `schema_migrations` table (or that cannot be opened) reports 0;
 * naming is bookkeeping and must never make a restore fail.
 */
function currentSchemaVersion(
  Database: DatabaseConstructor,
  databasePath: string,
): number {
  let database: DatabaseLike | undefined;
  try {
    database = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    const row = database
      .prepare(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
      )
      .get() as { version: number | null } | undefined;
    return typeof row?.version === "number" ? row.version : 0;
  } catch {
    return 0;
  } finally {
    database?.close();
  }
}

/**
 * Replace `databasePath` with a verified backup from its sibling `backups/`
 * directory. The current database is copied aside first so the restore itself
 * is reversible, and stale WAL/SHM sidecar files are removed so the replaced
 * file cannot be corrupted. The database must not be open while this runs.
 */
export async function restoreDatabaseFromBackup(options: {
  Database: DatabaseConstructor;
  databasePath: string;
  backupPath: string;
}): Promise<BackupRestoreResult> {
  const backupPath = assertInsideBackupsDirectory(
    options.databasePath,
    options.backupPath,
  );

  let backupStats;
  try {
    backupStats = await stat(backupPath);
  } catch {
    throw new BackupRestoreError(
      "The selected backup is missing and was not restored.",
    );
  }
  if (!backupStats.isFile() || backupStats.size === 0)
    throw new BackupRestoreError(
      "The selected backup is empty and was not restored.",
    );

  assertBackupIntegrity(options.Database, backupPath);

  const databasePath = resolve(options.databasePath);
  const currentStats = await stat(databasePath);
  if (!currentStats.isFile())
    throw new BackupRestoreError(
      "StudyNarrator could not preserve the current database before restoring.",
    );
  const version = currentSchemaVersion(options.Database, databasePath);
  const paddedVersion = String(version).padStart(4, "0");
  const stem = basename(databasePath, extname(databasePath));
  const extension = extname(databasePath) || ".sqlite";
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const safetyCopyPath = join(
    dirname(databasePath),
    "backups",
    `${stem}-prerestore-v${paddedVersion}-to-v${paddedVersion}-${timestamp}${extension}`,
  );
  await copyFile(databasePath, safetyCopyPath);
  await chmod(safetyCopyPath, 0o600);

  // Write beside the target and rename, so an interrupted restore can never
  // leave a truncated database in place. Both paths are in the same directory,
  // which keeps the rename atomic.
  const stagingPath = `${databasePath}.restore-${process.pid.toString()}.tmp`;
  try {
    await copyFile(backupPath, stagingPath);
    await chmod(stagingPath, 0o600);
    await rename(stagingPath, databasePath);
  } catch (error) {
    await rm(stagingPath, { force: true });
    throw error;
  }

  // A stale write-ahead log next to a replaced database file causes corruption.
  await rm(`${databasePath}-wal`, { force: true });
  await rm(`${databasePath}-shm`, { force: true });

  return { restoredFrom: backupPath, safetyCopyPath };
}
