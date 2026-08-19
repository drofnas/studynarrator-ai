import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  BackupRestoreError,
  listBackups,
  migrateDatabase,
  restoreDatabaseFromBackup,
  SchemaTooNewError,
  STUDYNARRATOR_MIGRATIONS,
  type DatabaseConstructor,
} from "./index.js";

const DatabaseAdapter = Database as unknown as DatabaseConstructor;
const ISO_STAMP = "2026-08-17T00-00-00-000Z";

function databasePathFor(prefix: string) {
  return join(
    tmpdir(),
    `studynarrator-${String(prefix)}-${String(process.pid)}-${String(Math.round(Math.random() * 1e9))}/studynarrator.sqlite`,
  );
}

async function createLiveDatabase(
  databasePath: string,
  value: string,
): Promise<void> {
  await mkdir(join(databasePath, ".."), { recursive: true });
  const live = new Database(databasePath);
  live.prepare("CREATE TABLE marker (value TEXT NOT NULL)").run();
  live.prepare("INSERT INTO marker (value) VALUES (?)").run(value);
  live.close();
}

async function readMarker(databasePath: string): Promise<string> {
  const inspection = new Database(databasePath, { readonly: true });
  const row = inspection.prepare("SELECT value FROM marker").get() as {
    value: string;
  };
  inspection.close();
  return row.value;
}

