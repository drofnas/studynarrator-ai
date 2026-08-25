import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

const VERIFICATION_PREFIX = "studynarrator-verify-";
export const VERIFICATION_LABEL = "io.studynarrator.verification";
export const VERIFICATION_RUN_LABEL = "io.studynarrator.verification.run";
export const LEGACY_IMAGE_TAG = "studynarrator:verify";
export const BUILDKIT_IMAGE = "moby/buildkit:buildx-stable-1";

const safeVerificationName = /^studynarrator-verify-\d+-\d+$/u;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function lines(value) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

export function createDockerResourceNames(pid, timestamp) {
  const runId = `${VERIFICATION_PREFIX}${pid}-${timestamp}`;
  if (!safeVerificationName.test(runId)) {
    throw new Error(`generated unsafe Docker verification run id ${runId}`);
  }
  return {
    runId,
    projectName: runId,
    builderName: runId,
    imageVersionTag: `verify-${pid}-${timestamp}`,
    imageTag: `studynarrator:verify-${pid}-${timestamp}`,
    builderContainerName: `buildx_buildkit_${runId}0`,
    builderStateVolumeName: `buildx_buildkit_${runId}0_state`,
  };
}

function isVerificationName(value) {
  return safeVerificationName.test(value);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function acquireVerificationLock({
  lockPath,
  pid = process.pid,
  token = randomUUID(),
  processIsAlive = isProcessAlive,
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(
        descriptor,
        JSON.stringify({ pid, token, startedAt: new Date().toISOString() }),
        "utf8",
      );
      closeSync(descriptor);
      descriptor = undefined;
      return () => {
        let owner;
        try {
          owner = JSON.parse(readFileSync(lockPath, "utf8"));
        } catch (error) {
          throw new Error(
            `could not read Docker verification lock while releasing it: ${errorMessage(error)}`,
            { cause: error },
          );
        }
        if (owner.token !== token || owner.pid !== pid) {
          throw new Error(
            "refusing to release a Docker verification lock owned by another process",
          );
        }
        unlinkSync(lockPath);
      };
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (error?.code !== "EEXIST") throw error;

      let owner;
      try {
        owner = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch {
        owner = undefined;
      }
      if (
        Number.isSafeInteger(owner?.pid) &&
        owner.pid > 0 &&
        processIsAlive(owner.pid)
      ) {
        throw new Error(
          `Docker verification is already running in process ${owner.pid}`,
          { cause: error },
        );
      }
      try {
        unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
    }
  }
  throw new Error("could not acquire the Docker verification lock");
}

export class VerificationInterruptedError extends Error {
  constructor(signal) {
    super(`verification interrupted by ${signal}`);
    this.name = "VerificationInterruptedError";
    this.signal = signal;
  }
}

export function createSignalController({
  processTarget = process,
  getActiveChild,
}) {
  let interruptedSignal;
  let cleaningUp = false;

  const handler = (signal) => {
    interruptedSignal ??= signal;
    if (cleaningUp) return;
    const child = getActiveChild();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  const onSigint = () => handler("SIGINT");
  const onSigterm = () => handler("SIGTERM");

  processTarget.on("SIGINT", onSigint);
  processTarget.on("SIGTERM", onSigterm);

  return {
    beginCleanup() {
      cleaningUp = true;
    },
    dispose() {
      processTarget.off("SIGINT", onSigint);
      processTarget.off("SIGTERM", onSigterm);
    },
    get signal() {
      return interruptedSignal;
    },
    throwIfInterrupted() {
      if (interruptedSignal && !cleaningUp) {
        throw new VerificationInterruptedError(interruptedSignal);
      }
    },
  };
}

async function collectOutput(failures, label, action) {
  try {
    return await action();
  } catch (error) {
    failures.push(`${label}: ${errorMessage(error)}`);
    return "";
  }
}

async function attempt(failures, label, action) {
  try {
    await action();
  } catch (error) {
    failures.push(`${label}: ${errorMessage(error)}`);
  }
}

async function discoverComposeProjects(runner, failures) {
  const format = '{{.Label "com.docker.compose.project"}}';
  const projectNames = [];
  for (const resource of ["container", "network", "volume"]) {
    const output = await collectOutput(
      failures,
      `list Compose ${resource} projects`,
      () =>
        runner.output("docker", [
          resource,
          "ls",
          ...(resource === "container" ? ["--all"] : []),
          "--filter",
          "label=com.docker.compose.project",
          "--format",
          format,
        ]),
    );
    projectNames.push(...lines(output).filter(isVerificationName));
  }
  return unique(projectNames);
}

async function discoverBuilderNames(runner, failures) {
  const output = await collectOutput(failures, "list Buildx builders", () =>
    runner.output("docker", ["buildx", "ls", "--format", "{{json .}}"]),
  );
  const names = [];
  for (const entry of lines(output)) {
    try {
      const parsed = JSON.parse(entry);
      if (isVerificationName(parsed.Name)) names.push(parsed.Name);
    } catch (error) {
      failures.push(`parse Buildx builder listing: ${errorMessage(error)}`);
    }
  }
  return unique(names);
}

async function listOwnedIds(runner, failures, resource, projectNames) {
  const ids = [];
  ids.push(
    ...lines(
      await collectOutput(failures, `list labeled ${resource}s`, () =>
        runner.output("docker", [
          resource,
          "ls",
          ...(resource === "container" || resource === "image"
            ? ["--all"]
            : []),
          "--quiet",
          "--filter",
          `label=${VERIFICATION_LABEL}=true`,
        ]),
      ),
    ),
  );
  for (const projectName of projectNames) {
    ids.push(
      ...lines(
        await collectOutput(
          failures,
          `list ${resource}s for Compose project ${projectName}`,
          () =>
            runner.output("docker", [
              resource,
              "ls",
              ...(resource === "container" ? ["--all"] : []),
              "--quiet",
              "--filter",
              `label=com.docker.compose.project=${projectName}`,
            ]),
        ),
      ),
    );
  }
  return unique(ids);
}

async function listBuilderStorageNames(runner, failures, resource) {
  const output = await collectOutput(
    failures,
    `list Docker ${resource} names`,
    () =>
      runner.output("docker", [
        resource,
        "ls",
        ...(resource === "container" ? ["--all"] : []),
        "--format",
        resource === "container" ? "{{.Names}}" : "{{.Name}}",
      ]),
  );
  return lines(output).filter((name) =>
    name.startsWith(`buildx_buildkit_${VERIFICATION_PREFIX}`),
  );
}

export async function cleanupVerificationResources({
  runner,
  currentNames,
  composeEnvironment = {},
}) {
  const failures = [];
  const discoveredProjects = await discoverComposeProjects(runner, failures);
  const projectNames = unique([
    ...discoveredProjects,
    ...(currentNames ? [currentNames.projectName] : []),
  ]).filter(isVerificationName);

  for (const projectName of projectNames) {
    await attempt(failures, `remove Compose project ${projectName}`, () =>
      runner.run(
        "docker",
        [
          "compose",
          "--project-name",
          projectName,
          "down",
          "--volumes",
          "--remove-orphans",
          "--timeout",
          "10",
        ],
        currentNames?.projectName === projectName ? composeEnvironment : {},
      ),
    );
  }

  const containerIds = await listOwnedIds(
    runner,
    failures,
    "container",
    projectNames,
  );
  if (containerIds.length > 0) {
    await attempt(failures, "force-remove verification containers", () =>
      runner.run("docker", [
        "container",
        "rm",
        "--force",
        "--volumes",
        ...containerIds,
      ]),
    );
  }

  const builderNames = await discoverBuilderNames(runner, failures);
  for (const builderName of builderNames.filter(isVerificationName)) {
    await attempt(failures, `remove Buildx builder ${builderName}`, () =>
      runner.run("docker", ["buildx", "rm", "--force", builderName]),
    );
  }

  const builderContainerNames = await listBuilderStorageNames(
    runner,
    failures,
    "container",
  );
  if (currentNames)
    builderContainerNames.push(currentNames.builderContainerName);
  for (const containerName of unique(builderContainerNames)) {
    const existing = lines(
      await collectOutput(
        failures,
        `find builder container ${containerName}`,
        () =>
          runner.output("docker", [
            "container",
            "ls",
            "--all",
            "--quiet",
            "--filter",
            `name=${containerName}`,
          ]),
      ),
    );
    if (existing.length > 0) {
      await attempt(
        failures,
        `force-remove builder container ${containerName}`,
        () =>
          runner.run("docker", [
            "container",
            "rm",
            "--force",
            "--volumes",
            ...existing,
          ]),
      );
    }
  }

  const imageIds = await listOwnedIds(runner, failures, "image", []);
  imageIds.push(
    ...lines(
      await collectOutput(failures, "find legacy verification image", () =>
        runner.output("docker", [
          "image",
          "ls",
          "--all",
          "--quiet",
          "--filter",
          `reference=${LEGACY_IMAGE_TAG}`,
        ]),
      ),
    ),
  );
  if (currentNames) {
    imageIds.push(
      ...lines(
        await collectOutput(
          failures,
          `find verification image ${currentNames.imageTag}`,
          () =>
            runner.output("docker", [
              "image",
              "ls",
              "--all",
              "--quiet",
              "--filter",
              `reference=${currentNames.imageTag}`,
            ]),
        ),
      ),
    );
  }
  if (unique(imageIds).length > 0) {
    await attempt(failures, "remove verification images", () =>
      runner.run("docker", ["image", "rm", "--force", ...unique(imageIds)]),
    );
  }

  const volumeNames = await listOwnedIds(
    runner,
    failures,
    "volume",
    projectNames,
  );
  volumeNames.push(
    ...(await listBuilderStorageNames(runner, failures, "volume")),
  );
  if (unique(volumeNames).length > 0) {
    await attempt(failures, "remove verification volumes", () =>
      runner.run("docker", ["volume", "rm", "--force", ...unique(volumeNames)]),
    );
  }

  const networkIds = await listOwnedIds(
    runner,
    failures,
    "network",
    projectNames,
  );
  if (networkIds.length > 0) {
    await attempt(failures, "remove verification networks", () =>
      runner.run("docker", ["network", "rm", ...networkIds]),
    );
  }

  return failures;
}

export async function removeRunOwnedBuildkitImage({
  runner,
  existedBeforeRun,
}) {
  if (existedBeforeRun) return [];
  const failures = [];
  const imageIds = lines(
    await collectOutput(failures, "find run-created BuildKit image", () =>
      runner.output("docker", [
        "image",
        "ls",
        "--all",
        "--quiet",
        "--filter",
        `reference=${BUILDKIT_IMAGE}`,
      ]),
    ),
  );
  if (imageIds.length === 0) return failures;

  const users = lines(
    await collectOutput(failures, "find BuildKit image users", () =>
      runner.output("docker", [
        "container",
        "ls",
        "--all",
        "--quiet",
        "--filter",
        `ancestor=${BUILDKIT_IMAGE}`,
      ]),
    ),
  );
  if (users.length > 0) return failures;

  await attempt(failures, "remove run-created BuildKit image", () =>
    runner.run("docker", ["image", "rm", ...unique(imageIds)]),
  );
  return failures;
}

export async function auditVerificationResources({ runner }) {
  const failures = [];
  const leftovers = [];
  const projectNames = await discoverComposeProjects(runner, failures);
  leftovers.push(...projectNames.map((name) => `Compose project ${name}`));

  for (const resource of ["container", "image", "volume", "network"]) {
    const ids = await listOwnedIds(runner, failures, resource, projectNames);
    leftovers.push(...ids.map((id) => `${resource} ${id}`));
  }

  const builderNames = await discoverBuilderNames(runner, failures);
  leftovers.push(...builderNames.map((name) => `Buildx builder ${name}`));
  const builderContainers = await listBuilderStorageNames(
    runner,
    failures,
    "container",
  );
  leftovers.push(
    ...builderContainers.map((name) => `builder container ${name}`),
  );
  const builderVolumes = await listBuilderStorageNames(
    runner,
    failures,
    "volume",
  );
  leftovers.push(...builderVolumes.map((name) => `builder volume ${name}`));

  const legacyImages = lines(
    await collectOutput(failures, "audit legacy verification image", () =>
      runner.output("docker", [
        "image",
        "ls",
        "--all",
        "--quiet",
        "--filter",
        `reference=${LEGACY_IMAGE_TAG}`,
      ]),
    ),
  );
  leftovers.push(...legacyImages.map((id) => `legacy image ${id}`));

  return { failures, leftovers: unique(leftovers) };
}

function normalizeHookFailures(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [String(value)];
}

async function invokeHook(label, hook) {
  try {
    return normalizeHookFailures(await hook());
  } catch (error) {
    return [`${label}: ${errorMessage(error)}`];
  }
}

export async function executeWithCleanup({ execute, cleanup, audit, release }) {
  let primaryError;
  try {
    await execute();
  } catch (error) {
    primaryError = error;
  }

  const cleanupFailures = await invokeHook("cleanup failed", cleanup);
  const auditFailures = await invokeHook("cleanup audit failed", audit);
  const releaseFailures = await invokeHook("lock release failed", release);
  const secondaryFailures = [
    ...cleanupFailures,
    ...auditFailures,
    ...releaseFailures,
  ];

  if (primaryError || secondaryFailures.length > 0) {
    const messages = [];
    if (primaryError) messages.push(errorMessage(primaryError));
    messages.push(...secondaryFailures);
    const error = new Error(messages.join("\n"));
    error.cause = primaryError;
    throw error;
  }
}
