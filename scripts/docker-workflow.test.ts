import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";

const workflow = parseDocument(
  readFileSync(".github/workflows/docker-verification.yml", "utf8"),
);
const ci = parseDocument(readFileSync(".github/workflows/ci.yml", "utf8"));
const steps = workflow.getIn(["jobs", "check", "steps"]);
assert(isSeq(steps));
const step = (name: string) => {
  const value = steps.items.find(
    (item) => isMap(item) && item.get("name") === name,
  );
  assert(isMap(value), `Missing workflow step: ${name}`);
  return value;
};

describe("Docker verification workflow", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "studynarrator-ci-"));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("uses one bounded, read-only verifier for PR, main, tag, manual, and weekly runs", () => {
    expect(ci.errors).toEqual([]);
    expect(workflow.errors).toEqual([]);
    expect(ci.toJS()).toMatchObject({
      on: { push: { branches: ["main"] }, pull_request: null },
      permissions: { contents: "read" },
      jobs: { check: { uses: "./.github/workflows/docker-verification.yml" } },
    });
    expect(ci.getIn(["jobs", "check", "steps"])).toBeUndefined();
    expect(ci.getIn(["jobs", "check", "secrets"])).toBeUndefined();
    expect(workflow.toJS()).toMatchObject({
      on: {
        workflow_call: null,
        workflow_dispatch: null,
        push: { tags: ["v*"] },
        schedule: [{ cron: "23 6 * * 1" }],
      },
      permissions: { contents: "read" },
      jobs: {
        check: {
          "runs-on": "ubuntu-latest",
          "timeout-minutes": 30,
          concurrency: {
            group:
              "docker-verification-${{ github.workflow }}-${{ github.ref }}",
            "cancel-in-progress": true,
          },
        },
      },
    });
    expect(
      workflow.getIn(["jobs", "check", "continue-on-error"]),
    ).toBeUndefined();
    for (const item of steps.items) {
      assert(isMap(item));
      expect(item.get("continue-on-error")).toBeUndefined();
      const action = item.get("uses");
      if (action !== undefined) expect(action).toMatch(/@[a-f0-9]{40}$/u);
    }
    expect(
      step("Check out the source").getIn(["with", "persist-credentials"]),
    ).toBe(false);
    expect(step("Check out the source").getIn(["with", "ref"])).toBeUndefined();
    const release = parseDocument(
      readFileSync(".github/workflows/release.yml", "utf8"),
    );
    expect(release.getIn(["jobs", "package", "needs"])).toBeUndefined();
  });

  it.each([
    ["Check Docker prerequisites", "info"],
    ["Check Docker prerequisites", "compose version"],
    ["Check Docker prerequisites", "buildx version"],
    [
      "Verify in Docker",
      "compose -f compose.development.yaml up --build --abort-on-container-exit --exit-code-from verify verify",
    ],
  ])("propagates %s failure at %s", (name, failedCommand) => {
    writeFileSync(
      join(directory, "docker"),
      '#!/bin/sh\nif [ "$*" = "$DOCKER_TEST_FAIL" ]; then exit 23; fi\n',
      { mode: 0o700 },
    );
    const command = step(name).get("run");
    assert(typeof command === "string");
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", command], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        DOCKER_TEST_FAIL: failedCommand,
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(23);
    const cleanup = step("Remove the disposable verification environment");
    expect(cleanup.get("if")).toBe("always()");
    expect(cleanup.get("run")).toBe(
      "docker compose -f compose.development.yaml down --volumes",
    );
  });

  it("uploads only scanner evidence on failure, excluding private data and traces", () => {
    const upload = step("Upload Docker failure evidence");
    expect(upload.get("if")).toBe("failure()");
    expect(step("Collect Docker failure evidence").get("if")).toBe("failure()");
    expect(upload.getIn(["with", "retention-days"])).toBe(7);
    const patterns = upload.getIn(["with", "path"]);
    assert(typeof patterns === "string");
    const prefix = "artifacts/verify-docker/run-test/";
    const allowed = [
      "studynarrator.cdx.json",
      "trivy.json",
      "vulnerability-assessment.json",
    ].map((name) => prefix + name);
    const privateFiles = [
      prefix + "trivy.sarif",
      prefix + "application.log",
      prefix + "data/studynarrator.sqlite",
      "artifacts/test-results/trace.zip",
      "artifacts/playwright-report/index.html",
      "artifacts/.docker/config.json",
      "artifacts/cache/trivy.db",
    ];
    const sentinel = "sentinel-ci-private-endpoint-script-secret";
    for (const path of [...allowed, ...privateFiles]) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(
        join(directory, path),
        allowed.includes(path) ? "{}" : sentinel,
      );
    }
    const selected = globSync(patterns.trim().split(/\s+/u), {
      cwd: directory,
    }).sort();
    expect(selected).toEqual(allowed.sort());
    for (const path of selected)
      expect(readFileSync(join(directory, path), "utf8")).not.toContain(
        sentinel,
      );
  });
});