describe("restoreDatabaseFromBackup", () => {
  it("restores a verified backup and keeps the current database aside", async () => {
    const databasePath = databasePathFor("restore");
    const backupsDirectory = join(databasePath, "..", "backups");
    await createLiveDatabase(databasePath, "current");
    await mkdir(backupsDirectory, { recursive: true, mode: 0o700 });
    const backupPath = join(
      backupsDirectory,
      `studynarrator-v0001-to-v0002-${ISO_STAMP}.sqlite`,
    );
    await createLiveDatabase(backupPath, "backup");
    // Stale sidecar files must not survive the replace.
    await writeFile(`${databasePath}-wal`, "stale-wal");
    await writeFile(`${databasePath}-shm`, "stale-shm");

    const result = await restoreDatabaseFromBackup({
      Database: DatabaseAdapter,
      databasePath,
      backupPath,
    });

    expect(result.restoredFrom).toBe(backupPath);
    expect(result.safetyCopyPath.startsWith(backupsDirectory)).toBe(true);
    // The live database has no schema_migrations table, so its version falls
    // back to 0 in the name; the marker and version pair are both present.
    expect(result.safetyCopyPath).toMatch(
      /prerestore-v\d+-to-v\d+-[^/]+\.sqlite$/u,
    );
    expect(await readMarker(result.restoredFrom)).toBe("backup");
    expect(await readMarker(result.safetyCopyPath)).toBe("current");
    expect((await stat(result.safetyCopyPath)).mode & 0o777).toBe(0o600);
    expect((await stat(databasePath)).mode & 0o777).toBe(0o600);
    await expect(stat(`${databasePath}-wal`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(`${databasePath}-shm`)).rejects.toMatchObject({
      code: "ENOENT",
    });

    // Restoring again must never delete the earlier backup or earlier safety copy.
    const second = await restoreDatabaseFromBackup({
      Database: DatabaseAdapter,
      databasePath,
      backupPath,
    });
    expect(await readMarker(second.safetyCopyPath)).toBe("backup");
    expect(second.safetyCopyPath).toMatch(
      /prerestore-v\d+-to-v\d+-[^/]+\.sqlite$/u,
    );
    // Both safety copies are now discoverable in the backup listings and are
    // classified as pre-restore copies, not migrations. Newest first: the
    // second restore's copy is the most recent file.
    const backups = await listBackups(databasePath);
    expect(backups.map(({ path }) => path)).toEqual([
      second.safetyCopyPath,
      result.safetyCopyPath,
      backupPath,
    ]);
    const safetyCopies = backups.filter(
      ({ path }) =>
        path === result.safetyCopyPath || path === second.safetyCopyPath,
    );
    for (const copy of safetyCopies) {
      expect(copy.kind).toBe("prerestore");
    }
    expect(backups.find(({ path }) => path === backupPath)?.kind).toBe(
      "migration",
    );
    for (const retained of [
      backupPath,
      result.safetyCopyPath,
      second.safetyCopyPath,
    ]) {
      expect((await stat(retained)).size).toBeGreaterThan(0);
    }
  });

  it("refuses paths that escape the backups directory", async () => {
    const databasePath = databasePathFor("traversal");
    await createLiveDatabase(databasePath, "current");
    const outside = join(
      databasePath,
      "..",
      "..",
      `outside-${String(Math.round(Math.random() * 1e9))}.sqlite`,
    );
    await createLiveDatabase(outside, "outside");

    for (const candidate of [
      outside,
      join(databasePath, "backups", "..", "outside.sqlite"),
      join(databasePath, "other", "studynarrator.sqlite"),
      "/etc/passwd",
    ]) {
      await expect(
        restoreDatabaseFromBackup({
          Database: DatabaseAdapter,
          databasePath,
          backupPath: candidate,
        }),
      ).rejects.toBeInstanceOf(BackupRestoreError);
    }

    expect(await readMarker(databasePath)).toBe("current");
    expect(await readMarker(outside)).toBe("outside");
  });

  it("refuses missing, empty, and corrupted backups without touching the database", async () => {
    const databasePath = databasePathFor("corrupt");
    const backupsDirectory = join(databasePath, "..", "backups");
    await createLiveDatabase(databasePath, "current");
    await mkdir(backupsDirectory, { recursive: true, mode: 0o700 });
    const original = await readFile(databasePath);

    const missing = join(
      backupsDirectory,
      `studynarrator-v0001-to-v0002-${ISO_STAMP}-missing.sqlite`,
    );
    await expect(
      restoreDatabaseFromBackup({
        Database: DatabaseAdapter,
        databasePath,
        backupPath: missing,
      }),
    ).rejects.toBeInstanceOf(BackupRestoreError);

    const empty = join(
      backupsDirectory,
      `studynarrator-v0001-to-v0002-${ISO_STAMP}-empty.sqlite`,
    );
    await writeFile(empty, "");
    await expect(
      restoreDatabaseFromBackup({
        Database: DatabaseAdapter,
        databasePath,
        backupPath: empty,
      }),
    ).rejects.toBeInstanceOf(BackupRestoreError);

    const corrupted = join(
      backupsDirectory,
      `studynarrator-v0001-to-v0002-${ISO_STAMP}-corrupt.sqlite`,
    );
    await writeFile(corrupted, "not a sqlite database" + "x".repeat(1024));
    await expect(
      restoreDatabaseFromBackup({
        Database: DatabaseAdapter,
        databasePath,
        backupPath: corrupted,
      }),
    ).rejects.toBeInstanceOf(BackupRestoreError);

    expect(await readFile(databasePath)).toEqual(original);
    expect(await readMarker(databasePath)).toBe("current");
  });
});

describe("newer-schema databases", () => {
  it("throws SchemaTooNewError with backup context instead of migrating downward", async () => {
    const databasePath = databasePathFor("too-new");
    const migrated = await migrateDatabase({
      Database: DatabaseAdapter,
      databasePath,
    });
    const backupsDirectory = join(databasePath, "..", "backups");
    await mkdir(backupsDirectory, { recursive: true, mode: 0o700 });
    const backupPath = join(
      backupsDirectory,
      `studynarrator-v0003-to-v0004-${ISO_STAMP}.sqlite`,
    );
    // Checkpoint the WAL before copying, or the backup copy is incomplete.
    migrated.database.close();
    await copyFile(databasePath, backupPath);

    const newer = new Database(databasePath);
    newer
      .prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (99, '2026-08-17T00:00:00.000Z')",
      )
      .run();
    newer.close();

    let failure: unknown;
    try {
      await migrateDatabase({
        Database: DatabaseAdapter,
        databasePath,
        migrations: STUDYNARRATOR_MIGRATIONS,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SchemaTooNewError);
    const reported = failure as SchemaTooNewError;
    expect(reported.code).toBe("SCHEMA_TOO_NEW");
    expect(reported.databasePath).toBe(databasePath);
    expect(reported.databaseSchemaVersion).toBe(99);
    expect(reported.supportedSchemaVersion).toBe(3);
    expect(reported.backups.map(({ path }) => path)).toEqual([backupPath]);
    expect(reported.message).toContain("database format 99");
    expect(reported.message).toContain("supports format 3");

    // The data stays untouched and no migration ran.
    const inspected = new Database(databasePath, { readonly: true });
    expect(
      inspected
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get(),
    ).toEqual({ version: 99 });
    inspected.close();

    // A longer registry must never migrate the too-new row downward either;
    // it may advance forward from 99 if the registry is actually newer.
    const first = await restoreDatabaseFromBackup({
      Database: DatabaseAdapter,
      databasePath,
      backupPath,
    });
    expect(first).toMatchObject({ restoredFrom: backupPath });
    // The safety copy of the set-aside database is named after that database's
    // own schema version (99), not the backup's target version.
    expect(first.safetyCopyPath).toMatch(
      /studynarrator-prerestore-v0099-to-v0099-/u,
    );
    const restored = new Database(databasePath, { readonly: true });
    expect(
      restored
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get(),
    ).toEqual({ version: 3 });
    restored.close();
  });
});
