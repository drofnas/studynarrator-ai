import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveServerDataDirectory } from "./bootstrap.js";
import { resolveServerRuntimeConfiguration } from "./runtimeConfig.js";

describe("server data directory", () => {
  it("resolves a relative configured directory from the initiating workspace", () => {
    expect(resolveServerDataDirectory({
      INIT_CWD: "/workspace/studynarrator",
      STUDYNARRATOR_DATA_DIR: ".tmp/dev/manual"
    })).toBe(resolve("/workspace/studynarrator/.tmp/dev/manual"));
  });
});

describe("server runtime configuration", () => {
  it("keeps development loopback-only and resolves the Web build from the repository", () => {
    expect(resolveServerRuntimeConfiguration({}, "/workspace/studynarrator")).toEqual({
      distribution: "development-web",
      host: "127.0.0.1",
      port: 4310,
      requireWebDistribution: false,
      sourceRevision: "development",
      webDistributionDirectory: resolve("/workspace/studynarrator/apps/web/dist")
    });
  });

  it("accepts the explicit Docker runtime boundary", () => {
    expect(resolveServerRuntimeConfiguration({
      STUDYNARRATOR_DISTRIBUTION: "docker-web",
      STUDYNARRATOR_LISTEN_HOST: "0.0.0.0",
      STUDYNARRATOR_PORT: "4310",
      STUDYNARRATOR_SOURCE_REVISION: "abc123",
      STUDYNARRATOR_WEB_DIST: "/app/web"
    }, "/workspace/studynarrator")).toMatchObject({
      distribution: "docker-web",
      host: "0.0.0.0",
      port: 4310,
      requireWebDistribution: true,
      sourceRevision: "abc123",
      webDistributionDirectory: "/app/web"
    });
  });

  it.each([
    [{ STUDYNARRATOR_PORT: "0" }, "STUDYNARRATOR_PORT"],
    [{ STUDYNARRATOR_PORT: "4310x" }, "STUDYNARRATOR_PORT"],
    [{ STUDYNARRATOR_LISTEN_HOST: "bad host" }, "STUDYNARRATOR_LISTEN_HOST"],
    [{ STUDYNARRATOR_DISTRIBUTION: "desktop" }, "STUDYNARRATOR_DISTRIBUTION"],
    [{ STUDYNARRATOR_SOURCE_REVISION: "bad\nrevision" }, "STUDYNARRATOR_SOURCE_REVISION"]
  ] as const)("rejects invalid startup configuration %#", (environment, variable) => {
    expect(() => resolveServerRuntimeConfiguration(environment, "/workspace/studynarrator")).toThrow(variable);
  });
});
