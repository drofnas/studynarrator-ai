import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  APPLICATION_VERSION,
  DATABASE_SCHEMA_VERSION,
} from "@studynarrator/shared-types";
import {
  DATA_DIRECTORY_LAYOUT_VERSION,
  openStudyNarratorRepository,
} from "@studynarrator/persistence";
import {
  createServerServices,
  resolveServerDataDirectory,
} from "./bootstrap.js";
import { resolveServerRuntimeConfiguration } from "./runtimeConfig.js";

describe("server data directory manifest", () => {
  it("records a fresh manifest and does not grow layout steps across launches", async () => {
    const dataDirectory = await mkdtemp(
      join(tmpdir(), "studynarrator-server-manifest-"),
    );
    try {
      for (let launch = 1; launch <= 2; launch += 1) {
        const services = await createServerServices({
          STUDYNARRATOR_DATA_DIR: dataDirectory,
        });
        try {
          expect(
            JSON.parse(
              await readFile(join(dataDirectory, "manifest.json"), "utf8"),
            ),
          ).toMatchObject({
            manifestVersion: 1,
            appVersion: APPLICATION_VERSION,
            layoutVersion: DATA_DIRECTORY_LAYOUT_VERSION,
            completedSteps: [
              "remove-standalone-render-plans",
              "sweep-unreadable-cache-entries",
              "remove-legacy-render-provenance",
            ],
          });
        } finally {
          await services.dispose();
        }
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

  it("writes one structured startup event to the data directory log", async () => {
    const dataDirectory = await mkdtemp(
      join(tmpdir(), "studynarrator-server-log-"),
    );
    try {
      const services = await createServerServices({
        STUDYNARRATOR_DATA_DIR: dataDirectory,
      });
      await services.dispose();

      const entries = (
        await readFile(join(dataDirectory, "logs", "studynarrator.log"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(
        entries.filter(({ event }) => event === "application-start"),
      ).toEqual([
        expect.objectContaining({
          event: "application-start",
          appVersion: APPLICATION_VERSION,
          databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
          dataDirectoryLayoutVersion: DATA_DIRECTORY_LAYOUT_VERSION,
          dataDirectory,
          distribution: "development-web",
          msg: "Application starting",
        }),
      ]);
    } finally {
      await rm(dataDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });

  it("routes a too-new data directory layout to the unavailable persistence path", async () => {
    const dataDirectory = await mkdtemp(
      join(tmpdir(), "studynarrator-server-layout-"),
    );
    const databasePath = join(dataDirectory, "studynarrator.sqlite");
    try {
      const opened = await openStudyNarratorRepository({
        Database,
        databasePath,
      });
      opened.close();
      await writeFile(
        join(dataDirectory, "manifest.json"),
        `${JSON.stringify(
          {
            manifestVersion: 1,
            appVersion: "9.9.9",
            createdAt: "2026-08-18T00:00:00.000Z",
            updatedAt: "2026-08-18T00:00:00.000Z",
            layoutVersion: DATA_DIRECTORY_LAYOUT_VERSION + 1,
            completedSteps: ["a-future-layout-step"],
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", mode: 0o600 },
      );

      const services = await createServerServices({
        STUDYNARRATOR_DATA_DIR: dataDirectory,
      });
      try {
        const status = await services.persistence.status();
        expect(status).toEqual(
          expect.objectContaining({
            state: "unavailable",
            code: "SCHEMA_TOO_NEW",
            databaseSchemaVersion: null,
            databasePath,
            latestBackupPath: null,
          }),
        );
        if (status.state !== "unavailable")
          throw new Error("expected the unavailable persistence status");
        expect(status.message).toContain("newer version of StudyNarrator");
        await expect(services.persistence.projects.list()).rejects.toThrow(
          "Persistence is unavailable",
        );
      } finally {
        await services.dispose();
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

describe("server data directory", () => {
  it("resolves a relative configured directory from the initiating workspace", () => {
    expect(
      resolveServerDataDirectory({
        INIT_CWD: "/workspace/studynarrator",
        STUDYNARRATOR_DATA_DIR: ".tmp/dev/manual",
      }),
    ).toBe(resolve("/workspace/studynarrator/.tmp/dev/manual"));
  });
});

describe("server runtime configuration", () => {
  it("keeps development loopback-only and resolves the Web build from the repository", () => {
    expect(
      resolveServerRuntimeConfiguration({}, "/workspace/studynarrator"),
    ).toEqual({
      distribution: "development-web",
      host: "127.0.0.1",
      port: 4310,
      requireWebDistribution: false,
      sourceRevision: "development",
      webDistributionDirectory: resolve(
        "/workspace/studynarrator/apps/web/dist",
      ),
    });
  });

  it("accepts the explicit Docker runtime boundary", () => {
    expect(
      resolveServerRuntimeConfiguration(
        {
          STUDYNARRATOR_DISTRIBUTION: "docker-web",
          STUDYNARRATOR_LISTEN_HOST: "0.0.0.0",
          STUDYNARRATOR_PORT: "4310",
          STUDYNARRATOR_SOURCE_REVISION: "abc123",
          STUDYNARRATOR_WEB_DIST: "/app/web",
        },
        "/workspace/studynarrator",
      ),
    ).toMatchObject({
      distribution: "docker-web",
      host: "0.0.0.0",
      port: 4310,
      requireWebDistribution: true,
      sourceRevision: "abc123",
      webDistributionDirectory: "/app/web",
    });
  });

  it.each([
    [{ STUDYNARRATOR_PORT: "0" }, "STUDYNARRATOR_PORT"],
    [{ STUDYNARRATOR_PORT: "4310x" }, "STUDYNARRATOR_PORT"],
    [{ STUDYNARRATOR_LISTEN_HOST: "bad host" }, "STUDYNARRATOR_LISTEN_HOST"],
    [{ STUDYNARRATOR_DISTRIBUTION: "desktop" }, "STUDYNARRATOR_DISTRIBUTION"],
    [
      { STUDYNARRATOR_SOURCE_REVISION: "bad\nrevision" },
      "STUDYNARRATOR_SOURCE_REVISION",
    ],
  ] as const)(
    "rejects invalid startup configuration %#",
    (environment, variable) => {
      expect(() =>
        resolveServerRuntimeConfiguration(
          environment,
          "/workspace/studynarrator",
        ),
      ).toThrow(variable);
    },
  );
});
