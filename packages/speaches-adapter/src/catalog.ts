import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import type {
  ConnectionDiagnosticStage,
  ConnectionTestOverall,
  ConnectionTestSummary,
  SpeechCatalog,
  SpeechCatalogVoice,
} from "@studynarrator/shared-types";
import {
  CONNECTION_DIAGNOSTIC_SCHEMA_VERSION,
  SpeechCatalogSchema,
} from "@studynarrator/shared-types";
import {
  type NormalizedSpeachesUrl,
  type SpeachesAdapterDependencies,
  DiagnosticFailure,
  MAX_AUDIO_BYTES,
  combinedSignal,
  connectTcp,
  defaultSleep,
  headers,
  normalizeSpeachesUrl,
  probeAudioWithFfprobe,
  readBoundedBody,
  withAbort,
} from "./httpClient.js";

const DIAGNOSTIC_TEXT = "StudyNarrator connection check.";

const MAX_ERROR_LENGTH = 280;
const STAGE_NAMES = [
  "url",
  "dns",
  "tcp",
  "http",
  "authentication",
  "model",
  "voice",
  "audio",
] as const;

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
    readonly httpStatus: number | null = null,
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

function elapsed(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function stage(
  name: (typeof STAGE_NAMES)[number],
  status: ConnectionDiagnosticStage["status"],
  code: string,
  message: string,
  durationMs: number,
): ConnectionDiagnosticStage {
  return {
    stage: name,
    status,
    code,
    message: sanitizeMessage(message),
    durationMs,
  };
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s]+/giu, "the configured endpoint")
    .replace(/[\r\n\t]+/gu, " ")
    .slice(0, MAX_ERROR_LENGTH);
}

function skipped(
  name: (typeof STAGE_NAMES)[number],
  code = "not-run",
): ConnectionDiagnosticStage {
  return stage(
    name,
    "skipped",
    code,
    "Not run because an earlier stage did not pass.",
    0,
  );
}

function finishStages(
  stages: ConnectionDiagnosticStage[],
): ConnectionDiagnosticStage[] {
  for (const name of STAGE_NAMES.slice(stages.length))
    stages.push(skipped(name));
  return stages;
}

function errorFailure(error: unknown, fallbackCode: string): DiagnosticFailure {
  if (error instanceof DiagnosticFailure) return error;
  if (error instanceof DOMException && error.name === "AbortError")
    return new DiagnosticFailure(
      "request-aborted",
      "The connection check was cancelled.",
      "aborted",
    );
  if (error instanceof DOMException && error.name === "TimeoutError")
    return new DiagnosticFailure(
      "request-timeout",
      "The configured timeout elapsed.",
      "timeout",
    );
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code.toLowerCase()
      : fallbackCode;
  return new DiagnosticFailure(
    code,
    "The endpoint could not be reached at this stage.",
    "network",
  );
}

