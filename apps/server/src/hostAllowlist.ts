import { isIP } from "node:net";
import type { RequestHandler } from "express";
import { BoundaryErrorSchema } from "@studynarrator/shared-types";

export const DEFAULT_HOST_ALLOWLIST = [
  "localhost",
  "127.0.0.1",
  "[::1]",
] as const;

const FORBIDDEN_HOST_RESPONSE = BoundaryErrorSchema.parse({
  error: {
    code: "HOST_NOT_ALLOWED",
    message: "The request host is not allowed.",
  },
});

function hasValidPort(port: string | undefined): boolean {
  if (port === undefined) return true;
  if (!/^[1-9]\d{0,4}$/u.test(port)) return false;
  const number = Number(port);
  return number <= 65_535;
}

function hasValidHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  if (isIP(host) === 4) return true;
  return host
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

function normalizeHost(
  value: string,
  allowBareIpv6: boolean,
): string | undefined {
  if (value.length === 0 || value !== value.trim() || /\s/u.test(value))
    return undefined;
  const host = value.toLowerCase();
  const bracketedIpv6 = /^\[([^\]]+)\](?::(\d+))?$/u.exec(host);
  if (bracketedIpv6) {
    const [, ipv6, port] = bracketedIpv6;
    return ipv6 !== undefined && isIP(ipv6) === 6 && hasValidPort(port)
      ? ipv6
      : undefined;
  }
  if (isIP(host) === 6) return allowBareIpv6 ? host : undefined;
  const hostname = /^([^:]+)(?::(\d+))?$/u.exec(host);
  if (!hostname) return undefined;
  const [, name, port] = hostname;
  return name !== undefined && hasValidHostname(name) && hasValidPort(port)
    ? name
    : undefined;
}

export function normalizeAllowedHost(value: string): string | undefined {
  return normalizeHost(value, true);
}

function normalizeRequestHost(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeHost(value, false) : undefined;
}

export function createHostAllowlistMiddleware(
  allowedHosts: readonly string[] = DEFAULT_HOST_ALLOWLIST,
): RequestHandler {
  const normalizedHosts = new Set(
    allowedHosts.map((host) => {
      const normalized = normalizeAllowedHost(host);
      if (normalized === undefined)
        throw new Error("The host allowlist contains an invalid host.");
      return normalized;
    }),
  );

  return (request, response, next) => {
    const host = normalizeRequestHost(request.headers.host);
    if (host === undefined || !normalizedHosts.has(host)) {
      response.status(403).json(FORBIDDEN_HOST_RESPONSE);
      return;
    }
    next();
  };
}
