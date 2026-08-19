import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATABASE_SCHEMA_VERSION } from "@studynarrator/shared-types";
import { createServerServices } from "@studynarrator/server/bootstrap";
import type { Page } from "@playwright/test";
import {
  continueOffline,
  expect,
  test as baseTest,
  type StudyNarratorSetup,
} from "../support/studyNarratorTest.js";

const GOOD_BACKUP_STAMP = "2026-08-17T12-00-00-000Z";
const CORRUPT_BACKUP_STAMP = "2026-08-16T08-00-00-000Z";

function recoveryPaths(dataDirectory: string) {
  const databasePath = join(dataDirectory, "studynarrator.sqlite");
  const backupsDirectory = join(dataDirectory, "backups");
  return {
    databasePath,
    backupsDirectory,
    goodBackupPath: join(
      backupsDirectory,
      `studynarrator-v${String(DATABASE_SCHEMA_VERSION)}-to-v${String(DATABASE_SCHEMA_VERSION)}-${GOOD_BACKUP_STAMP}.sqlite`,
    ),
    corruptBackupPath: join(
      backupsDirectory,
      `studynarrator-v${String(DATABASE_SCHEMA_VERSION)}-to-v${String(DATABASE_SCHEMA_VERSION)}-${CORRUPT_BACKUP_STAMP}.sqlite`,
    ),
  };
}

function readMaximumSchemaVersion(databasePath: string): number {
  const connection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = connection
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get() as { version: number | null };
    return row.version ?? 0;
  } finally {
    connection.close();
  }
}

function recoveryHeading(page: Page) {
  return page.getByRole("heading", {
    name: "study-narrator storage is unavailable",
  });
}

const test = baseTest.extend({
  studyNarratorSetup: async (
    { studyNarratorEnvironment: _environment },
    use,
  ) => {
    await use(async (setup: StudyNarratorSetup) => {
      const {
        databasePath,
        backupsDirectory,
        goodBackupPath,
        corruptBackupPath,
      } = recoveryPaths(setup.dataDirectory);
      // Create a genuine current-schema database with the production bootstrap
      // so the staged backup is a real, restorable file.
      const primingServices = await createServerServices(setup.environment);
      await primingServices.dispose();
      await mkdir(backupsDirectory, { recursive: true });
      await copyFile(databasePath, goodBackupPath);
      await writeFile(
        corruptBackupPath,
        "this file is not a valid study-narrator database",
      );
      // Downgrade scenario: the live database now claims a schema from a
      // newer version than this build supports.
      const connection = new DatabaseSync(databasePath);
      try {
        connection
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (99, datetime('now'))",
          )
          .run();
      } finally {
        connection.close();
      }
    });
  },
});

test.describe("database recovery after a downgrade", () => {
  test("offers the local backups and the install-newer alternative instead of the app", async ({
    page,
    studyNarrator,
  }) => {
    await page.goto(`${studyNarrator.baseUrl}/#/projects`);
    await expect(recoveryHeading(page)).toBeVisible();
    await expect(
      page.getByText(/newer version of study-narrator/i).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: GOOD_BACKUP_STAMP }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Restore from this backup" }).first(),
    ).toBeVisible();
    // The normal application must not take over while storage is unusable.
    await expect(
      page.getByRole("heading", { name: "Projects", exact: true }),
    ).toBeHidden();
  });

  test("cancelling the restore dialog leaves the live database untouched", async ({
    page,
    studyNarrator,
  }) => {
    await page.goto(`${studyNarrator.baseUrl}/#/projects`);
    await expect(recoveryHeading(page)).toBeVisible();
    await page
      .getByRole("button", { name: "Restore from this backup" })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(recoveryHeading(page)).toBeVisible();

    const { databasePath, backupsDirectory } = recoveryPaths(
      studyNarrator.dataDirectory,
    );
    expect(readMaximumSchemaVersion(databasePath)).toBe(99);
    expect(
      (await readdir(backupsDirectory)).some((name) =>
        name.includes("-prerestore-"),
      ),
    ).toBe(false);
  });

  test("restores the valid backup, keeps a safety copy, and restarts into an operational app", async ({
    page,
    studyNarrator,
  }) => {
    await page.goto(`${studyNarrator.baseUrl}/#/projects`);
    await expect(recoveryHeading(page)).toBeVisible();
    const goodRow = page
      .getByRole("row")
      .filter({ hasText: GOOD_BACKUP_STAMP });
    await goodRow
      .getByRole("button", { name: "Restore from this backup" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Restore backup" }).click();

    await expect(
      page.getByRole("heading", { name: "Backup restored" }),
    ).toBeVisible();
    await expect(
      page.locator("code", { hasText: /prerestore-/ }),
    ).toBeVisible();

    const { databasePath, backupsDirectory, goodBackupPath } = recoveryPaths(
      studyNarrator.dataDirectory,
    );
    // The live database is the restored (current-schema) file again, and the
    // pre-restore safety copy is preserved.
    expect(readMaximumSchemaVersion(databasePath)).not.toBe(99);
    const safetyCopies = (await readdir(backupsDirectory)).filter((name) =>
      name.includes("-prerestore-"),
    );
    expect(safetyCopies).toHaveLength(1);
    expect(
      (await readdir(backupsDirectory)).includes(
        goodBackupPath.split("/").pop() as string,
      ),
    ).toBe(true);

    // Restarting the application against the same storage opens it normally:
    // the app renders and the persistence contract reports ready.
    await studyNarrator.restart();
    await page.goto(`${studyNarrator.baseUrl}/#/projects`);
    await continueOffline(page, studyNarrator);
    await expect(
      page.getByRole("heading", { name: "Projects", exact: true }),
    ).toBeVisible();
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/persistence/status");
      return {
        ok: response.ok,
        state: ((await response.json()) as { state: string }).state,
      };
    });
    expect(status.ok).toBe(true);
    expect(status.state).toBe("ready");
  });

  test("reports an unusable backup failure without touching the live database", async ({
    page,
    studyNarrator,
  }) => {
    await page.goto(`${studyNarrator.baseUrl}/#/projects`);
    await expect(recoveryHeading(page)).toBeVisible();
    const corruptRow = page
      .getByRole("row")
      .filter({ hasText: CORRUPT_BACKUP_STAMP });
    await expect(corruptRow).toBeVisible();
    await corruptRow
      .getByRole("button", { name: "Restore from this backup" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Restore backup" }).click();

    await expect(page.getByRole("alert")).toContainText(
      /backup.*(not restored|could not be verified|integrity)/i,
    );

    const { databasePath, backupsDirectory } = recoveryPaths(
      studyNarrator.dataDirectory,
    );
    expect(readMaximumSchemaVersion(databasePath)).toBe(99);
    expect(
      (await readdir(backupsDirectory)).some((name) =>
        name.includes("-prerestore-"),
      ),
    ).toBe(false);
    await expect(
      page.getByRole("button", { name: "Restore from this backup" }).first(),
    ).toBeEnabled();
  });
});
