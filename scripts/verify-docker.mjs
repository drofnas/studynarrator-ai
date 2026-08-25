#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  BUILDKIT_IMAGE,
  VERIFICATION_LABEL,
  VERIFICATION_RUN_LABEL,
  VerificationInterruptedError,
  acquireVerificationLock,
  auditVerificationResources,
  cleanupVerificationResources,
  createDockerResourceNames,
  createSignalController,
  executeWithCleanup,
  removeRunOwnedBuildkitImage,
} from "./verify-docker-cleanup.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const verificationRoot = resolve(repositoryRoot, ".tmp", "verify-docker");
const buildkitOwnershipMarker = resolve(
  verificationRoot,
  "remove-buildkit-image-after-run.json",
);
const secret = "docker-verification-secret-never-exposed";
const resourceNames = createDockerResourceNames(process.pid, Date.now());
const verificationLabel = `${VERIFICATION_LABEL}=true`;
const verificationRunLabel = `${VERIFICATION_RUN_LABEL}=${resourceNames.runId}`;
let sourceRevision;
let fakeSpeaches;
let fakeSpeachesStartError;
let composeEnvironment;
let activeChild;
let signalController;

function fail(message) {
  throw new Error(`DOCKER VERIFY: ${message}`);
}

async function executeProcess(command, args, environment, captureOutput) {
  signalController?.throwIfInterrupted();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      stdio: captureOutput
        ? ["ignore", "pipe", "pipe"]
        : ["ignore", "inherit", "inherit"],
      shell: false,
    });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    let settled = false;
    if (captureOutput) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.once("error", (error) => {
      if (activeChild === child) activeChild = undefined;
      if (settled) return;
      settled = true;
      reject(new Error(`${command} could not start: ${error.message}`));
    });
    child.once("close", (status, childSignal) => {
      if (activeChild === child) activeChild = undefined;
      if (settled) return;
      settled = true;
      resolvePromise({ status, signal: childSignal, stdout, stderr });
    });
  });
}

