import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createDiagnosticRepository, createLazyDiagnosticRepository } from "./index.js";

describe("createDiagnosticRepository", () => {
  it("runs migration 1 idempotently and preserves the marker across reopen", () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "studynarrator-g01-")), "app.sqlite");
    const first = createDiagnosticRepository({
      Database,
      databasePath,
      now: () => new Date("2026-08-11T12:00:00.000Z")
    });
    const original = first.runMarker();
    first.close();

    const second = createDiagnosticRepository({
      Database,
      databasePath,
      now: () => new Date("2026-08-12T12:00:00.000Z")
    });
    const reopened = second.runMarker();
    second.close();

    expect(reopened.createdAt).toBe(original.createdAt);
    expect(reopened.markerValue).toBe("study-narrator-g01");

    const inspection = new Database(databasePath, { readonly: true });
    expect(inspection.prepare("SELECT count(*) AS count FROM schema_migrations WHERE version = 1").get())
      .toEqual({ count: 1 });
    inspection.close();
  });

  it("defers database creation until diagnostics run", () => {
    let factoryCalls = 0;
    const repository = createLazyDiagnosticRepository(() => {
      factoryCalls += 1;
      throw new Error("unwritable directory");
    });
    expect(factoryCalls).toBe(0);
    expect(() => repository.runMarker()).toThrow("unwritable directory");
    expect(factoryCalls).toBe(1);
    repository.close();
  });
});
