import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const G01_MARKER_KEY = "g01.runtime-self-test";
export const G01_MARKER_VALUE = "study-narrator-g01";
export const CURRENT_MIGRATION_VERSION = 1;

interface StatementLike {
  run(...parameters: unknown[]): unknown;
  get(...parameters: unknown[]): unknown;
}

export interface DatabaseLike {
  exec(sql: string): unknown;
  pragma(source: string): unknown;
  prepare(sql: string): StatementLike;
  close(): void;
}

export interface DatabaseConstructor {
  new(path: string): DatabaseLike;
}

export interface MarkerEvidence {
  status: "pass";
  driver: "better-sqlite3";
  sqliteVersion: string;
  migrationVersion: 1;
  databasePath: string;
  markerKey: typeof G01_MARKER_KEY;
  markerValue: typeof G01_MARKER_VALUE;
  createdAt: string;
}

export interface DiagnosticRepositoryLike {
  runMarker(): MarkerEvidence;
  close(): void;
}

interface MarkerRow {
  key: string;
  value: string;
  created_at: string;
}

interface VersionRow {
  version: string;
}

export function createDiagnosticRepository(options: {
  Database: DatabaseConstructor;
  databasePath: string;
  now?: () => Date;
}) {
  mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  const database = new options.Database(options.databasePath);
  const now = options.now ?? (() => new Date());
  let closed = false;

  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");

  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS diagnostic_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    database.prepare(`
      INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (?, ?)
    `).run(CURRENT_MIGRATION_VERSION, now().toISOString());
    database.exec("COMMIT;");
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // The migration may have failed before SQLite opened a transaction.
    }
    database.close();
    throw error;
  }

  return {
    runMarker(): MarkerEvidence {
      if (closed) {
        throw new Error("Diagnostic repository is closed");
      }
      database.prepare(`
        INSERT OR IGNORE INTO diagnostic_kv (key, value, created_at)
        VALUES (?, ?, ?)
      `).run(G01_MARKER_KEY, G01_MARKER_VALUE, now().toISOString());

      const row = database.prepare("SELECT key, value, created_at FROM diagnostic_kv WHERE key = ?")
        .get(G01_MARKER_KEY) as MarkerRow | undefined;
      const version = database.prepare("SELECT sqlite_version() AS version").get() as VersionRow | undefined;

      if (!row || row.key !== G01_MARKER_KEY || row.value !== G01_MARKER_VALUE || !version?.version) {
        throw new Error("Diagnostic storage verification failed");
      }

      return {
        status: "pass",
        driver: "better-sqlite3",
        sqliteVersion: version.version,
        migrationVersion: CURRENT_MIGRATION_VERSION,
        databasePath: options.databasePath,
        markerKey: G01_MARKER_KEY,
        markerValue: G01_MARKER_VALUE,
        createdAt: row.created_at
      };
    },
    close() {
      if (!closed) {
        database.close();
        closed = true;
      }
    }
  };
}

export function createLazyDiagnosticRepository(
  factory: () => DiagnosticRepositoryLike
): DiagnosticRepositoryLike {
  let repository: DiagnosticRepositoryLike | undefined;
  return {
    runMarker() {
      repository ??= factory();
      return repository.runMarker();
    },
    close() {
      repository?.close();
      repository = undefined;
    }
  };
}
