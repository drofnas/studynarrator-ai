import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  BUILDKIT_IMAGE,
  LEGACY_IMAGE_TAG,
  VERIFICATION_LABEL,
  acquireVerificationLock,
  auditVerificationResources,
  cleanupVerificationResources,
  createDockerResourceNames,
  createSignalController,
  executeWithCleanup,
  removeRunOwnedBuildkitImage,
} from "./verify-docker-cleanup.mjs";

interface CommandCall {
  args: string[];
  command: string;
  environment: Record<string, string> | undefined;
  kind: "output" | "run";
}

class FakeRunner {
  readonly calls: CommandCall[] = [];
  outputHandler: (command: string, args: string[]) => string = () => "";
  runHandler: (command: string, args: string[]) => void = () => undefined;

  async output(command: string, args: string[]): Promise<string> {
    this.calls.push({ args, command, environment: undefined, kind: "output" });
    return this.outputHandler(command, args);
  }

  async run(
    command: string,
    args: string[],
    environment?: Record<string, string>,
  ): Promise<void> {
    this.calls.push({ args, command, environment, kind: "run" });
    this.runHandler(command, args);
  }
}

function commandText(call: CommandCall): string {
  return `${call.command} ${call.args.join(" ")}`;
}

function configureOwnedResources(
  runner: FakeRunner,
  names: ReturnType<typeof createDockerResourceNames>,
): void {
  runner.outputHandler = (_command, args) => {
    const text = args.join(" ");
    if (
      text.includes("label=com.docker.compose.project") &&
      text.includes("--format")
    ) {
      return `${names.projectName}\nunrelated-project`;
    }
    if (text === "buildx ls --format {{json .}}") {
      return [
        JSON.stringify({ Name: names.builderName }),
        JSON.stringify({ Name: "unrelated-builder" }),
      ].join("\n");
    }
    if (text.includes(`label=${VERIFICATION_LABEL}=true`)) {
      if (args[0] === "container") return "verification-container";
      if (args[0] === "image") return "verification-image";
      if (args[0] === "volume") return "verification-volume";
      if (args[0] === "network") return "verification-network";
    }
    if (text.includes(`com.docker.compose.project=${names.projectName}`)) {
      if (args[0] === "container") return "compose-container";
      if (args[0] === "volume") return "compose-volume";
      if (args[0] === "network") return "compose-network";
    }
    if (text.includes(`reference=${LEGACY_IMAGE_TAG}`)) return "legacy-image";
    if (text.includes(`reference=${names.imageTag}`)) {
      return "verification-image";
    }
    if (text === "container ls --all --format {{.Names}}") {
      return `${names.builderContainerName}\nunrelated-container`;
    }
    if (text === "volume ls --format {{.Name}}") {
      return `${names.builderStateVolumeName}\nunrelated-volume`;
    }
    if (
      text.includes(`name=${names.builderContainerName}`) &&
      text.includes("--quiet")
    ) {
      return "builder-container-id";
    }
    return "";
  };
}

describe("Docker verification resource lifecycle", () => {
  it("creates one safe identity for every run-owned Docker resource", () => {
    const names = createDockerResourceNames(123, 456);

    expect(names).toEqual({
      builderContainerName: "buildx_buildkit_studynarrator-verify-123-4560",
      builderName: "studynarrator-verify-123-456",
      builderStateVolumeName:
        "buildx_buildkit_studynarrator-verify-123-4560_state",
      imageTag: "studynarrator:verify-123-456",
      imageVersionTag: "verify-123-456",
      projectName: "studynarrator-verify-123-456",
      runId: "studynarrator-verify-123-456",
    });
  });

  it("removes only verification-owned resources and the legacy image", async () => {
    const names = createDockerResourceNames(123, 456);
    const runner = new FakeRunner();
    configureOwnedResources(runner, names);

    const failures = await cleanupVerificationResources({
      composeEnvironment: { STUDYNARRATOR_HOST_PORT: "12345" },
      currentNames: names,
      runner,
    });

    expect(failures).toEqual([]);
    const commands = runner.calls
      .filter((call) => call.kind === "run")
      .map(commandText);
    expect(commands).toContain(
      `docker compose --project-name ${names.projectName} down --volumes --remove-orphans --timeout 10`,
    );
    expect(commands).toContain(`docker buildx rm --force ${names.builderName}`);
    expect(commands).toContain(
      "docker image rm --force verification-image legacy-image",
    );
    expect(commands).toContain(
      `docker volume rm --force verification-volume compose-volume ${names.builderStateVolumeName}`,
    );
    expect(commands.join("\n")).not.toContain("unrelated-project");
    expect(commands.join("\n")).not.toContain("unrelated-builder");
    expect(commands.join("\n")).not.toContain("unrelated-volume");
  });

  it("continues fallback cleanup after independent cleanup failures", async () => {
    const names = createDockerResourceNames(123, 456);
    const runner = new FakeRunner();
    configureOwnedResources(runner, names);
    runner.runHandler = (_command, args) => {
      const text = args.join(" ");
      if (text.startsWith("compose ") || text.startsWith("image rm ")) {
        throw new Error(`injected failure for ${text}`);
      }
    };

    const failures = await cleanupVerificationResources({
      currentNames: names,
      runner,
    });

    expect(failures).toHaveLength(2);
    const commands = runner.calls
      .filter((call) => call.kind === "run")
      .map(commandText);
    expect(commands.some((command) => command.includes("container rm"))).toBe(
      true,
    );
    expect(commands.some((command) => command.includes("volume rm"))).toBe(
      true,
    );
    expect(commands.some((command) => command.includes("network rm"))).toBe(
      true,
    );
  });

  it("does not fail when verification stops before creating Docker resources", async () => {
    const names = createDockerResourceNames(123, 456);
    const runner = new FakeRunner();

    const failures = await cleanupVerificationResources({
      currentNames: names,
      runner,
    });

    expect(failures).toEqual([]);
    const commands = runner.calls
      .filter((call) => call.kind === "run")
      .map(commandText);
    expect(commands).toEqual([
      `docker compose --project-name ${names.projectName} down --volumes --remove-orphans --timeout 10`,
    ]);
  });

  it("reports every verifier-owned resource found by the final audit", async () => {
    const names = createDockerResourceNames(123, 456);
    const runner = new FakeRunner();
    configureOwnedResources(runner, names);

    const audit = await auditVerificationResources({ runner });

    expect(audit.failures).toEqual([]);
    expect(audit.leftovers).toEqual(
      expect.arrayContaining([
        `Compose project ${names.projectName}`,
        "container verification-container",
        "image verification-image",
        "volume verification-volume",
        "network verification-network",
        `Buildx builder ${names.builderName}`,
        `builder container ${names.builderContainerName}`,
        `builder volume ${names.builderStateVolumeName}`,
        "legacy image legacy-image",
      ]),
    );
  });

  it("preserves a pre-existing BuildKit helper image", async () => {
    const runner = new FakeRunner();

    const failures = await removeRunOwnedBuildkitImage({
      existedBeforeRun: true,
      runner,
    });

    expect(failures).toEqual([]);
    expect(runner.calls).toEqual([]);
  });

  it("removes a BuildKit helper image pulled only for the run", async () => {
    const runner = new FakeRunner();
    runner.outputHandler = (_command, args) =>
      args.includes(`reference=${BUILDKIT_IMAGE}`) ? "buildkit-image" : "";

    const failures = await removeRunOwnedBuildkitImage({
      existedBeforeRun: false,
      runner,
    });

    expect(failures).toEqual([]);
    expect(runner.calls.map(commandText)).toContain(
      "docker image rm buildkit-image",
    );
  });
});

