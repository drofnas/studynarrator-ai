import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import type pino from "pino";
import type {
  DestinationStream,
  LevelWithSilent,
  Logger as PinoLogger,
  LoggerOptions as PinoLoggerOptions,
} from "pino";

const DEFAULT_LEVEL: LoggerLevel = "info";
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_RETENTION = 3;
const REDACTED = "[Redacted]";

const PINO_REDACTION_PATHS = [
  "scriptContent",
  "scriptSource",
  "scriptText",
  "source",
  "text",
  "content",
  "projectName",
  "project.name",
  "baseUrl",
  "baseURL",
  "*.scriptContent",
  "*.scriptSource",
  "*.scriptText",
  "*.source",
  "*.text",
  "*.content",
  "*.projectName",
  "*.project.name",
  "*.baseUrl",
  "*.baseURL",
];

export type LoggerLevel = LevelWithSilent;
export type Logger = PinoLogger;

export interface CreateLoggerOptions {
  level?: LoggerLevel;
  filePath?: string;
  maxBytes?: number;
  retention?: number;
}

type SanitizedLogValue =
  object | string | number | bigint | boolean | symbol | null | undefined;

export function serverIdentityHash(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function isSensitiveKey(key: string, parentKey?: string): boolean {
  const normalized = normalizedKey(key);
  const parent = parentKey === undefined ? "" : normalizedKey(parentKey);
  return (
    normalized === "source" ||
    normalized === "text" ||
    normalized === "content" ||
    normalized === "scriptcontent" ||
    normalized === "scriptsource" ||
    normalized === "scripttext" ||
    normalized === "projectname" ||
    (normalized === "name" && (parent === "project" || parent === "projects"))
  );
}

function isBaseUrlKey(key: string): boolean {
  return normalizedKey(key).endsWith("baseurl");
}

function sanitizeLogValue(
  value: unknown,
  parentKey: string | undefined,
  seen: WeakMap<object, SanitizedLogValue>,
): SanitizedLogValue {
  if (value === null || typeof value === "function") return value;
  if (typeof value !== "object") return value;
  if (
    value instanceof Date ||
    value instanceof Error ||
    ArrayBuffer.isView(value)
  )
    return value;

  const previous = seen.get(value);
  if (previous !== undefined) return previous;

  if (Array.isArray(value)) {
    const sanitized: unknown[] = [];
    seen.set(value, sanitized);
    for (const item of value)
      sanitized.push(sanitizeLogValue(item, parentKey, seen));
    return sanitized;
  }

  const sanitized: Record<string, unknown> = {};
  seen.set(value, sanitized);
  for (const [key, child] of Object.entries(value)) {
    if (isBaseUrlKey(key)) {
      sanitized.serverIdentityHash =
        typeof child === "string" ? serverIdentityHash(child) : REDACTED;
    } else if (isSensitiveKey(key, parentKey)) {
      sanitized[key] = REDACTED;
    } else {
      sanitized[key] = sanitizeLogValue(child, key, seen);
    }
  }
  return sanitized;
}

function sanitizeLogObject(object: Record<string, unknown>) {
  return sanitizeLogValue(object, undefined, new WeakMap()) as Record<
    string,
    unknown
  >;
}

class RotatingFileDestination implements DestinationStream {
  private currentBytes: number;

  constructor(
    private readonly filePath: string,
    private readonly maxBytes: number,
    private readonly retention: number,
  ) {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    this.currentBytes = existsSync(filePath) ? statSync(filePath).size : 0;
  }

  write(message: string): void {
    const messageBytes = Buffer.byteLength(message);
    if (
      this.currentBytes > 0 &&
      this.currentBytes + messageBytes > this.maxBytes
    ) {
      this.rotate();
    }
    appendFileSync(this.filePath, message, { encoding: "utf8", mode: 0o600 });
    this.currentBytes += messageBytes;
  }

  private rotate(): void {
    rmSync(`${this.filePath}.${this.retention}`, { force: true });
    for (let index = this.retention - 1; index >= 1; index -= 1) {
      const archive = `${this.filePath}.${index}`;
      if (existsSync(archive))
        renameSync(archive, `${this.filePath}.${index + 1}`);
    }
    renameSync(this.filePath, `${this.filePath}.1`);
    this.currentBytes = 0;
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer.`);
}

function loadPino(): typeof pino {
  const loadDependency = createRequire(import.meta.url);
  return loadDependency("pino") as typeof pino;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const pino = loadPino();
  const level =
    options.level ?? process.env.STUDYNARRATOR_LOG_LEVEL ?? DEFAULT_LEVEL;
  const loggerOptions: PinoLoggerOptions = {
    level,
    formatters: {
      bindings: sanitizeLogObject,
      log: sanitizeLogObject,
    },
    redact: {
      paths: PINO_REDACTION_PATHS,
      censor: REDACTED,
    },
  };

  if (options.filePath === undefined) return pino(loggerOptions);
  if (!options.filePath.trim()) throw new Error("filePath must not be empty.");

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const retention = options.retention ?? DEFAULT_RETENTION;
  assertPositiveInteger(maxBytes, "maxBytes");
  assertPositiveInteger(retention, "retention");

  return pino(
    loggerOptions,
    new RotatingFileDestination(options.filePath, maxBytes, retention),
  );
}
