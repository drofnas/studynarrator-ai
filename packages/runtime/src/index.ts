import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import type { FfmpegCheck } from "@studynarrator/application";

export { createLogger, serverIdentityHash } from "./logger.js";
export type { CreateLoggerOptions, Logger, LoggerLevel } from "./logger.js";

interface ChildProcessLike {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): this;
  once(event: "close", listener: (exitCode: number | null) => void): this;
  kill(signal: NodeJS.Signals): boolean;
}

type SpawnFunction = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessLike;

function failure(
  executable: string,
  code: string,
  message: string,
): FfmpegCheck {
  return { status: "fail", executable, code, message };
}

export function createFfmpegProbe(
  options: {
    executable?: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
    spawnProcess?: SpawnFunction;
  } = {},
) {
  const executable =
    options.executable ?? process.env.STUDYNARRATOR_FFMPEG_PATH ?? "ffmpeg";
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxOutputBytes = options.maxOutputBytes ?? 16_384;
  const spawnProcess = options.spawnProcess ?? (spawn as SpawnFunction);

  return {
    async run(): Promise<FfmpegCheck> {
      return await new Promise((resolve) => {
        let settled = false;
        let output = "";
        let child: ChildProcessLike;

        const finish = (result: FfmpegCheck) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        };

        const append = (chunk: Buffer | string) => {
          if (output.length >= maxOutputBytes) return;
          output += chunk.toString().slice(0, maxOutputBytes - output.length);
        };

        try {
          child = spawnProcess(executable, ["-version"], {
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          });
        } catch {
          resolve(
            failure(
              executable,
              "FFMPEG_START_FAILED",
              "FFmpeg could not be started.",
            ),
          );
          return;
        }

        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(
            failure(
              executable,
              "FFMPEG_TIMEOUT",
              "FFmpeg did not respond before the diagnostic timeout.",
            ),
          );
        }, timeoutMs);

        child.stdout.on("data", append);
        child.stderr.on("data", append);
        child.once("error", (error: NodeJS.ErrnoException) => {
          const notFound = error.code === "ENOENT";
          finish(
            failure(
              executable,
              notFound ? "FFMPEG_NOT_FOUND" : "FFMPEG_START_FAILED",
              notFound
                ? "FFmpeg was not found. Configure an executable path and retry."
                : "FFmpeg could not be started.",
            ),
          );
        });
        child.once("close", (exitCode) => {
          if (exitCode !== 0) {
            finish(
              failure(
                executable,
                "FFMPEG_EXIT_FAILED",
                "FFmpeg returned an unsuccessful exit status.",
              ),
            );
            return;
          }
          const version = output
            .split(/\r?\n/u)
            .find((line) => line.trim().length > 0)
            ?.trim();
          if (!version) {
            finish(
              failure(
                executable,
                "FFMPEG_INVALID_OUTPUT",
                "FFmpeg did not return recognizable version information.",
              ),
            );
            return;
          }
          finish({ status: "pass", executable, version });
        });
      });
    },
  };
}