describe("verification orchestration", () => {
  it.each(["before build", "after image load", "after Compose startup"])(
    "always cleans, audits, and releases after a failure %s",
    async (phase) => {
      const calls: string[] = [];

      await expect(
        executeWithCleanup({
          audit: async () => {
            calls.push("audit");
          },
          cleanup: async () => {
            calls.push("cleanup");
          },
          execute: async () => {
            calls.push("execute");
            throw new Error(phase);
          },
          release: async () => {
            calls.push("release");
          },
        }),
      ).rejects.toThrow(phase);
      expect(calls).toEqual(["execute", "cleanup", "audit", "release"]);
    },
  );

  it("does not suppress cleanup failures or skip the final audit", async () => {
    const calls: string[] = [];

    await expect(
      executeWithCleanup({
        audit: async () => {
          calls.push("audit");
          return ["resource remains"];
        },
        cleanup: async () => {
          calls.push("cleanup");
          return ["compose failed", "image failed"];
        },
        execute: async () => {
          calls.push("execute");
        },
        release: async () => {
          calls.push("release");
        },
      }),
    ).rejects.toThrow("compose failed\nimage failed\nresource remains");
    expect(calls).toEqual(["execute", "cleanup", "audit", "release"]);
  });

  it("returns only after successful execution and cleanup", async () => {
    await expect(
      executeWithCleanup({
        audit: async () => undefined,
        cleanup: async () => undefined,
        execute: async () => undefined,
        release: async () => undefined,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("verification lock and signals", () => {
  it("reclaims a stale lock and removes only its own lock on release", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "verify-docker-lock-"));
    const lockPath = resolve(directory, "active.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 999, token: "stale" }));

    try {
      const release = acquireVerificationLock({
        lockPath,
        pid: 123,
        processIsAlive: () => false,
        token: "current",
      });
      expect(existsSync(lockPath)).toBe(true);

      release();

      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects a concurrent verifier with a live lock owner", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "verify-docker-lock-"));
    const lockPath = resolve(directory, "active.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 999, token: "active" }));

    try {
      expect(() =>
        acquireVerificationLock({
          lockPath,
          pid: 123,
          processIsAlive: () => true,
          token: "current",
        }),
      ).toThrow("already running in process 999");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "forwards %s once and permits cleanup commands",
    (signal) => {
      const processTarget = new EventEmitter();
      const child = {
        exitCode: null,
        kill: vi.fn(),
        signalCode: null,
      };
      const controller = createSignalController({
        getActiveChild: () => child,
        processTarget,
      });

      processTarget.emit(signal);

      expect(child.kill).toHaveBeenCalledOnce();
      expect(child.kill).toHaveBeenCalledWith(signal);
      expect(() => controller.throwIfInterrupted()).toThrow(
        `verification interrupted by ${signal}`,
      );

      controller.beginCleanup();
      expect(() => controller.throwIfInterrupted()).not.toThrow();
      controller.dispose();
      expect(processTarget.listenerCount("SIGINT")).toBe(0);
      expect(processTarget.listenerCount("SIGTERM")).toBe(0);
    },
  );
});