async function commandOutput(command, args, environment = {}) {
  const result = await executeProcess(command, args, environment, true);
  signalController?.throwIfInterrupted();
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed${
        result.signal ? ` with ${result.signal}` : ""
      }:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

async function run(command, args, environment = {}) {
  process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
  const result = await executeProcess(command, args, environment, false);
  signalController?.throwIfInterrupted();
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed${
        result.signal
          ? ` with ${result.signal}`
          : ` with exit ${String(result.status)}`
      }`,
    );
  }
}

const dockerRunner = {
  output: commandOutput,
  run,
};

function composeArgs(...args) {
  return ["compose", "--project-name", resourceNames.projectName, ...args];
}

async function composeOutput(...args) {
  return commandOutput("docker", composeArgs(...args), composeEnvironment);
}

function invariant(condition, message) {
  if (!condition) fail(message);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    fail("could not reserve a local TCP port");
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

async function waitForHealthy(baseUrl, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    signalController?.throwIfInterrupted();
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  fail(`container did not become healthy: ${lastError}`);
}

async function waitForFake(controlUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    signalController?.throwIfInterrupted();
    if (fakeSpeachesStartError) {
      fail(`fake Speaches could not start: ${fakeSpeachesStartError.message}`);
    }
    try {
      if ((await fetch(`${controlUrl}/__control/state`)).ok) return;
    } catch {
      // The disposable fake server may still be binding its port.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  fail("fake Speaches did not start");
}

function assertComposeContract(config) {
  const serviceNames = Object.keys(config.services ?? {});
  invariant(
    JSON.stringify(serviceNames) === JSON.stringify(["study-narrator"]),
    "Compose must define exactly the application service",
  );
  const service = config.services["study-narrator"];
  invariant(
    service.ports?.length === 1,
    "Compose must publish exactly one port",
  );
  invariant(
    service.ports[0].host_ip === "127.0.0.1" &&
      service.ports[0].target === 4310,
    "Compose must publish port 4310 on loopback by default",
  );
  invariant(
    service.extra_hosts?.includes("host.docker.internal=host-gateway"),
    "Compose must include the Linux host-gateway mapping",
  );
  invariant(
    service.read_only === true,
    "Compose must use a read-only root filesystem",
  );
  invariant(
    service.cap_drop?.includes("ALL"),
    "Compose must drop all Linux capabilities",
  );
  invariant(
    service.security_opt?.includes("no-new-privileges:true"),
    "Compose must prevent privilege escalation",
  );
  invariant(
    service.volumes?.length === 1 &&
      service.volumes[0].type === "volume" &&
      service.volumes[0].target === "/data",
    "Compose must persist only /data in one named volume",
  );
  invariant(
    !Object.keys(config.services).some((name) =>
      name.toLowerCase().includes("speaches"),
    ),
    "Compose must not define a Speaches service",
  );
}

function assertImageContract(inspect) {
  const labels = inspect.Config?.Labels ?? {};
  invariant(
    inspect.Config?.User === "10001:10001",
    "image must run as fixed UID/GID 10001",
  );
  invariant(
    labels["org.opencontainers.image.version"] === "verify",
    "OCI version label is incorrect",
  );
  invariant(
    labels["org.opencontainers.image.revision"] === sourceRevision,
    "OCI revision label is incorrect",
  );
  invariant(
    labels["org.opencontainers.image.source"] ===
      "https://github.com/drofnas/studynarrator-ai",
    "OCI source label is incorrect",
  );
  invariant(
    labels["org.opencontainers.image.licenses"] === "Apache-2.0",
    "OCI license label is incorrect",
  );
  invariant(
    Array.isArray(inspect.Config?.Healthcheck?.Test),
    "image health check is missing",
  );
}

function parseScoutFinding(result) {
  const message = result.message?.text ?? "";
  const value = (label) =>
    message.match(new RegExp(`${label}\\s*:([^\\n]+)`, "u"))?.[1]?.trim() ?? "";
  return {
    id: value("Vulnerability") || result.ruleId,
    severity: value("Severity"),
    package: value("Package"),
    fixedVersion: value("Fixed version"),
  };
}

function assertScoutPolicy(sarifPath) {
  const report = JSON.parse(readFileSync(sarifPath, "utf8"));
  const findings = report.runs
    .flatMap((runResult) => runResult.results ?? [])
    .map(parseScoutFinding);
  const exceptionDocument = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "deploy/docker/scout-high-exceptions.json"),
      "utf8",
    ),
  );
  invariant(
    exceptionDocument.schemaVersion === 1 &&
      Array.isArray(exceptionDocument.exceptions),
    "Scout exception document is invalid",
  );
  const used = new Set();
  for (const finding of findings) {
    if (finding.severity === "CRITICAL")
      fail(`critical vulnerability ${finding.id} in ${finding.package}`);
    if (finding.severity !== "HIGH") continue;
    if (finding.fixedVersion && finding.fixedVersion !== "not fixed") {
      fail(
        `high vulnerability ${finding.id} has fix ${finding.fixedVersion} and must be remediated`,
      );
    }
    const exception = exceptionDocument.exceptions.find(
      (candidate) =>
        candidate.id === finding.id &&
        finding.package.startsWith(candidate.package),
    );
    invariant(
      exception,
      `high vulnerability ${finding.id} in ${finding.package} lacks a narrow exception`,
    );
    invariant(
      typeof exception.reason === "string" && exception.reason.length >= 80,
      `exception ${finding.id} needs a specific rationale`,
    );
    invariant(
      Date.parse(`${exception.expiresAt}T00:00:00Z`) > Date.now(),
      `exception ${finding.id} has expired`,
    );
    used.add(exception.id);
  }
  for (const exception of exceptionDocument.exceptions) {
    invariant(
      used.has(exception.id),
      `Scout exception ${exception.id} is stale or no longer needed`,
    );
  }
}

async function redactedJson(baseUrl, path) {
  const deadline = Date.now() + 10_000;
  let lastError = "no response";
  while (Date.now() < deadline) {
    signalController?.throwIfInterrupted();
    try {
      const response = await fetch(`${baseUrl}${path}`);
      invariant(response.ok, `${path} returned HTTP ${response.status}`);
      const text = await response.text();
      invariant(
        !text.includes(secret),
        `${path} exposed the verification sentinel`,
      );
      return JSON.parse(text);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
  }
  fail(`${path} remained unavailable: ${lastError}`);
}

async function stopFakeSpeaches() {
  if (
    !fakeSpeaches ||
    fakeSpeachesStartError ||
    fakeSpeaches.exitCode !== null ||
    fakeSpeaches.signalCode !== null
  ) {
    return;
  }
  fakeSpeaches.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => fakeSpeaches.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ]);
  if (fakeSpeaches.exitCode === null) fakeSpeaches.kill("SIGKILL");
}

async function buildkitImageExists() {
  return (
    (
      await commandOutput("docker", [
        "image",
        "ls",
        "--all",
        "--quiet",
        "--filter",
        `reference=${BUILDKIT_IMAGE}`,
      ])
    ).length > 0
  );
}

function clearBuildkitOwnershipMarker() {
  try {
    unlinkSync(buildkitOwnershipMarker);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function smokeContainerArgs(name, entrypoint, ...args) {
  return [
    "run",
    "--rm",
    "--name",
    `${resourceNames.runId}-${name}`,
    "--label",
    verificationLabel,
    "--label",
    verificationRunLabel,
    "--tmpfs",
    "/data:rw,noexec,nosuid,size=16m",
    "--entrypoint",
    entrypoint,
    resourceNames.imageTag,
    ...args,
  ];
}

async function runDockerAcceptance({
  baseUrl,
  fakeControlUrl,
  fakeApplicationUrl,
  fakePort,
  sbomPath,
  scoutPath,
}) {
  const config = JSON.parse(await composeOutput("config", "--format", "json"));
  assertComposeContract(config);

  await run("docker", [
    "buildx",
    "create",
    "--name",
    resourceNames.builderName,
    "--driver",
    "docker-container",
    "--driver-opt",
    `image=${BUILDKIT_IMAGE}`,
    "--bootstrap",
  ]);
  await run("docker", [
    "buildx",
    "build",
    "--builder",
    resourceNames.builderName,
    "--load",
    "--tag",
    resourceNames.imageTag,
    "--label",
    verificationLabel,
    "--label",
    verificationRunLabel,
    "--build-arg",
    "STUDYNARRATOR_VERSION=verify",
    "--build-arg",
    `STUDYNARRATOR_SOURCE_REVISION=${sourceRevision}`,
    ".",
  ]);
  assertImageContract(
    JSON.parse(
      await commandOutput("docker", [
        "image",
        "inspect",
        resourceNames.imageTag,
      ]),
    )[0],
  );
  invariant(
    (await commandOutput(
      "docker",
      smokeContainerArgs("id", "/usr/bin/id", "-u"),
    )) === "10001",
    "runtime process is not non-root",
  );
  invariant(
    (
      await commandOutput(
        "docker",
        smokeContainerArgs("ffmpeg", "/usr/bin/ffmpeg", "-version"),
      )
    ).startsWith("ffmpeg version 7.1"),
    "FFmpeg 7.1 is unavailable",
  );
  await run(
    "docker",
    smokeContainerArgs("license", "/usr/bin/test", "-s", "/app/LICENSE"),
  );
  await run(
    "docker",
    smokeContainerArgs(
      "acknowledgments",
      "/usr/bin/test",
      "-s",
      "/app/ACKNOWLEDGMENTS.md",
    ),
  );

  await run("docker", [
    "scout",
    "sbom",
    "--format",
    "cyclonedx",
    "--output",
    sbomPath,
    `local://${resourceNames.imageTag}`,
  ]);
  const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
  invariant(
    sbom.bomFormat === "CycloneDX" &&
      Array.isArray(sbom.components) &&
      sbom.components.length > 0,
    "CycloneDX image inventory is invalid",
  );
  await run("docker", [
    "scout",
    "cves",
    "--only-severity",
    "critical,high",
    "--format",
    "sarif",
    "--output",
    scoutPath,
    `local://${resourceNames.imageTag}`,
  ]);
  assertScoutPolicy(scoutPath);

  fakeSpeaches = spawn(
    resolve(repositoryRoot, "node_modules/.bin/tsx"),
    ["apps/fake-speaches/src/cli.ts"],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        STUDYNARRATOR_FAKE_SPEACHES_HOST: "0.0.0.0",
        STUDYNARRATOR_FAKE_SPEACHES_PORT: String(fakePort),
        STUDYNARRATOR_FAKE_SPEACHES_SCENARIO: "timeout",
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  fakeSpeaches.once("error", (error) => {
    fakeSpeachesStartError = error;
  });
  await waitForFake(fakeControlUrl);

  await run(
    "docker",
    composeArgs("up", "--detach", "--no-build"),
    composeEnvironment,
  );
  await waitForHealthy(baseUrl);
  const initialContainerId = await composeOutput(
    "ps",
    "--quiet",
    "study-narrator",
  );
  invariant(
    initialContainerId.length > 10,
    "Compose did not return the application container ID",
  );
  invariant(
    JSON.parse(
      await commandOutput("docker", ["inspect", initialContainerId]),
    )[0].RestartCount === 0,
    "container restarted while Speaches was unavailable",
  );
  const runtime = await redactedJson(baseUrl, "/api/runtime");
  invariant(
    runtime.distribution === "docker-web" &&
      runtime.sourceRevision === sourceRevision,
    "runtime metadata does not identify this Docker build",
  );

  await run(
    "npx",
    ["playwright", "test", "--config", "playwright.docker.config.ts"],
    {
      STUDYNARRATOR_DOCKER_BASE_URL: baseUrl,
      STUDYNARRATOR_DOCKER_TEST_SECRET: secret,
      STUDYNARRATOR_EXPECTED_SOURCE_REVISION: sourceRevision,
      STUDYNARRATOR_FAKE_SPEACHES_URL: fakeControlUrl,
      STUDYNARRATOR_FAKE_SPEACHES_APP_URL: fakeApplicationUrl,
    },
  );
  await waitForHealthy(baseUrl);
  invariant(
    (await composeOutput("ps", "--quiet", "study-narrator")) ===
      initialContainerId,
    "offline recovery unexpectedly recreated the container",
  );

  const beforeProjects = await redactedJson(baseUrl, "/api/projects");
  invariant(
    Array.isArray(beforeProjects) && beforeProjects.length === 2,
    "browser acceptance did not create one project per browser",
  );
  for (const project of beforeProjects) {
    const renders = await redactedJson(
      baseUrl,
      `/api/projects/${project.id}/renders`,
    );
    invariant(
      Array.isArray(renders) &&
        renders.some((render) => render.state === "complete"),
      `project ${project.id} has no completed render`,
    );
  }
  const browserPayload = JSON.stringify({
    runtime,
    diagnostics: await redactedJson(baseUrl, "/api/diagnostics"),
    connection: await redactedJson(baseUrl, "/api/connection"),
    connectionDiagnostics: await redactedJson(
      baseUrl,
      "/api/connection/diagnostics",
    ),
    projects: beforeProjects,
  });
  invariant(
    !browserPayload.includes(secret),
    "API or diagnostic payload exposed the verification sentinel",
  );
  const logs = await composeOutput("logs", "--no-color", "study-narrator");
  invariant(
    !logs.includes(secret),
    "container logs exposed the verification sentinel",
  );

  await run(
    "docker",
    composeArgs(
      "up",
      "--detach",
      "--no-deps",
      "--force-recreate",
      "study-narrator",
    ),
    composeEnvironment,
  );
  await waitForHealthy(baseUrl);
  const recreatedContainerId = await composeOutput(
    "ps",
    "--quiet",
    "study-narrator",
  );
  invariant(
    recreatedContainerId !== initialContainerId,
    "Compose force-recreate retained the old container",
  );
  const persistedConnection = await redactedJson(baseUrl, "/api/connection");
  invariant(
    persistedConnection.configured === true &&
      persistedConnection.baseUrl === fakeApplicationUrl,
    "Speaches connection did not survive container recreation",
  );
  const afterProjects = await redactedJson(baseUrl, "/api/projects");
  invariant(
    JSON.stringify(afterProjects.map(({ id }) => id).sort()) ===
      JSON.stringify(beforeProjects.map(({ id }) => id).sort()),
    "projects did not survive container recreation",
  );
  for (const project of afterProjects) {
    const renders = await redactedJson(
      baseUrl,
      `/api/projects/${project.id}/renders`,
    );
    invariant(
      Array.isArray(renders) &&
        renders.some((render) => render.state === "complete"),
      `render history for ${project.id} did not survive container recreation`,
    );
  }
  invariant(
    JSON.parse(
      await commandOutput("docker", ["inspect", recreatedContainerId]),
    )[0].RestartCount === 0,
    "recreated container restarted unexpectedly",
  );
}

