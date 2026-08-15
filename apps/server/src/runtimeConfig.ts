import { resolve } from "node:path";

const DEFAULT_PORT = 4310;
const DEFAULT_HOST = "127.0.0.1";
const DISTRIBUTIONS = new Set(["development-web", "docker-web"] as const);

interface ServerRuntimeConfiguration {
  distribution: "development-web" | "docker-web";
  host: string;
  port: number;
  requireWebDistribution: boolean;
  sourceRevision: string;
  webDistributionDirectory: string;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^\d+$/u.test(value)) throw new Error("STUDYNARRATOR_PORT must be an integer between 1 and 65535.");
  const port = Number.parseInt(value, 10);
  if (port < 1 || port > 65_535) throw new Error("STUDYNARRATOR_PORT must be an integer between 1 and 65535.");
  return port;
}

function parseHost(value: string | undefined): string {
  const host = value?.trim() || DEFAULT_HOST;
  if (/\s/u.test(host)) throw new Error("STUDYNARRATOR_LISTEN_HOST must be a hostname or IP address without whitespace.");
  return host;
}

function parseDistribution(value: string | undefined): ServerRuntimeConfiguration["distribution"] {
  const distribution = value?.trim() || "development-web";
  if (!DISTRIBUTIONS.has(distribution as ServerRuntimeConfiguration["distribution"])) {
    throw new Error("STUDYNARRATOR_DISTRIBUTION must be development-web or docker-web.");
  }
  return distribution as ServerRuntimeConfiguration["distribution"];
}

function parseSourceRevision(value: string | undefined): string {
  const sourceRevision = value?.trim() || "development";
  if (sourceRevision.length > 128 || /[\r\n]/u.test(sourceRevision)) {
    throw new Error("STUDYNARRATOR_SOURCE_REVISION must be a single value no longer than 128 characters.");
  }
  return sourceRevision;
}

export function resolveServerRuntimeConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  repositoryRoot = resolve(import.meta.dirname, "../../..")
): ServerRuntimeConfiguration {
  const distribution = parseDistribution(environment.STUDYNARRATOR_DISTRIBUTION);
  return {
    distribution,
    host: parseHost(environment.STUDYNARRATOR_LISTEN_HOST),
    port: parsePort(environment.STUDYNARRATOR_PORT),
    requireWebDistribution: environment.STUDYNARRATOR_REQUIRE_WEB_DIST === "true" || distribution === "docker-web",
    sourceRevision: parseSourceRevision(environment.STUDYNARRATOR_SOURCE_REVISION),
    webDistributionDirectory: resolve(
      environment.INIT_CWD ?? repositoryRoot,
      environment.STUDYNARRATOR_WEB_DIST ?? "apps/web/dist"
    )
  };
}
