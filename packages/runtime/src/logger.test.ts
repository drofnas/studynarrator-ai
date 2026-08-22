import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prettyFactory } from "pino-pretty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, serverIdentityHash } from "./index.js";
import type { CreateLoggerOptions, Logger, LoggerLevel } from "./index.js";

const originalLogLevel = process.env.STUDYNARRATOR_LOG_LEVEL;
const temporaryDirectories: string[] = [];

function temporaryLogPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "studynarrator-logger-"));
  temporaryDirectories.push(directory);
  return join(directory, "runtime.log");
}

function readEntries(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(() => {
  if (originalLogLevel === undefined)
    delete process.env.STUDYNARRATOR_LOG_LEVEL;
  else process.env.STUDYNARRATOR_LOG_LEVEL = originalLogLevel;
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe.sequential("createLogger", () => {
  it("resolves an explicit level before the environment and defaults to info", () => {
    process.env.STUDYNARRATOR_LOG_LEVEL = "error";
    const level: LoggerLevel = "debug";
    const options: CreateLoggerOptions = { level };
    const logger: Logger = createLogger(options);
    expect(logger.level).toBe("debug");

    process.env.STUDYNARRATOR_LOG_LEVEL = "warn";
    expect(createLogger().level).toBe("warn");

    delete process.env.STUDYNARRATOR_LOG_LEVEL;
    expect(createLogger().level).toBe("info");
  });

  it("writes structured JSON to stdout when no file is supplied", () => {
    const output: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

    try {
      const logger = createLogger();
      logger.info({ event: "runtime-ready" }, "Runtime ready");
      logger.flush();
    } finally {
      write.mockRestore();
    }

    expect(
      JSON.parse(output.join("")) as Record<string, unknown>,
    ).toMatchObject({
      level: 30,
      event: "runtime-ready",
      msg: "Runtime ready",
    });
  });

  it("writes structured JSON to a file synchronously", () => {
    const filePath = temporaryLogPath();
    const logger = createLogger({ filePath });

    logger.info({ event: "runtime-ready", attempt: 2 }, "Runtime ready");

    const entries = readEntries(filePath);
    expect(entries).toEqual([
      expect.objectContaining({
        level: 30,
        event: "runtime-ready",
        attempt: 2,
        msg: "Runtime ready",
      }),
    ]);
    expect(prettyFactory({ colorize: false })(entries[0])).toContain(
      "Runtime ready",
    );
  });

  it("redacts nested script and project fields and hashes trimmed base URLs", () => {
    const filePath = temporaryLogPath();
    const logger = createLogger({ filePath });
    const baseUrl = "  http://private-speaches.internal:8000/v1  ";
    const expectedHash = createHash("sha256")
      .update(baseUrl.trim())
      .digest("hex");

    logger.info(
      {
        scriptContent: "private script content",
        "script-content": "private kebab script content",
        script: {
          source: "private source",
          text: "private text",
          content: "private nested content",
        },
        projectName: "Private Project",
        "project-name": "Private Kebab Project",
        project: { name: "Nested Private Project", id: "project-id" },
        connection: { baseUrl },
      },
      "Project metadata updated",
    );

    const output = readFileSync(filePath, "utf8");
    const [entry] = readEntries(filePath);
    expect(output).not.toContain("private script content");
    expect(output).not.toContain("private kebab script content");
    expect(output).not.toContain("private source");
    expect(output).not.toContain("private text");
    expect(output).not.toContain("private nested content");
    expect(output).not.toContain("Private Project");
    expect(output).not.toContain("Private Kebab Project");
    expect(output).not.toContain("Nested Private Project");
    expect(output).not.toContain("private-speaches.internal");
    expect(output).not.toContain(baseUrl.trim());
    expect(entry).toMatchObject({
      scriptContent: "[Redacted]",
      "script-content": "[Redacted]",
      script: {
        source: "[Redacted]",
        text: "[Redacted]",
        content: "[Redacted]",
      },
      projectName: "[Redacted]",
      "project-name": "[Redacted]",
      project: { name: "[Redacted]", id: "project-id" },
      connection: { serverIdentityHash: expectedHash },
    });
    expect(serverIdentityHash(baseUrl)).toBe(expectedHash);
  });

  it("sanitizes child bindings before they are serialized", () => {
    const filePath = temporaryLogPath();
    const logger = createLogger({ filePath }).child({
      project: { name: "Private Child Project" },
      connection: { baseUrl: "http://child-speaches.internal:8000" },
    });

    logger.info("Child metadata");

    const output = readFileSync(filePath, "utf8");
    expect(output).not.toContain("Private Child Project");
    expect(output).not.toContain("child-speaches.internal");
  });

  it("rotates before oversized writes and retains only recent archives", () => {
    const filePath = temporaryLogPath();
    const logger = createLogger({ filePath, maxBytes: 1, retention: 2 });

    for (let sequence = 1; sequence <= 5; sequence += 1)
      logger.info({ sequence }, "Rotation entry");

    expect(readFileSync(filePath, "utf8")).toContain('"sequence":5');
    expect(readFileSync(`${filePath}.1`, "utf8")).toContain('"sequence":4');
    expect(readFileSync(`${filePath}.2`, "utf8")).toContain('"sequence":3');
    expect(existsSync(`${filePath}.3`)).toBe(false);
  });
});
