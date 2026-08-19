import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { DATABASE_SCHEMA_VERSION } from "@studynarrator/shared-types";
import { openStudyNarratorRepository } from "@studynarrator/persistence";
import {
  createDesktopServices,
  resolveDesktopDataDirectory,
} from "./bootstrap.js";

describe("desktop data directory", () => {
  it("resolves a relative configured directory from the initiating workspace", () => {
    expect(
      resolveDesktopDataDirectory("/default/data", {
        INIT_CWD: "/workspace/studynarrator",
        STUDYNARRATOR_DATA_DIR: ".tmp/dev/manual",
      }),
    ).toBe(resolve("/workspace/studynarrator/.tmp/dev/manual"));
  });
});

describe("desktop connection bootstrap", () => {
  it("ignores Speaches environment settings", async () => {
    const dataDirectory = await mkdtemp(
      join(tmpdir(), "studynarrator-desktop-"),
    );
    const runtime = await createDesktopServices({
      defaultDataDirectory: dataDirectory,
      environment: { SPEACHES_BASE_URL: "http://private-environment.invalid" },
    });
    try {
      if (!runtime.connection)
        throw new Error("Expected the desktop connection service.");
      expect(await runtime.connection.get()).toMatchObject({
        baseUrl: null,
        configured: false,
      });
    } finally {
      await runtime.dispose();
    }
  });
});

describe("desktop storage recovery", () => {
  it("surfaces a newer-schema database as SCHEMA_TOO_NEW and restores a backup", async () => {
    const dataDirectory = await mkdtemp(
      join(tmpdir(), "studynarrator-desktop-recovery-"),
    );
    const databasePath = join(dataDirectory, "studynarrator.sqlite");
    try {
      const opened = await openStudyNarratorRepository({
        Database,
        databasePath,
      });
      opened.close();

      const backupsDirectory = join(dataDirectory, "backups");
      await mkdir(backupsDirectory, { recursive: true, mode: 0o700 });
      const backupPath = join(
        backupsDirectory,
        `studynarrator-v${DATABASE_SCHEMA_VERSION}-to-v${DATABASE_SCHEMA_VERSION}-2026-08-18T00-00-00-000Z.sqlite`,
      );
      await copyFile(databasePath, backupPath);

      const newer = new Database(databasePath);
      newer
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (99, datetime('now'))",
        )
        .run();
      newer.close();

      const runtime = await createDesktopServices({
        defaultDataDirectory: dataDirectory,
        environment: {},
      });
      try {
        expect(await runtime.persistence.status()).toEqual(
          expect.objectContaining({
            state: "unavailable",
            code: "SCHEMA_TOO_NEW",
            databaseSchemaVersion: 99,
            targetDatabaseSchemaVersion: DATABASE_SCHEMA_VERSION,
            availableBackups: [
              expect.objectContaining({
                path: backupPath,
                fromVersion: DATABASE_SCHEMA_VERSION,
                sizeBytes: expect.any(Number) as number,
              }),
            ],
          }),
        );
        const backups = runtime.persistence.backups;
        if (!backups)
          throw new Error(
            "Expected the unavailable persistence service to expose backups.",
          );
        const restored = await backups.restore({ backupPath });
        expect(restored.restoredFrom).toBe(backupPath);
        expect(restored.safetyCopyPath).toMatch(/prerestore-/);

        const reopened = await openStudyNarratorRepository({
          Database,
          databasePath,
        });
        reopened.close();
      } finally {
        await runtime.dispose();
      }
    } finally {
      await rm(dataDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });
});
