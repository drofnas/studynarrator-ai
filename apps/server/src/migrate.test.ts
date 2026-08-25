import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDataDirectory, runMigrationCommand } from "./migrate.js";

describe("db:migrate command", () => {
  it("requires one explicit data directory", () => {
    expect(() => parseDataDirectory([])).toThrow("--data-dir");
    expect(() =>
      parseDataDirectory(["--data-dir", "/tmp/one", "extra"]),
    ).toThrow("--data-dir");
  });

  it("reports applied and current versions without project content", async () => {
    const dataDirectory = mkdtempSync(
      join(tmpdir(), "studynarrator-migrate-command-"),
    );
    const first = await runMigrationCommand(["--data-dir", dataDirectory]);
    expect(first).toMatchObject({
      state: "ready",
      databaseSchemaVersion: 11,
      appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      backupPath: null,
    });
    const second = await runMigrationCommand(["--data-dir", dataDirectory]);
    expect(second).toMatchObject({
      databaseSchemaVersion: 11,
      appliedVersions: [],
    });
    expect(JSON.stringify(second)).not.toContain("scriptSource");
  });
});
