import {
  type AudioProbeResult,
  type NormalizedSpeachesUrl,
  type SpeachesAdapterDependencies,
  MAX_AUDIO_BYTES,
  defaultSleep,
  headers,
  normalizeSpeachesUrl,
  probeAudioWithFfprobe,
  readBoundedBody,
} from "./httpClient.js";

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
    readonly httpStatus: number | null = null,
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

function synthesisFailure(
  error: unknown,
  externalSignal?: AbortSignal,
): SpeachesSynthesisError {
  if (error instanceof SpeachesSynthesisError) return error;
  if (externalSignal?.aborted) {
    return new SpeachesSynthesisError(
      "aborted",
      "Speech synthesis was cancelled.",
      false,
    );
  }
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return new SpeachesSynthesisError(
      "unavailable",
      "The configured speech request timed out.",
      true,
    );
  }
  return new SpeachesSynthesisError(
    "unavailable",
    "The configured Speaches service could not be reached.",
    true,
  );
}

function synthesisSignal(
  timeoutSeconds: number,
  externalSignal?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutSeconds * 1_000);
  return externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
}

export async function synthesizeSpeech(
  input: SpeachesSynthesisInput,
  dependencies: SpeachesAdapterDependencies = {},
): Promise<SpeachesSynthesisResult> {
  if (
    !input.text.trim() ||
    !input.modelId.trim() ||
    !input.voiceId.trim() ||
    input.speed <= 0 ||
    input.speed > 4
  ) {
    throw new SpeachesSynthesisError(
      "configurationError",
      "Choose a model, voice, valid speed, and passage before synthesizing.",
      false,
    );
  }
  if (
    !Number.isInteger(input.retryCount) ||
    input.retryCount < 0 ||
    input.retryCount > 5
  ) {
    throw new SpeachesSynthesisError(
      "configurationError",
      "The connection retry policy is invalid.",
      false,
    );
  }
  let normalized: NormalizedSpeachesUrl;
  try {
    normalized = normalizeSpeachesUrl(input.baseUrl);
  } catch {
    throw new SpeachesSynthesisError(
      "configurationError",
      "The connection has an invalid Speaches URL.",
      false,
    );
  }
  const fetchImpl = dependencies.fetch ?? fetch;
  const audioProbe = dependencies.probeAudio ?? probeAudioWithFfprobe;
  const sleep = dependencies.sleep ?? defaultSleep;
  const maximumAttempts = input.retryCount + 1;
  let lastFailure: SpeachesSynthesisError | undefined;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (input.signal?.aborted)
      throw new SpeachesSynthesisError(
        "aborted",
        "Speech synthesis was cancelled.",
        false,
      );
    const signal = synthesisSignal(input.timeoutSeconds, input.signal);
    try {
      const response = await fetchImpl(
        `${normalized.rootUrl}/v1/audio/speech`,
        {
          method: "POST",
          headers: {
            ...headers(input.apiKey),
            "Content-Type": "application/json",
            Accept: "audio/wav",
          },
          body: JSON.stringify({
            model: input.modelId,
            voice: input.voiceId,
            speed: input.speed,
            input: input.text,
            response_format: "wav",
          }),
          signal,
        },
      );
      if (response.status === 401 || response.status === 403) {
        throw new SpeachesSynthesisError(
          "authenticationRequired",
          "This Speaches server requires authentication, which StudyNarrator does not support.",
          false,
          response.status,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        throw new SpeachesSynthesisError(
          "unavailable",
          "Speaches is temporarily unavailable for synthesis.",
          true,
          response.status,
        );
      }
      if (!response.ok) {
        throw new SpeachesSynthesisError(
          "selectionRejected",
          "Speaches rejected the selected model or voice. Check both selections and retry.",
          false,
          response.status,
        );
      }
      const contentType =
        response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase() ?? "";
      if (
        contentType !== "audio/wav" &&
        contentType !== "audio/x-wav" &&
        contentType !== "audio/wave"
      ) {
        throw new SpeachesSynthesisError(
          "invalidAudio",
          "Speaches returned a response that was not WAV audio.",
          false,
          response.status,
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedBody(response, MAX_AUDIO_BYTES);
      } catch {
        throw new SpeachesSynthesisError(
          "audioTooLarge",
          "Speaches returned audio larger than the safe Scratchpad limit.",
          false,
          response.status,
        );
      }
      if (bytes.byteLength === 0) {
        throw new SpeachesSynthesisError(
          "invalidAudio",
          "Speaches returned an empty audio result.",
          false,
          response.status,
        );
      }
      let probe: AudioProbeResult;
      try {
        probe = await audioProbe(bytes, signal);
      } catch (error) {
        throw synthesisFailure(error, input.signal);
      }
      if (!probe.decodable || !probe.formatName?.includes("wav")) {
        throw new SpeachesSynthesisError(
          "invalidAudio",
          "Speaches returned WAV data that could not be decoded.",
          false,
          response.status,
        );
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
  throw (
    lastFailure ??
    new SpeachesSynthesisError(
      "unavailable",
      "Speech synthesis did not complete.",
      true,
    )
  );
}
