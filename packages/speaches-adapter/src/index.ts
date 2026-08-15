import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import net from "node:net";
import { spawn } from "node:child_process";
import type {
  ConnectionDiagnosticStage,
  ConnectionTestOverall,
  ConnectionTestSummary,
  SpeechCatalog,
  SpeechCatalogVoice
} from "@studynarrator/shared-types";
import { CONNECTION_DIAGNOSTIC_SCHEMA_VERSION, SpeechCatalogSchema } from "@studynarrator/shared-types";

const DIAGNOSTIC_TEXT = "StudyNarrator connection check.";
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_ERROR_LENGTH = 280;
const STAGE_NAMES = ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"] as const;

type SuppliedUrlForm = "root" | "v1";

interface NormalizedSpeachesUrl {
  rootUrl: string;
  suppliedForm: SuppliedUrlForm;
  hostname: string;
  port: number;
  protocol: "http:" | "https:";
}

interface SpeachesDiagnosticInput {
  baseUrl: string;
  modelId: string | null;
  voiceId: string | null;
  apiKey?: string | undefined;
  timeoutSeconds: number;
  signal?: AbortSignal | undefined;
}

export interface SpeachesDiagnosticResult {
  normalizedUrl: NormalizedSpeachesUrl | null;
  summary: ConnectionTestSummary;
}

interface AudioProbeResult {
  decodable: boolean;
  formatName: string | null;
}

interface SpeachesAdapterDependencies {
  fetch?: typeof fetch;
  lookup?: typeof dns.lookup;
  connect?: typeof connectTcp;
  probeAudio?: typeof probeAudioWithFfprobe;
  now?: () => Date;
  sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
}

type SpeachesSynthesisErrorCode =
  | "aborted"
  | "audioTooLarge"
  | "authenticationRequired"
  | "configurationError"
  | "invalidAudio"
  | "selectionRejected"
  | "unavailable";

export class SpeachesSynthesisError extends Error {
  constructor(
    readonly code: SpeachesSynthesisErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus: number | null = null
  ) {
    super(message);
  }
}

export interface SpeachesSynthesisInput {
  baseUrl: string;
  modelId: string;
  voiceId: string;
  speed: number;
  text: string;
  apiKey?: string | undefined;
  timeoutSeconds: number;
  retryCount: number;
  signal?: AbortSignal | undefined;
}

export interface SpeachesSynthesisResult {
  bytes: Uint8Array;
  mimeType: "audio/wav";
  attempts: number;
}

type SpeachesCatalogErrorCode =
  | "aborted"
  | "authenticationRequired"
  | "configurationError"
  | "invalidResponse"
  | "unavailable";

export class SpeachesCatalogError extends Error {
  constructor(
    readonly code: SpeachesCatalogErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus: number | null = null
  ) {
    super(message);
  }
}

export interface SpeachesCatalogInput {
  baseUrl: string;
  apiKey?: string | undefined;
  timeoutSeconds: number;
  retryCount: number;
  signal?: AbortSignal | undefined;
}

class DiagnosticFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: "timeout" | "aborted" | "network" | "invalid-response"
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
  if (parsed.username || parsed.password) throw new Error("Credentials are not allowed in the Speaches URL.");
  if (parsed.search) throw new Error("Query strings are not allowed in the Speaches URL.");
  if (parsed.hash) throw new Error("Fragments are not allowed in the Speaches URL.");

  const path = parsed.pathname.replace(/\/+$/u, "") || "/";
  if (path !== "/" && path !== "/v1") {
    throw new Error("The Speaches URL path must be either the server root or /v1.");
  }
  const suppliedForm: SuppliedUrlForm = path === "/v1" ? "v1" : "root";
  parsed.pathname = "/";
  const rootUrl = parsed.toString().replace(/\/$/u, "");
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80;
  return { rootUrl, suppliedForm, hostname: parsed.hostname, port, protocol: parsed.protocol };
}

