import { randomUUID } from "node:crypto";
import { transformScratchpadPassage, ScratchpadPassageError } from "@studynarrator/core";
import {
  ScratchpadPreviewInputSchema,
  ScratchpadPreviewResultSchema,
  type ScratchpadClient,
  type ScratchpadPreviewResult
} from "@studynarrator/shared-types";
import {
  SpeachesSynthesisError,
  synthesizeSpeech,
  type SpeachesSynthesisInput,
  type SpeachesSynthesisResult
} from "@studynarrator/speaches-adapter";
import type { ConnectionRepository, CredentialStore } from "./connections.js";
import type { PersistenceRepository } from "./persistence.js";

export type ScratchpadServiceErrorCode =
  | "SCRATCHPAD_ABORTED"
  | "SCRATCHPAD_AUTHENTICATION"
  | "SCRATCHPAD_CONFIGURATION"
  | "SCRATCHPAD_INVALID_AUDIO"
  | "SCRATCHPAD_SELECTION_REJECTED"
  | "SCRATCHPAD_UNAVAILABLE";

export class ScratchpadServiceError extends Error {
  constructor(readonly code: ScratchpadServiceErrorCode, message: string) {
    super(message);
  }
}

export interface ScratchpadRepository extends ConnectionRepository, Pick<PersistenceRepository, "listGlobalLexicon"> {}

export interface ScratchpadSynthesisRunner {
  (input: SpeachesSynthesisInput): Promise<SpeachesSynthesisResult>;
}

function safeSynthesisError(error: unknown): ScratchpadServiceError {
  if (error instanceof ScratchpadServiceError) return error;
  if (error instanceof ScratchpadPassageError) return new ScratchpadServiceError("SCRATCHPAD_CONFIGURATION", error.message);
  if (error instanceof SpeachesSynthesisError) {
    switch (error.code) {
      case "aborted": return new ScratchpadServiceError("SCRATCHPAD_ABORTED", "Speech synthesis was cancelled.");
      case "authenticationRequired": return new ScratchpadServiceError("SCRATCHPAD_AUTHENTICATION", "Speaches rejected authentication. Test the profile and update its API key.");
      case "configurationError": return new ScratchpadServiceError("SCRATCHPAD_CONFIGURATION", "The selected connection profile or synthesis settings are incomplete.");
      case "invalidAudio": return new ScratchpadServiceError("SCRATCHPAD_INVALID_AUDIO", "Speaches returned WAV audio that StudyNarrator could not validate.");
      case "selectionRejected": return new ScratchpadServiceError("SCRATCHPAD_SELECTION_REJECTED", "Speaches rejected the selected model or voice. Check both selections and retry.");
      case "unavailable": return new ScratchpadServiceError("SCRATCHPAD_UNAVAILABLE", "The configured Speaches service is unavailable. Check the connection and retry.");
    }
  }
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "PERSISTENCE_NOT_FOUND") {
    return new ScratchpadServiceError("SCRATCHPAD_CONFIGURATION", "The selected connection profile no longer exists.");
  }
  return new ScratchpadServiceError("SCRATCHPAD_UNAVAILABLE", "StudyNarrator could not complete speech synthesis.");
}

export function createScratchpadService(dependencies: {
  repository: ScratchpadRepository;
  credentials: CredentialStore;
  synthesize?: ScratchpadSynthesisRunner;
  createId?: () => string;
  now?: () => Date;
}): ScratchpadClient {
  const runSynthesis = dependencies.synthesize ?? ((input) => synthesizeSpeech(input));
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());
  return {
    async preview(inputValue, signal) {
      try {
        const input = ScratchpadPreviewInputSchema.parse(inputValue);
        const profile = dependencies.repository.getConnectionProfile(input.connectionProfileId);
        if (!profile.baseUrl) {
          throw new ScratchpadServiceError("SCRATCHPAD_CONFIGURATION", "The selected connection profile needs a Speaches URL.");
        }
        const projection = transformScratchpadPassage({
          text: input.text,
          entries: dependencies.repository.listGlobalLexicon(),
          applyGlobalLexicon: input.applyGlobalLexicon
        });
        const reference = dependencies.repository.getConnectionCredentialReference(profile.id);
        const apiKey = reference ? await dependencies.credentials.read(reference) : null;
        const synthesized = await runSynthesis({
          baseUrl: profile.baseUrl,
          modelId: input.modelId,
          voiceId: input.voiceId,
          speed: input.speed,
          text: projection.transformedText,
          ...(apiKey === null ? {} : { apiKey }),
          timeoutSeconds: profile.timeoutSeconds,
          retryCount: profile.retryCount,
          ...(signal === undefined ? {} : { signal })
        });
        const result: ScratchpadPreviewResult = {
          schemaVersion: 1,
          id: createId(),
          createdAt: now().toISOString(),
          connectionProfileId: profile.id,
          connectionProfileName: profile.name,
          modelId: input.modelId,
          voiceId: input.voiceId,
          speed: input.speed,
          originalText: projection.originalText,
          readableText: projection.readableText,
          transformedText: projection.transformedText,
          lexiconApplied: input.applyGlobalLexicon,
          warnings: projection.warnings,
          audio: {
            mimeType: "audio/wav",
            base64: Buffer.from(synthesized.bytes).toString("base64"),
            byteLength: synthesized.bytes.byteLength
          }
        };
        return ScratchpadPreviewResultSchema.parse(result);
      } catch (error) {
        throw safeSynthesisError(error);
      }
    }
  };
}
