import { randomUUID } from "node:crypto";
import {
  transformScratchpadPassage,
  ScratchpadPassageError,
} from "@studynarrator/core";
import {
  SCRATCHPAD_SCHEMA_VERSION,
  ScratchpadPreviewInputSchema,
  ScratchpadPreviewResultSchema,
  type ScratchpadClient,
  type ScratchpadPreviewResult,
} from "@studynarrator/shared-types";
import { SpeachesSynthesisError } from "@studynarrator/speaches-adapter";
import type { ConnectionRepository } from "./connections.js";
import type { PersistenceRepository } from "./persistence.js";
import {
  createCachedSpeechSynthesis,
  type CachedSpeechSynthesisRunner,
} from "./cachedSpeech.js";
import type { SpeechCache } from "@studynarrator/rendering";
import { BUNDLED_VOICE_CATALOGS } from "./kokoroCatalog.js";

type ScratchpadServiceErrorCode =
  | "SCRATCHPAD_ABORTED"
  | "SCRATCHPAD_AUTHENTICATION"
  | "SCRATCHPAD_CONFIGURATION"
  | "SCRATCHPAD_INVALID_AUDIO"
  | "SCRATCHPAD_SELECTION_REJECTED"
  | "SCRATCHPAD_UNAVAILABLE";

class ScratchpadServiceError extends Error {
  constructor(
    readonly code: ScratchpadServiceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ScratchpadRepository
  extends
    ConnectionRepository,
    Pick<PersistenceRepository, "listGlobalLexicon"> {}

type ScratchpadSynthesisRunner = CachedSpeechSynthesisRunner;

function safeSynthesisError(error: unknown): ScratchpadServiceError {
  if (error instanceof ScratchpadServiceError) return error;
  if (error instanceof ScratchpadPassageError)
    return new ScratchpadServiceError(
      "SCRATCHPAD_CONFIGURATION",
      error.message,
    );
  if (error instanceof SpeachesSynthesisError) {
    switch (error.code) {
      case "aborted":
        return new ScratchpadServiceError(
          "SCRATCHPAD_ABORTED",
          "Speech synthesis was cancelled.",
        );
      case "audioTooLarge":
        return new ScratchpadServiceError(
          "SCRATCHPAD_INVALID_AUDIO",
          "The generated WAV exceeded the 5 MiB Scratchpad limit. Shorten the passage and retry.",
        );
      case "authenticationRequired":
        return new ScratchpadServiceError(
          "SCRATCHPAD_AUTHENTICATION",
          "This Speaches server requires authentication, which StudyNarrator does not support.",
        );
      case "configurationError":
        return new ScratchpadServiceError(
          "SCRATCHPAD_CONFIGURATION",
          "The Speaches connection or synthesis settings are incomplete.",
        );
      case "invalidAudio":
        return new ScratchpadServiceError(
          "SCRATCHPAD_INVALID_AUDIO",
          "Speaches returned WAV audio that StudyNarrator could not validate.",
        );
      case "selectionRejected":
        return new ScratchpadServiceError(
          "SCRATCHPAD_SELECTION_REJECTED",
          "Speaches rejected the selected model or voice. Check both selections and retry.",
        );
      case "unavailable":
        return new ScratchpadServiceError(
          "SCRATCHPAD_UNAVAILABLE",
          "The configured Speaches service is unavailable. Check the connection and retry.",
        );
    }
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  if (code === "PERSISTENCE_NOT_FOUND") {
    return new ScratchpadServiceError(
      "SCRATCHPAD_CONFIGURATION",
      "The Speaches connection is unavailable.",
    );
  }
  return new ScratchpadServiceError(
    "SCRATCHPAD_UNAVAILABLE",
    "StudyNarrator could not complete speech synthesis.",
  );
}

export function createScratchpadService(dependencies: {
  repository: ScratchpadRepository;
  cache: SpeechCache;
  synthesize?: ScratchpadSynthesisRunner;
  createId?: () => string;
  now?: () => Date;
}): ScratchpadClient {
  const speech = createCachedSpeechSynthesis(dependencies);
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());
  return {
    async preview(inputValue, signal) {
      try {
        const input = ScratchpadPreviewInputSchema.parse(inputValue);
        const connection = dependencies.repository.getSpeechBackendConnection();
        if (!connection.baseUrl) {
          throw new ScratchpadServiceError(
            "SCRATCHPAD_CONFIGURATION",
            "The Speaches connection needs a server address.",
          );
        }
        const projection = transformScratchpadPassage({
          text: input.text,
          entries: dependencies.repository.listGlobalLexicon(),
          applyGlobalLexicon: input.applyGlobalLexicon,
        });
        const synthesized = await speech.synthesize({
          modelId: input.modelId,
          voiceId: input.voiceId,
          speed: input.speed,
          text: projection.transformedText,
          usage: { scratchpad: true },
          ...(signal === undefined ? {} : { signal }),
        });
        await dependencies.cache.retainScratchpad(synthesized.key);
        const voiceLabel =
          dependencies.repository
            .getVoiceCatalogOverrides(input.modelId)
            .entries.find((entry) => entry.voiceId === input.voiceId)?.label ??
          BUNDLED_VOICE_CATALOGS.get(input.modelId)?.entries.find(
            (entry) => entry.voiceId === input.voiceId,
          )?.label ??
          input.voiceId;
        const result: ScratchpadPreviewResult = {
          schemaVersion: SCRATCHPAD_SCHEMA_VERSION,
          id: createId(),
          createdAt: now().toISOString(),
          modelId: input.modelId,
          voiceId: input.voiceId,
          voiceLabel,
          speed: input.speed,
          originalText: projection.originalText,
          readableText: projection.readableText,
          transformedText: projection.transformedText,
          lexiconApplied: input.applyGlobalLexicon,
          warnings: projection.warnings,
          cache: {
            key: synthesized.key,
            status: synthesized.status,
            byteLength: synthesized.metadata.byteLength,
            createdAt: synthesized.metadata.createdAt,
            lastUsedAt: synthesized.metadata.lastUsedAt,
          },
          audio: {
            mimeType: "audio/wav",
            base64: Buffer.from(synthesized.bytes).toString("base64"),
            byteLength: synthesized.bytes.byteLength,
          },
        };
        return ScratchpadPreviewResultSchema.parse(result);
      } catch (error) {
        throw safeSynthesisError(error);
      }
    },
  };
}