function elapsed(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function stage(
  name: (typeof STAGE_NAMES)[number],
  status: ConnectionDiagnosticStage["status"],
  code: string,
  message: string,
  durationMs: number
): ConnectionDiagnosticStage {
  return { stage: name, status, code, message: sanitizeMessage(message), durationMs };
}

function sanitizeMessage(message: string): string {
  return message.replace(/https?:\/\/[^\s]+/giu, "the configured endpoint").replace(/[\r\n\t]+/gu, " ").slice(0, MAX_ERROR_LENGTH);
}

function skipped(name: (typeof STAGE_NAMES)[number], code = "not-run"): ConnectionDiagnosticStage {
  return stage(name, "skipped", code, "Not run because an earlier stage did not pass.", 0);
}

function finishStages(stages: ConnectionDiagnosticStage[]): ConnectionDiagnosticStage[] {
  for (const name of STAGE_NAMES.slice(stages.length)) stages.push(skipped(name));
  return stages;
}

function errorFailure(error: unknown, fallbackCode: string): DiagnosticFailure {
  if (error instanceof DiagnosticFailure) return error;
  if (error instanceof DOMException && error.name === "AbortError") return new DiagnosticFailure("request-aborted", "The connection check was cancelled.", "aborted");
  if (error instanceof DOMException && error.name === "TimeoutError") return new DiagnosticFailure("request-timeout", "The configured timeout elapsed.", "timeout");
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code.toLowerCase() : fallbackCode;
  return new DiagnosticFailure(code, "The endpoint could not be reached at this stage.", "network");
}

function combinedSignal(timeoutSeconds: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutSeconds * 1_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

async function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  return await Promise.race([
    work,
    new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(abortError(signal)), { once: true }))
  ]);
}

async function defaultSleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, durationMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(abortError(signal));
    }, { once: true });
  });
}

async function connectTcp(hostname: string, port: number, signal: AbortSignal): Promise<void> {
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

async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array> {
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
        try { await reader.cancel(); } catch { /* preserve the bounded-response failure */ }
        throw new DiagnosticFailure("audio-too-large", "The diagnostic audio exceeded the safe response limit.", "invalid-response");
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

export async function probeAudioWithFfprobe(bytes: Uint8Array, signal?: AbortSignal): Promise<AudioProbeResult> {
  return await new Promise<AudioProbeResult>((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=format_name:stream=codec_type", "-of", "json", "pipe:0"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
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
      finish(() => reject(signal ? abortError(signal) : new DOMException("The operation was aborted.", "AbortError")));
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
      finish(() => reject(new DiagnosticFailure("ffprobe-input-failed", "Audio validation could not read the response.", "invalid-response")));
    });
    child.once("error", () => finish(() => reject(new DiagnosticFailure("ffprobe-unavailable", "Audio validation is unavailable on this installation.", "invalid-response"))));
    child.once("close", (code) => {
      finish(() => {
        if (code !== 0 || stderrLength > 64_000) {
          resolve({ decodable: false, formatName: null });
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as { format?: { format_name?: unknown }; streams?: Array<{ codec_type?: unknown }> };
          const formatName = typeof parsed.format?.format_name === "string" ? parsed.format.format_name : null;
          resolve({ decodable: parsed.streams?.some((stream) => stream.codec_type === "audio") === true, formatName });
        } catch {
          resolve({ decodable: false, formatName: null });
        }
      });
    });
    child.stdin.end(bytes);
  });
}

