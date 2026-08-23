import type { promises as dns } from "node:dns";
import net from "node:net";
import { spawn } from "node:child_process";

export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

type SuppliedUrlForm = "root" | "v1";

export interface NormalizedSpeachesUrl {
  rootUrl: string;
  suppliedForm: SuppliedUrlForm;
  hostname: string;
  port: number;
  protocol: "http:" | "https:";
}

export interface AudioProbeResult {
  decodable: boolean;
  formatName: string | null;
}

export interface SpeachesAdapterDependencies {
  fetch?: typeof fetch;
  lookup?: typeof dns.lookup;
  connect?: typeof connectTcp;
  probeAudio?: typeof probeAudioWithFfprobe;
  now?: () => Date;
  sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
}

export class DiagnosticFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: "timeout" | "aborted" | "network" | "invalid-response",
  ) {
    super(message);
  }
}

export function normalizeSpeachesUrl(input: string): NormalizedSpeachesUrl {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a complete HTTP or HTTPS Speaches URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Speaches URLs must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password)
    throw new Error("Credentials are not allowed in the Speaches URL.");
  if (parsed.search)
    throw new Error("Query strings are not allowed in the Speaches URL.");
  if (parsed.hash)
    throw new Error("Fragments are not allowed in the Speaches URL.");

  const path = parsed.pathname.replace(/\/+$/u, "") || "/";
  if (path !== "/" && path !== "/v1") {
    throw new Error(
      "The Speaches URL path must be either the server root or /v1.",
    );
  }
  const suppliedForm: SuppliedUrlForm = path === "/v1" ? "v1" : "root";
  parsed.pathname = "/";
  const rootUrl = parsed.toString().replace(/\/$/u, "");
  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : parsed.protocol === "https:"
      ? 443
      : 80;
  return {
    rootUrl,
    suppliedForm,
    hostname: parsed.hostname,
    port,
    protocol: parsed.protocol,
  };
}

export function combinedSignal(
  timeoutSeconds: number,
  signal?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutSeconds * 1_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

export async function withAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  return await Promise.race([
    work,
    new Promise<never>((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(abortError(signal)), {
        once: true,
      }),
    ),
  ]);
}

export async function defaultSleep(
  durationMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, durationMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError(signal));
      },
      { once: true },
    );
  });
}

export async function connectTcp(
  hostname: string,
  port: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: hostname, port });
    const onAbort = (): void => {
      socket.destroy();
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", () => {
      signal.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

export async function readBoundedBody(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          /* preserve the bounded-response failure */
        }
        throw new DiagnosticFailure(
          "audio-too-large",
          "The diagnostic audio exceeded the safe response limit.",
          "invalid-response",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function probeAudioWithFfprobe(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<AudioProbeResult> {
  return await new Promise<AudioProbeResult>((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=format_name:stream=codec_type",
        "-of",
        "json",
        "pipe:0",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderrLength = 0;
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          signal
            ? abortError(signal)
            : new DOMException("The operation was aborted.", "AbortError"),
        ),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 64_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrLength += chunk.byteLength;
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") return;
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new DiagnosticFailure(
            "ffprobe-input-failed",
            "Audio validation could not read the response.",
            "invalid-response",
          ),
        ),
      );
    });
    child.once("error", () =>
      finish(() =>
        reject(
          new DiagnosticFailure(
            "ffprobe-unavailable",
            "Audio validation is unavailable on this installation.",
            "invalid-response",
          ),
        ),
      ),
    );
    child.once("close", (code) => {
      finish(() => {
        if (code !== 0 || stderrLength > 64_000) {
          resolve({ decodable: false, formatName: null });
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as {
            format?: { format_name?: unknown };
            streams?: Array<{ codec_type?: unknown }>;
          };
          const formatName =
            typeof parsed.format?.format_name === "string"
              ? parsed.format.format_name
              : null;
          resolve({
            decodable:
              parsed.streams?.some(
                (stream) => stream.codec_type === "audio",
              ) === true,
            formatName,
          });
        } catch {
          resolve({ decodable: false, formatName: null });
        }
      });
    });
    child.stdin.end(bytes);
  });
}

export function headers(apiKey?: string): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}