function parseIdentifiers(payload: unknown, keys: readonly string[]): string[] {
  const candidate =
    typeof payload === "object" && payload !== null
      ? "data" in payload
        ? payload.data
        : "voices" in payload
          ? payload.voices
          : payload
      : payload;
  if (!Array.isArray(candidate)) return [];
  const identifiers = new Set<string>();
  for (const item of candidate) {
    if (typeof item === "string") identifiers.add(item);
    if (typeof item === "object" && item !== null) {
      for (const key of keys) {
        const value =
          key in item ? (item as Record<string, unknown>)[key] : undefined;
        if (typeof value === "string" && value.length > 0) {
          identifiers.add(value);
          break;
        }
      }
    }
  }
  return [...identifiers].sort();
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseCatalogVoice(value: unknown): SpeechCatalogVoice {
  if (typeof value === "string" && value.trim().length > 0) {
    return { voiceId: value.trim(), name: null, language: null, gender: null };
  }
  if (typeof value !== "object" || value === null) {
    throw new SpeachesCatalogError(
      "invalidResponse",
      "Speaches returned invalid speech-model voice metadata.",
      false,
    );
  }
  const record = value as Record<string, unknown>;
  const voiceId =
    optionalString(record, "id") ??
    optionalString(record, "voice_id") ??
    optionalString(record, "voice");
  if (!voiceId)
    throw new SpeachesCatalogError(
      "invalidResponse",
      "Speaches returned a voice without an identifier.",
      false,
    );
  return {
    voiceId,
    name: optionalString(record, "name"),
    language: optionalString(record, "language"),
    gender: optionalString(record, "gender"),
  };
}

function parseSpeechCatalog(payload: unknown): SpeechCatalog {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("models" in payload) ||
    !Array.isArray(payload.models)
  ) {
    throw new SpeachesCatalogError(
      "invalidResponse",
      "Speaches returned invalid speech-model discovery data.",
      false,
    );
  }
  if (payload.models.length > 2_000)
    throw new SpeachesCatalogError(
      "invalidResponse",
      "Speaches returned too many speech models.",
      false,
    );
  const models = new Map<string, Map<string, SpeechCatalogVoice>>();
  for (const value of payload.models) {
    if (typeof value !== "object" || value === null) {
      throw new SpeachesCatalogError(
        "invalidResponse",
        "Speaches returned invalid speech-model metadata.",
        false,
      );
    }
    const record = value as Record<string, unknown>;
    const modelId =
      optionalString(record, "id") ?? optionalString(record, "model");
    if (!modelId || !Array.isArray(record.voices)) {
      throw new SpeachesCatalogError(
        "invalidResponse",
        "Speaches returned a speech model without valid voice metadata.",
        false,
      );
    }
    if (record.voices.length > 10_000)
      throw new SpeachesCatalogError(
        "invalidResponse",
        "Speaches returned too many voices for one speech model.",
        false,
      );
    const voices = models.get(modelId) ?? new Map<string, SpeechCatalogVoice>();
    for (const voiceValue of record.voices) {
      const voice = parseCatalogVoice(voiceValue);
      if (!voices.has(voice.voiceId)) voices.set(voice.voiceId, voice);
    }
    models.set(modelId, voices);
  }
  return SpeechCatalogSchema.parse({
    schemaVersion: CONNECTION_DIAGNOSTIC_SCHEMA_VERSION,
    models: [...models].map(([modelId, voices]) => ({
      modelId,
      voices: [...voices.values()],
    })),
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 2_000_000)
    throw new DiagnosticFailure(
      "response-too-large",
      "The endpoint returned an unexpectedly large discovery response.",
      "invalid-response",
    );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DiagnosticFailure(
      "invalid-json",
      "The endpoint returned invalid discovery data.",
      "invalid-response",
    );
  }
}

function catalogFailure(
  error: unknown,
  externalSignal?: AbortSignal,
): SpeachesCatalogError {
  if (error instanceof SpeachesCatalogError) return error;
  if (error instanceof DiagnosticFailure) {
    if (error.kind === "invalid-response")
      return new SpeachesCatalogError(
        "invalidResponse",
        "Speaches returned invalid speech-model metadata.",
        false,
      );
    if (error.kind === "aborted")
      return new SpeachesCatalogError(
        "aborted",
        "Speech catalog discovery was cancelled.",
        false,
      );
    return new SpeachesCatalogError(
      "unavailable",
      "The configured Speaches service could not provide its speech catalog.",
      true,
    );
  }
  if (
    externalSignal?.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return new SpeachesCatalogError(
      "aborted",
      "Speech catalog discovery was cancelled.",
      false,
    );
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new SpeachesCatalogError(
      "unavailable",
      "Speech catalog discovery timed out.",
      true,
    );
  }
  return new SpeachesCatalogError(
    "unavailable",
    "The configured Speaches service could not provide its speech catalog.",
    true,
  );
}