function parseIdentifiers(payload: unknown, keys: readonly string[]): string[] {
  const candidate = typeof payload === "object" && payload !== null
    ? "data" in payload ? payload.data : "voices" in payload ? payload.voices : payload
    : payload;
  if (!Array.isArray(candidate)) return [];
  const identifiers = new Set<string>();
  for (const item of candidate) {
    if (typeof item === "string") identifiers.add(item);
    if (typeof item === "object" && item !== null) {
      for (const key of keys) {
        const value = key in item ? (item as Record<string, unknown>)[key] : undefined;
        if (typeof value === "string" && value.length > 0) {
          identifiers.add(value);
          break;
        }
      }
    }
  }
  return [...identifiers].sort();
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseCatalogVoice(value: unknown): SpeechCatalogVoice {
  if (typeof value === "string" && value.trim().length > 0) {
    return { voiceId: value.trim(), name: null, language: null, gender: null };
  }
  if (typeof value !== "object" || value === null) {
    throw new SpeachesCatalogError("invalidResponse", "Speaches returned invalid speech-model voice metadata.", false);
  }
  const record = value as Record<string, unknown>;
  const voiceId = optionalString(record, "id") ?? optionalString(record, "voice_id") ?? optionalString(record, "voice");
  if (!voiceId) throw new SpeachesCatalogError("invalidResponse", "Speaches returned a voice without an identifier.", false);
  return {
    voiceId,
    name: optionalString(record, "name"),
    language: optionalString(record, "language"),
    gender: optionalString(record, "gender")
  };
}

function parseSpeechCatalog(payload: unknown): SpeechCatalog {
  if (typeof payload !== "object" || payload === null || !("models" in payload) || !Array.isArray(payload.models)) {
    throw new SpeachesCatalogError("invalidResponse", "Speaches returned invalid speech-model discovery data.", false);
  }
  if (payload.models.length > 2_000) throw new SpeachesCatalogError("invalidResponse", "Speaches returned too many speech models.", false);
  const models = new Map<string, Map<string, SpeechCatalogVoice>>();
  for (const value of payload.models) {
    if (typeof value !== "object" || value === null) {
      throw new SpeachesCatalogError("invalidResponse", "Speaches returned invalid speech-model metadata.", false);
    }
    const record = value as Record<string, unknown>;
    const modelId = optionalString(record, "id") ?? optionalString(record, "model");
    if (!modelId || !Array.isArray(record.voices)) {
      throw new SpeachesCatalogError("invalidResponse", "Speaches returned a speech model without valid voice metadata.", false);
    }
    if (record.voices.length > 10_000) throw new SpeachesCatalogError("invalidResponse", "Speaches returned too many voices for one speech model.", false);
    const voices = models.get(modelId) ?? new Map<string, SpeechCatalogVoice>();
    for (const voiceValue of record.voices) {
      const voice = parseCatalogVoice(voiceValue);
      if (!voices.has(voice.voiceId)) voices.set(voice.voiceId, voice);
    }
    models.set(modelId, voices);
  }
  return SpeechCatalogSchema.parse({
    schemaVersion: CONNECTION_DIAGNOSTIC_SCHEMA_VERSION,
    models: [...models].map(([modelId, voices]) => ({ modelId, voices: [...voices.values()] }))
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 2_000_000) throw new DiagnosticFailure("response-too-large", "The endpoint returned an unexpectedly large discovery response.", "invalid-response");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DiagnosticFailure("invalid-json", "The endpoint returned invalid discovery data.", "invalid-response");
  }
}

function headers(apiKey?: string): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function catalogFailure(error: unknown, externalSignal?: AbortSignal): SpeachesCatalogError {
  if (error instanceof SpeachesCatalogError) return error;
  if (error instanceof DiagnosticFailure) {
    if (error.kind === "invalid-response") return new SpeachesCatalogError("invalidResponse", "Speaches returned invalid speech-model metadata.", false);
    if (error.kind === "aborted") return new SpeachesCatalogError("aborted", "Speech catalog discovery was cancelled.", false);
    return new SpeachesCatalogError("unavailable", "The configured Speaches service could not provide its speech catalog.", true);
  }
  if (externalSignal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
    return new SpeachesCatalogError("aborted", "Speech catalog discovery was cancelled.", false);
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new SpeachesCatalogError("unavailable", "Speech catalog discovery timed out.", true);
  }
  return new SpeachesCatalogError("unavailable", "The configured Speaches service could not provide its speech catalog.", true);
}

export async function discoverSpeachesSpeechCatalog(
  input: SpeachesCatalogInput,
  dependencies: SpeachesAdapterDependencies = {}
): Promise<SpeechCatalog> {
  if (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > 600
    || !Number.isInteger(input.retryCount) || input.retryCount < 0 || input.retryCount > 5) {
    throw new SpeachesCatalogError("configurationError", "The connection settings cannot be used to discover speech models.", false);
  }
  let normalized: NormalizedSpeachesUrl;
  try {
    normalized = normalizeSpeachesUrl(input.baseUrl);
  } catch {
    throw new SpeachesCatalogError("configurationError", "The connection has an invalid Speaches URL.", false);
  }
  const fetchImpl = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? defaultSleep;
  const maximumAttempts = input.retryCount + 1;
  let lastFailure: SpeachesCatalogError | undefined;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (input.signal?.aborted) throw new SpeachesCatalogError("aborted", "Speech catalog discovery was cancelled.", false);
    const signal = combinedSignal(input.timeoutSeconds, input.signal);
    try {
      const response = await fetchImpl(`${normalized.rootUrl}/v1/audio/models`, {
        method: "GET",
        headers: { ...headers(input.apiKey), Accept: "application/json" },
        signal
      });
      if (response.status === 401 || response.status === 403) {
        throw new SpeachesCatalogError("authenticationRequired", "Speaches rejected authentication for speech catalog discovery.", false, response.status);
      }
      if (response.status === 429 || response.status >= 500) {
        throw new SpeachesCatalogError("unavailable", "Speaches is temporarily unavailable for speech catalog discovery.", true, response.status);
      }
      if (!response.ok) {
        throw new SpeachesCatalogError("invalidResponse", "Speaches rejected speech catalog discovery.", false, response.status);
      }
      return parseSpeechCatalog(await readJson(response));
    } catch (error) {
      const failure = catalogFailure(error, input.signal);
      if (!failure.retryable || attempt === maximumAttempts) throw failure;
      lastFailure = failure;
      try {
        await sleep(Math.min(1_000, 100 * 2 ** (attempt - 1)), input.signal);
      } catch (sleepError) {
        throw catalogFailure(sleepError, input.signal);
      }
    }
  }
  throw lastFailure ?? new SpeachesCatalogError("unavailable", "Speech catalog discovery did not complete.", true);
}

