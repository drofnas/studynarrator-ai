import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface ComposeService {
  command?: string[];
  network_mode?: string;
  privileged?: boolean;
  cap_add?: string[];
  ports?: { host_ip: string; target: number }[];
  volumes?: {
    type: string;
    source: string;
    target: string;
    read_only?: boolean;
  }[];
  environment?: Record<string, string>;
}

function compose(file: string): Record<string, ComposeService> {
  const output = execFileSync(
    "docker",
    ["compose", "--file", file, "--profile", "*", "config", "--format", "json"],
    { encoding: "utf8" },
  );
  return (JSON.parse(output) as { services: Record<string, ComposeService> })
    .services;
}

describe("containerized development", () => {
  it("keeps the daemon socket and writable data inside Docker", () => {
    const services = compose("compose.development.yaml");

    expect(Object.keys(services).sort()).toEqual([
      "docker",
      "tools",
      "verify",
      "web",
    ]);
    expect(services.docker?.privileged).toBe(true);
    expect(services.docker?.ports).toBeUndefined();
    expect(services.docker?.command).toContain(
      "--host=unix:///docker-socket/docker.sock",
    );
    expect(services.verify?.network_mode).toBe("service:docker");
    expect(services.verify?.privileged).not.toBe(true);
    expect(services.tools?.privileged).not.toBe(true);
    expect(services.web?.cap_add).toBeUndefined();
    for (const [name, service] of Object.entries(services)) {
      for (const mount of service.volumes ?? []) {
        if (mount.type === "bind") {
          expect(name).toBe("verify");
          expect(mount.target).toBe("/workspace/.git");
          expect(mount.read_only).toBe(true);
        }
      }
    }
    expect(services.web?.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", target: 5173 }),
    ]);
    expect(services.web?.environment?.STUDYNARRATOR_DATA_DIR).toBe(
      "/workspace/.tmp/dev/web",
    );
  });

  it("keeps development services out of the production distribution", () => {
    const services = compose("compose.yaml");

    expect(Object.keys(services)).toEqual(["study-narrator"]);
    expect(services["study-narrator"]?.privileged).not.toBe(true);
    expect(services["study-narrator"]?.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", target: 4310 }),
    ]);
  });

  it("runs the exact pinned Node, npm, and scanner versions as a non-root user", () => {
    expect(process.getuid?.()).toBeGreaterThan(0);
    expect(process.versions.node).toBe(readFileSync(".nvmrc", "utf8").trim());
    const { packageManager } = JSON.parse(
      readFileSync("package.json", "utf8"),
    ) as { packageManager: string };
    expect(
      execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    ).toBe(packageManager.slice(4));
    expect(
      execFileSync("trivy", ["--version"], { encoding: "utf8" }),
    ).toContain(`Version: ${readFileSync(".trivy-version", "utf8").trim()}\n`);
  });
});