export async function discoverSpeachesSpeechCatalog(
  input: SpeachesCatalogInput,
  dependencies: SpeachesAdapterDependencies = {},
): Promise<SpeechCatalog> {
  if (
    !Number.isInteger(input.timeoutSeconds) ||
    input.timeoutSeconds < 1 ||
    input.timeoutSeconds > 600 ||
    !Number.isInteger(input.retryCount) ||
    input.retryCount < 0 ||
    input.retryCount > 5
  ) {
    throw new SpeachesCatalogError(
      "configurationError",
      "The connection settings cannot be used to discover speech models.",
      false,
    );
  }
  let normalized: NormalizedSpeachesUrl;
  try {
    normalized = normalizeSpeachesUrl(input.baseUrl);
  } catch {
    throw new SpeachesCatalogError(
      "configurationError",
      "The connection has an invalid Speaches URL.",
      false,
    );
  }
  const fetchImpl = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? defaultSleep;
  const maximumAttempts = input.retryCount + 1;
  let lastFailure: SpeachesCatalogError | undefined;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (input.signal?.aborted)
      throw new SpeachesCatalogError(
        "aborted",
        "Speech catalog discovery was cancelled.",
        false,
      );
    const signal = combinedSignal(input.timeoutSeconds, input.signal);
    try {
      const response = await fetchImpl(
        `${normalized.rootUrl}/v1/audio/models`,
        {
          method: "GET",
          headers: { ...headers(input.apiKey), Accept: "application/json" },
          signal,
        },
      );
      if (response.status === 401 || response.status === 403) {
        throw new SpeachesCatalogError(
          "authenticationRequired",
          "Speaches rejected authentication for speech catalog discovery.",
          false,
          response.status,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        throw new SpeachesCatalogError(
          "unavailable",
          "Speaches is temporarily unavailable for speech catalog discovery.",
          true,
          response.status,
        );
      }
      if (!response.ok) {
        throw new SpeachesCatalogError(
          "invalidResponse",
          "Speaches rejected speech catalog discovery.",
          false,
          response.status,
        );
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
  throw (
    lastFailure ??
    new SpeachesCatalogError(
      "unavailable",
      "Speech catalog discovery did not complete.",
      true,
    )
  );
}

function result(
  overall: ConnectionTestOverall,
  testedAt: Date,
  httpStatus: number | null,
  stages: ConnectionDiagnosticStage[],
  availableModelIds: string[],
  availableVoiceIds: string[] | null,
): ConnectionTestSummary {
  return {
    schemaVersion: CONNECTION_DIAGNOSTIC_SCHEMA_VERSION,
    overall,
    testedAt: testedAt.toISOString(),
    httpStatus,
    stages: finishStages(stages),
    availableModelIds,
    availableVoiceIds,
  };
}

export async function diagnoseSpeaches(
  input: SpeachesDiagnosticInput,
  dependencies: SpeachesAdapterDependencies = {},
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
    stages.push(
      stage(
        "url",
        "pass",
        "url-valid",
        "The endpoint URL is valid.",
        elapsed(started),
      ),
    );
  } catch (error) {
    stages.push(
      stage(
        "url",
        "fail",
        "url-invalid",
        error instanceof Error ? error.message : "The endpoint URL is invalid.",
        elapsed(started),
      ),
    );
    return {
      normalizedUrl: null,
      summary: result("configurationError", testedAt, null, stages, [], null),
    };
  }

  const signal = combinedSignal(input.timeoutSeconds, input.signal);
  started = performance.now();
  try {
    if (isIP(normalized.hostname) === 0)
      await withAbort(lookup(normalized.hostname), signal);
    stages.push(
      stage(
        "dns",
        "pass",
        isIP(normalized.hostname) === 0 ? "dns-resolved" : "dns-ip-literal",
        "The endpoint address resolved.",
        elapsed(started),
      ),
    );
  } catch (error) {
    const failure = errorFailure(error, "dns-failed");
    stages.push(
      stage("dns", "fail", failure.code, failure.message, elapsed(started)),
    );
    return {
      normalizedUrl: normalized,
      summary: result("disconnected", testedAt, null, stages, [], null),
    };
  }

  started = performance.now();
  try {
    await tcpConnect(normalized.hostname, normalized.port, signal);
    stages.push(
      stage(
        "tcp",
        "pass",
        "tcp-connected",
        "A TCP connection was established.",
        elapsed(started),
      ),
    );
  } catch (error) {
    const failure = errorFailure(error, "tcp-failed");
    stages.push(
      stage("tcp", "fail", failure.code, failure.message, elapsed(started)),
    );
    return {
      normalizedUrl: normalized,
      summary: result("disconnected", testedAt, null, stages, [], null),
    };
  }

  let response: Response;
  started = performance.now();
  try {
    response = await fetchImpl(`${normalized.rootUrl}/health`, {
      method: "GET",
      headers: headers(input.apiKey),
      signal,
    });
    if (!response.ok && response.status !== 401 && response.status !== 403) {
      stages.push(
        stage(
          "http",
          "fail",
          `http-${response.status}`,
          "The health endpoint returned an unsuccessful status.",
          elapsed(started),
        ),
      );
      return {
        normalizedUrl: normalized,
        summary: result(
          "disconnected",
          testedAt,
          response.status,
          stages,
          [],
          null,
        ),
      };
    }
    stages.push(
      stage(
        "http",
        "pass",
        "http-reachable",
        "The Speaches HTTP service responded.",
        elapsed(started),
      ),
    );
  } catch (error) {
    const failure = errorFailure(error, "http-failed");
    stages.push(
      stage("http", "fail", failure.code, failure.message, elapsed(started)),
    );
    return {
      normalizedUrl: normalized,
      summary: result("disconnected", testedAt, null, stages, [], null),
    };
  }

  started = performance.now();
  try {
    response = await fetchImpl(`${normalized.rootUrl}/v1/models`, {
      method: "GET",
      headers: headers(input.apiKey),
      signal,
    });
  } catch (error) {
    const failure = errorFailure(error, "authentication-check-failed");
    stages.push(
      stage(
        "authentication",
        "fail",
        failure.code,
        failure.message,
        elapsed(started),
      ),
    );
    return {
      normalizedUrl: normalized,
      summary: result("disconnected", testedAt, null, stages, [], null),
    };
  }
  if (response.status === 401 || response.status === 403) {
    stages.push(
      stage(
        "authentication",
        "fail",
        response.status === 401
          ? "authentication-required"
          : "authentication-forbidden",
        "This Speaches server requires authentication, which StudyNarrator does not support.",
        elapsed(started),
      ),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "authenticationRequired",
        testedAt,
        response.status,
        stages,
        [],
        null,
      ),
    };
  }
  if (!response.ok) {
    stages.push(
      stage(
        "authentication",
        "pass",
        "authentication-accepted",
        "The endpoint did not reject authentication.",
        elapsed(started),
      ),
    );
    stages.push(
      stage(
        "model",
        "fail",
        `models-http-${response.status}`,
        "Model discovery returned an unsuccessful status.",
        0,
      ),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "modelUnavailable",
        testedAt,
        response.status,
        stages,
        [],
        null,
      ),
    };
  }
  stages.push(
    stage(
      "authentication",
      "pass",
      "authentication-accepted",
      "Authentication was accepted or is not required.",
      elapsed(started),
    ),
  );

  started = performance.now();
  let models: string[];
  try {
    models = parseIdentifiers(await readJson(response), ["id", "model"]);
  } catch (error) {
    const failure = errorFailure(error, "models-invalid");
    stages.push(
      stage("model", "fail", failure.code, failure.message, elapsed(started)),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "modelUnavailable",
        testedAt,
        response.status,
        stages,
        [],
        null,
      ),
    };
  }
  if (!input.modelId) {
    stages.push(
      stage(
        "model",
        "fail",
        "model-not-configured",
        "Choose a model before testing speech.",
        elapsed(started),
      ),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "configurationError",
        testedAt,
        response.status,
        stages,
        models,
        null,
      ),
    };
  }
  if (!models.includes(input.modelId)) {
    stages.push(
      stage(
        "model",
        "fail",
        "model-unavailable",
        "The configured model was not reported by Speaches.",
        elapsed(started),
      ),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "modelUnavailable",
        testedAt,
        response.status,
        stages,
        models,
        null,
      ),
    };
  }
  stages.push(
    stage(
      "model",
      "pass",
      "model-available",
      "The configured model is available.",
      elapsed(started),
    ),
  );

  started = performance.now();
  let voices: string[] | null = null;
  try {
    const catalogResponse = await fetchImpl(
      `${normalized.rootUrl}/v1/audio/models`,
      { method: "GET", headers: headers(input.apiKey), signal },
    );
    if (catalogResponse.ok) {
      const catalog = parseSpeechCatalog(await readJson(catalogResponse));
      voices =
        catalog.models
          .find(({ modelId }) => modelId === input.modelId)
          ?.voices.map(({ voiceId }) => voiceId) ?? [];
      stages.push(
        stage(
          "voice",
          "pass",
          voices.includes(input.voiceId ?? "")
            ? "voice-listed-for-model"
            : "model-voice-list-checked",
          "The selected model's voice catalog was checked; speech remains definitive.",
          elapsed(started),
        ),
      );
    } else {
      const voiceResponse = await fetchImpl(
        `${normalized.rootUrl}/v1/audio/voices`,
        { method: "GET", headers: headers(input.apiKey), signal },
      );
      if (voiceResponse.ok) {
        voices = parseIdentifiers(await readJson(voiceResponse), [
          "id",
          "voice_id",
          "voice",
        ]);
        stages.push(
          stage(
            "voice",
            "pass",
            voices.includes(input.voiceId ?? "")
              ? "voice-listed"
              : "voice-list-checked",
            "The optional installation voice catalog was checked; speech remains definitive.",
            elapsed(started),
          ),
        );
      } else {
        stages.push(
          stage(
            "voice",
            "skipped",
            "voice-list-unavailable",
            "The optional voice catalog is unavailable; speech will verify the voice.",
            elapsed(started),
          ),
        );
      }
    }
  } catch {
    stages.push(
      stage(
        "voice",
        "skipped",
        "voice-list-unavailable",
        "The optional voice catalog is unavailable; speech will verify the voice.",
        elapsed(started),
      ),
    );
  }
  if (!input.voiceId) {
    stages[stages.length - 1] = stage(
      "voice",
      "fail",
      "voice-not-configured",
      "Choose a voice before testing speech.",
      elapsed(started),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "configurationError",
        testedAt,
        response.status,
        stages,
        models,
        voices,
      ),
    };
  }

  started = performance.now();
  let speechResponse: Response;
  try {
    speechResponse = await fetchImpl(`${normalized.rootUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        ...headers(input.apiKey),
        "Content-Type": "application/json",
        Accept: "audio/wav",
      },
      body: JSON.stringify({
        model: input.modelId,
        voice: input.voiceId,
        input: DIAGNOSTIC_TEXT,
        response_format: "wav",
      }),
      signal,
    });
  } catch (error) {
    const failure = errorFailure(error, "speech-request-failed");
    stages.push(
      stage("audio", "fail", failure.code, failure.message, elapsed(started)),
    );
    return {
      normalizedUrl: normalized,
      summary: result("disconnected", testedAt, null, stages, models, voices),
    };
  }
  if (speechResponse.status === 401 || speechResponse.status === 403) {
    stages.push(
      stage(
        "audio",
        "fail",
        "speech-authentication-required",
        "The speech request rejected authentication.",
        elapsed(started),
      ),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "authenticationRequired",
        testedAt,
        speechResponse.status,
        stages,
        models,
        voices,
      ),
    };
  }
  if (!speechResponse.ok) {
    stages.push(
      stage(
        "audio",
        "fail",
        `voice-rejected-${speechResponse.status}`,
        "The speech request rejected the configured model or voice.",
        elapsed(started),
      ),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "voiceUnavailable",
        testedAt,
        speechResponse.status,
        stages,
        models,
        voices,
      ),
    };
  }
  const contentType =
    speechResponse.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
  if (!contentType.startsWith("audio/")) {
    stages.push(
      stage(
        "audio",
        "fail",
        "audio-content-type-invalid",
        "The speech response did not declare audio content.",
        elapsed(started),
      ),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "invalidAudio",
        testedAt,
        speechResponse.status,
        stages,
        models,
        voices,
      ),
    };
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(speechResponse, MAX_AUDIO_BYTES);
  } catch (error) {
    const failure = errorFailure(error, "audio-read-failed");
    stages.push(
      stage("audio", "fail", failure.code, failure.message, elapsed(started)),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "invalidAudio",
        testedAt,
        speechResponse.status,
        stages,
        models,
        voices,
      ),
    };
  }
  if (bytes.byteLength === 0) {
    stages.push(
      stage(
        "audio",
        "fail",
        "audio-empty",
        "The speech response contained no audio bytes.",
        elapsed(started),
      ),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        "invalidAudio",
        testedAt,
        speechResponse.status,
        stages,
        models,
        voices,
      ),
    };
  }
  try {
    const probe = await audioProbe(bytes, signal);
    if (!probe.decodable || !probe.formatName?.includes("wav")) {
      stages.push(
        stage(
          "audio",
          "fail",
          "audio-undecodable",
          "The returned WAV audio could not be decoded.",
          elapsed(started),
        ),
      );
      return {
        normalizedUrl: normalized,
        summary: result(
          "invalidAudio",
          testedAt,
          speechResponse.status,
          stages,
          models,
          voices,
        ),
      };
    }
  } catch (error) {
    const failure = errorFailure(error, "audio-probe-failed");
    stages.push(
      stage("audio", "fail", failure.code, failure.message, elapsed(started)),
    );
    return {
      normalizedUrl: normalized,
      summary: result(
        failure.kind === "invalid-response" ? "invalidAudio" : "disconnected",
        testedAt,
        speechResponse.status,
        stages,
        models,
        voices,
      ),
    };
  }
  stages.push(
    stage(
      "audio",
      "pass",
      "audio-valid-wav",
      "Speaches returned a decodable WAV response; the diagnostic bytes were discarded.",
      elapsed(started),
    ),
  );
  return {
    normalizedUrl: normalized,
    summary: result(
      "connected",
      testedAt,
      speechResponse.status,
      stages,
      models,
      voices,
    ),
  };
}