function result(
  overall: ConnectionTestOverall,
  testedAt: Date,
  httpStatus: number | null,
  stages: ConnectionDiagnosticStage[],
  availableModelIds: string[],
  availableVoiceIds: string[] | null
): ConnectionTestSummary {
  return {
    schemaVersion: CONNECTION_DIAGNOSTIC_SCHEMA_VERSION,
    overall,
    testedAt: testedAt.toISOString(),
    httpStatus,
    stages: finishStages(stages),
    availableModelIds,
    availableVoiceIds
  };
}

export async function diagnoseSpeaches(
  input: SpeachesDiagnosticInput,
  dependencies: SpeachesAdapterDependencies = {}
): Promise<SpeachesDiagnosticResult> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const lookup = dependencies.lookup ?? dns.lookup;
  const tcpConnect = dependencies.connect ?? connectTcp;
  const audioProbe = dependencies.probeAudio ?? probeAudioWithFfprobe;
  const testedAt = (dependencies.now ?? (() => new Date()))();
  const stages: ConnectionDiagnosticStage[] = [];
  let normalized: NormalizedSpeachesUrl;
  let started = performance.now();
  try {
    normalized = normalizeSpeachesUrl(input.baseUrl);
    stages.push(stage("url", "pass", "url-valid", "The endpoint URL is valid.", elapsed(started)));
  } catch (error) {
    stages.push(stage("url", "fail", "url-invalid", error instanceof Error ? error.message : "The endpoint URL is invalid.", elapsed(started)));
    return { normalizedUrl: null, summary: result("configurationError", testedAt, null, stages, [], null) };
  }

  const signal = combinedSignal(input.timeoutSeconds, input.signal);
  started = performance.now();
  try {
    if (isIP(normalized.hostname) === 0) await withAbort(lookup(normalized.hostname), signal);
    stages.push(stage("dns", "pass", isIP(normalized.hostname) === 0 ? "dns-resolved" : "dns-ip-literal", "The endpoint address resolved.", elapsed(started)));
  } catch (error) {
    const failure = errorFailure(error, "dns-failed");
    stages.push(stage("dns", "fail", failure.code, failure.message, elapsed(started)));
    return { normalizedUrl: normalized, summary: result("disconnected", testedAt, null, stages, [], null) };
  }

  started = performance.now();
  try {
    await tcpConnect(normalized.hostname, normalized.port, signal);
    stages.push(stage("tcp", "pass", "tcp-connected", "A TCP connection was established.", elapsed(started)));
  } catch (error) {
    const failure = errorFailure(error, "tcp-failed");
    stages.push(stage("tcp", "fail", failure.code, failure.message, elapsed(started)));
    return { normalizedUrl: normalized, summary: result("disconnected", testedAt, null, stages, [], null) };
  }

  let response: Response;
  started = performance.now();
  try {
    response = await fetchImpl(`${normalized.rootUrl}/health`, { method: "GET", headers: headers(input.apiKey), signal });
    if (!response.ok && response.status !== 401 && response.status !== 403) {
      stages.push(stage("http", "fail", `http-${response.status}`, "The health endpoint returned an unsuccessful status.", elapsed(started)));
      return { normalizedUrl: normalized, summary: result("disconnected", testedAt, response.status, stages, [], null) };
    }
    stages.push(stage("http", "pass", "http-reachable", "The Speaches HTTP service responded.", elapsed(started)));
  } catch (error) {
    const failure = errorFailure(error, "http-failed");
    stages.push(stage("http", "fail", failure.code, failure.message, elapsed(started)));
    return { normalizedUrl: normalized, summary: result("disconnected", testedAt, null, stages, [], null) };
  }

  started = performance.now();
  try {
    response = await fetchImpl(`${normalized.rootUrl}/v1/models`, { method: "GET", headers: headers(input.apiKey), signal });
  } catch (error) {
    const failure = errorFailure(error, "authentication-check-failed");
    stages.push(stage("authentication", "fail", failure.code, failure.message, elapsed(started)));
    return { normalizedUrl: normalized, summary: result("disconnected", testedAt, null, stages, [], null) };
  }
  if (response.status === 401 || response.status === 403) {
    stages.push(stage("authentication", "fail", response.status === 401 ? "authentication-required" : "authentication-forbidden", "This Speaches server requires authentication, which StudyNarrator does not support.", elapsed(started)));
    return { normalizedUrl: normalized, summary: result("authenticationRequired", testedAt, response.status, stages, [], null) };
  }
  if (!response.ok) {
    stages.push(stage("authentication", "pass", "authentication-accepted", "The endpoint did not reject authentication.", elapsed(started)));
    stages.push(stage("model", "fail", `models-http-${response.status}`, "Model discovery returned an unsuccessful status.", 0));
    return { normalizedUrl: normalized, summary: result("modelUnavailable", testedAt, response.status, stages, [], null) };
  }
  stages.push(stage("authentication", "pass", "authentication-accepted", "Authentication was accepted or is not required.", elapsed(started)));

  started = performance.now();
  let models: string[];
  try {
    models = parseIdentifiers(await readJson(response), ["id", "model"]);
  } catch (error) {
    const failure = errorFailure(error, "models-invalid");
    stages.push(stage("model", "fail", failure.code, failure.message, elapsed(started)));
    return { normalizedUrl: normalized, summary: result("modelUnavailable", testedAt, response.status, stages, [], null) };
  }
  if (!input.modelId) {
    stages.push(stage("model", "fail", "model-not-configured", "Choose a model before testing speech.", elapsed(started)));
    return { normalizedUrl: normalized, summary: result("configurationError", testedAt, response.status, stages, models, null) };
  }
  if (!models.includes(input.modelId)) {
    stages.push(stage("model", "fail", "model-unavailable", "The configured model was not reported by Speaches.", elapsed(started)));
    return { normalizedUrl: normalized, summary: result("modelUnavailable", testedAt, response.status, stages, models, null) };
  }
  stages.push(stage("model", "pass", "model-available", "The configured model is available.", elapsed(started)));

  started = performance.now();
  let voices: string[] | null = null;
  try {
    const catalogResponse = await fetchImpl(`${normalized.rootUrl}/v1/audio/models`, { method: "GET", headers: headers(input.apiKey), signal });
    if (catalogResponse.ok) {
      const catalog = parseSpeechCatalog(await readJson(catalogResponse));
      voices = catalog.models.find(({ modelId }) => modelId === input.modelId)?.voices.map(({ voiceId }) => voiceId) ?? [];
      stages.push(stage("voice", "pass", voices.includes(input.voiceId ?? "") ? "voice-listed-for-model" : "model-voice-list-checked", "The selected model's voice catalog was checked; speech remains definitive.", elapsed(started)));
    } else {
      const voiceResponse = await fetchImpl(`${normalized.rootUrl}/v1/audio/voices`, { method: "GET", headers: headers(input.apiKey), signal });
      if (voiceResponse.ok) {
        voices = parseIdentifiers(await readJson(voiceResponse), ["id", "voice_id", "voice"]);
        stages.push(stage("voice", "pass", voices.includes(input.voiceId ?? "") ? "voice-listed" : "voice-list-checked", "The optional installation voice catalog was checked; speech remains definitive.", elapsed(started)));
      } else {
        stages.push(stage("voice", "skipped", "voice-list-unavailable", "The optional voice catalog is unavailable; speech will verify the voice.", elapsed(started)));
      }
    }
  } catch {
    stages.push(stage("voice", "skipped", "voice-list-unavailable", "The optional voice catalog is unavailable; speech will verify the voice.", elapsed(started)));
  }
  if (!input.voiceId) {
    stages[stages.length - 1] = stage("voice", "fail", "voice-not-configured", "Choose a voice before testing speech.", elapsed(started));
    return { normalizedUrl: normalized, summary: result("configurationError", testedAt, response.status, stages, models, voices) };
  }

  started = performance.now();
  let speechResponse: Response;
  try {
    speechResponse = await fetchImpl(`${normalized.rootUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { ...headers(input.apiKey), "Content-Type": "application/json", Accept: "audio/wav" },
      body: JSON.stringify({ model: input.modelId, voice: input.voiceId, input: DIAGNOSTIC_TEXT, response_format: "wav" }),
      signal
    });
  } catch (error) {
    const failure = errorFailure(error, "speech-request-failed");
    stages.push(stage("audio", "fail", failure.code, failure.message, elapsed(started)));
    return { normalizedUrl: normalized, summary: result("disconnected", testedAt, null, stages, models, voices) };
  }
  if (speechResponse.status === 401 || speechResponse.status === 403) {
    stages.push(stage("audio", "fail", "speech-authentication-required", "The speech request rejected authentication.", elapsed(started)));
    return { normalizedUrl: normalized, summary: result("authenticationRequired", testedAt, speechResponse.status, stages, models, voices) };
  }
  if (!speechResponse.ok) {
    stages.push(stage("audio", "fail", `voice-rejected-${speechResponse.status}`, "The speech request rejected the configured model or voice.", elapsed(started)));
    return { normalizedUrl: normalized, summary: result("voiceUnavailable", testedAt, speechResponse.status, stages, models, voices) };
  }
  const contentType = speechResponse.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!contentType.startsWith("audio/")) {
    stages.push(stage("audio", "fail", "audio-content-type-invalid", "The speech response did not declare audio content.", elapsed(started)));
    return { normalizedUrl: normalized, summary: result("invalidAudio", testedAt, speechResponse.status, stages, models, voices) };
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(speechResponse, MAX_AUDIO_BYTES);
  } catch (error) {
    const failure = errorFailure(error, "audio-read-failed");
    stages.push(stage("audio", "fail", failure.code, failure.message, elapsed(started)));
    return { normalizedUrl: normalized, summary: result("invalidAudio", testedAt, speechResponse.status, stages, models, voices) };
  }
  if (bytes.byteLength === 0) {
    stages.push(stage("audio", "fail", "audio-empty", "The speech response contained no audio bytes.", elapsed(started)));
    return { normalizedUrl: normalized, summary: result("invalidAudio", testedAt, speechResponse.status, stages, models, voices) };
  }
  try {
    const probe = await audioProbe(bytes, signal);
    if (!probe.decodable || !probe.formatName?.includes("wav")) {
      stages.push(stage("audio", "fail", "audio-undecodable", "The returned WAV audio could not be decoded.", elapsed(started)));
      return { normalizedUrl: normalized, summary: result("invalidAudio", testedAt, speechResponse.status, stages, models, voices) };
    }
  } catch (error) {
    const failure = errorFailure(error, "audio-probe-failed");
    stages.push(stage("audio", "fail", failure.code, failure.message, elapsed(started)));
    return { normalizedUrl: normalized, summary: result(failure.kind === "invalid-response" ? "invalidAudio" : "disconnected", testedAt, speechResponse.status, stages, models, voices) };
  }
  stages.push(stage("audio", "pass", "audio-valid-wav", "Speaches returned a decodable WAV response; the diagnostic bytes were discarded.", elapsed(started)));
  return { normalizedUrl: normalized, summary: result("connected", testedAt, speechResponse.status, stages, models, voices) };
}

function synthesisFailure(error: unknown, externalSignal?: AbortSignal): SpeachesSynthesisError {
  if (error instanceof SpeachesSynthesisError) return error;
  if (externalSignal?.aborted) {
    return new SpeachesSynthesisError("aborted", "Speech synthesis was cancelled.", false);
  }
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new SpeachesSynthesisError("unavailable", "The configured speech request timed out.", true);
  }
  return new SpeachesSynthesisError("unavailable", "The configured Speaches service could not be reached.", true);
}

function synthesisSignal(timeoutSeconds: number, externalSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutSeconds * 1_000);
  return externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
}

export async function synthesizeSpeech(
  input: SpeachesSynthesisInput,
  dependencies: SpeachesAdapterDependencies = {}
): Promise<SpeachesSynthesisResult> {
  if (!input.text.trim() || !input.modelId.trim() || !input.voiceId.trim() || input.speed <= 0 || input.speed > 4) {
    throw new SpeachesSynthesisError("configurationError", "Choose a model, voice, valid speed, and passage before synthesizing.", false);
  }
  if (!Number.isInteger(input.retryCount) || input.retryCount < 0 || input.retryCount > 5) {
    throw new SpeachesSynthesisError("configurationError", "The connection retry policy is invalid.", false);
  }
  let normalized: NormalizedSpeachesUrl;
  try {
    normalized = normalizeSpeachesUrl(input.baseUrl);
  } catch {
    throw new SpeachesSynthesisError("configurationError", "The connection has an invalid Speaches URL.", false);
  }
  const fetchImpl = dependencies.fetch ?? fetch;
  const audioProbe = dependencies.probeAudio ?? probeAudioWithFfprobe;
  const sleep = dependencies.sleep ?? defaultSleep;
  const maximumAttempts = input.retryCount + 1;
  let lastFailure: SpeachesSynthesisError | undefined;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (input.signal?.aborted) throw new SpeachesSynthesisError("aborted", "Speech synthesis was cancelled.", false);
    const signal = synthesisSignal(input.timeoutSeconds, input.signal);
    try {
      const response = await fetchImpl(`${normalized.rootUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { ...headers(input.apiKey), "Content-Type": "application/json", Accept: "audio/wav" },
        body: JSON.stringify({
          model: input.modelId,
          voice: input.voiceId,
          speed: input.speed,
          input: input.text,
          response_format: "wav"
        }),
        signal
      });
      if (response.status === 401 || response.status === 403) {
        throw new SpeachesSynthesisError("authenticationRequired", "This Speaches server requires authentication, which StudyNarrator does not support.", false, response.status);
      }
      if (response.status === 429 || response.status >= 500) {
        throw new SpeachesSynthesisError("unavailable", "Speaches is temporarily unavailable for synthesis.", true, response.status);
      }
      if (!response.ok) {
        throw new SpeachesSynthesisError("selectionRejected", "Speaches rejected the selected model or voice. Check both selections and retry.", false, response.status);
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (contentType !== "audio/wav" && contentType !== "audio/x-wav" && contentType !== "audio/wave") {
        throw new SpeachesSynthesisError("invalidAudio", "Speaches returned a response that was not WAV audio.", false, response.status);
      }
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedBody(response, MAX_AUDIO_BYTES);
      } catch {
        throw new SpeachesSynthesisError("audioTooLarge", "Speaches returned audio larger than the safe Scratchpad limit.", false, response.status);
      }
      if (bytes.byteLength === 0) {
        throw new SpeachesSynthesisError("invalidAudio", "Speaches returned an empty audio result.", false, response.status);
      }
      let probe: AudioProbeResult;
      try {
        probe = await audioProbe(bytes, signal);
      } catch (error) {
        throw synthesisFailure(error, input.signal);
      }
      if (!probe.decodable || !probe.formatName?.includes("wav")) {
        throw new SpeachesSynthesisError("invalidAudio", "Speaches returned WAV data that could not be decoded.", false, response.status);
      }
      return { bytes, mimeType: "audio/wav", attempts: attempt };
    } catch (error) {
      const failure = synthesisFailure(error, input.signal);
      if (!failure.retryable || attempt === maximumAttempts) throw failure;
      lastFailure = failure;
      try {
        await sleep(Math.min(1_000, 100 * 2 ** (attempt - 1)), input.signal);
      } catch (sleepError) {
        throw synthesisFailure(sleepError, input.signal);
      }
    }
  }
  throw lastFailure ?? new SpeachesSynthesisError("unavailable", "Speech synthesis did not complete.", true);
}