async function main() {
  if (process.argv.length !== 2) fail("usage: npm run verify:docker");
  if (Number(process.versions.node.split(".")[0]) < 24) {
    fail(
      `verification requires Node 24 or later; current runtime is ${process.versions.node}`,
    );
  }

  mkdirSync(verificationRoot, { recursive: true, mode: 0o700 });
  const releaseLock = acquireVerificationLock({
    lockPath: resolve(verificationRoot, "active.lock"),
  });
  signalController = createSignalController({
    getActiveChild: () => activeChild,
  });

  let buildkitImageExistedBeforeRun = true;
  let sbomPath;
  let scoutPath;
  try {
    await executeWithCleanup({
      execute: async () => {
        const staleCleanupFailures = await cleanupVerificationResources({
          runner: dockerRunner,
        });
        if (staleCleanupFailures.length > 0) {
          fail(
            `stale Docker cleanup failed:\n${staleCleanupFailures.join("\n")}`,
          );
        }
        const staleAudit = await auditVerificationResources({
          runner: dockerRunner,
        });
        if (staleAudit.failures.length > 0 || staleAudit.leftovers.length > 0) {
          fail(
            `stale Docker resources remain:\n${[
              ...staleAudit.failures,
              ...staleAudit.leftovers,
            ].join("\n")}`,
          );
        }

        if (existsSync(buildkitOwnershipMarker)) {
          const staleBuildkitFailures = await removeRunOwnedBuildkitImage({
            runner: dockerRunner,
            existedBeforeRun: false,
          });
          if (staleBuildkitFailures.length > 0) {
            fail(
              `stale BuildKit image cleanup failed:\n${staleBuildkitFailures.join("\n")}`,
            );
          }
          if (!(await buildkitImageExists())) {
            clearBuildkitOwnershipMarker();
          }
        }

        await commandOutput("docker", ["buildx", "version"]);
        buildkitImageExistedBeforeRun = await buildkitImageExists();
        if (!buildkitImageExistedBeforeRun) {
          writeFileSync(
            buildkitOwnershipMarker,
            JSON.stringify({ runId: resourceNames.runId }),
            { encoding: "utf8", mode: 0o600 },
          );
        }
        sourceRevision = await commandOutput("git", [
          "rev-parse",
          "--short=12",
          "HEAD",
        ]);

        const verificationRun = mkdtempSync(resolve(verificationRoot, "run-"));
        sbomPath = resolve(verificationRun, "studynarrator.cdx.json");
        scoutPath = resolve(verificationRun, "docker-scout.sarif");
        const hostPort = await reservePort();
        const fakePort = await reservePort();
        const baseUrl = `http://127.0.0.1:${hostPort}`;
        const fakeControlUrl = `http://127.0.0.1:${fakePort}`;
        const fakeApplicationUrl = `http://host.docker.internal:${fakePort}`;

        composeEnvironment = {
          STUDYNARRATOR_BIND_ADDRESS: "127.0.0.1",
          STUDYNARRATOR_HOST_PORT: String(hostPort),
          STUDYNARRATOR_IMAGE_TAG: resourceNames.imageVersionTag,
          STUDYNARRATOR_SOURCE_REVISION: sourceRevision,
        };

        await runDockerAcceptance({
          baseUrl,
          fakeControlUrl,
          fakeApplicationUrl,
          fakePort,
          sbomPath,
          scoutPath,
        });
      },
      cleanup: async () => {
        signalController.beginCleanup();
        const failures = [];
        try {
          await stopFakeSpeaches();
        } catch (error) {
          failures.push(
            `stop fake Speaches: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        failures.push(
          ...(await cleanupVerificationResources({
            runner: dockerRunner,
            currentNames: resourceNames,
            composeEnvironment,
          })),
        );
        failures.push(
          ...(await removeRunOwnedBuildkitImage({
            runner: dockerRunner,
            existedBeforeRun: buildkitImageExistedBeforeRun,
          })),
        );
        if (failures.length === 0 && existsSync(buildkitOwnershipMarker)) {
          try {
            if (!(await buildkitImageExists())) {
              clearBuildkitOwnershipMarker();
            }
          } catch (error) {
            failures.push(
              `verify BuildKit image cleanup: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        return failures;
      },
      audit: async () => {
        const audit = await auditVerificationResources({
          runner: dockerRunner,
        });
        return [
          ...audit.failures,
          ...audit.leftovers.map(
            (leftover) => `Docker verification resource remains: ${leftover}`,
          ),
        ];
      },
      release: async () => {
        releaseLock();
      },
    });
  } finally {
    signalController.dispose();
  }

  process.stdout.write(
    `\nDOCKER VERIFY: ALL CHECKS PASSED\nCycloneDX inventory: ${sbomPath}\nDocker Scout report: ${scoutPath}\n`,
  );
}

try {
  await main();
} catch (error) {
  const signal = signalController?.signal;
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`DOCKER VERIFY: ERROR: ${message}\n`);
  process.exitCode = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
  if (
    error instanceof VerificationInterruptedError ||
    error?.cause instanceof VerificationInterruptedError
  ) {
    process.stderr.write(`DOCKER VERIFY: interrupted by ${signal}.\n`);
  }
}
