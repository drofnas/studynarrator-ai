import { resolve } from "node:path";
import {
  SPEECH_CACHE_CONTRACT_VERSION,
  ProjectIdSchema,
  SpeechCacheKeyInputSchema,
  SpeechCacheCleanupResultSchema,
  SpeechCacheStatusSchema,
  type SpeechCacheClient
} from "@studynarrator/shared-types";
import {
  createSpeechCache,
  type CachedSpeechResult,
  type SpeechCache,
  type SpeechCacheUsage
} from "@studynarrator/rendering";
import {
  probeAudioWithFfprobe,
  synthesizeSpeech,
  type SpeachesSynthesisInput,
  type SpeachesSynthesisResult
} from "@studynarrator/speaches-adapter";
import type { ConnectionRepository, CredentialStore } from "./connections.js";

export const SPEACHES_CACHE_ADAPTER_ID = "speaches-openai-compatible";
export const SPEACHES_CACHE_ADAPTER_VERSION = 1;

export interface CachedSpeechSynthesisInput {
  connectionProfileId: string;
  modelId: string;
  voiceId: string;
  speed: number;
  text: string;
  usage: SpeechCacheUsage;
  signal?: AbortSignal;
}

export interface CachedSpeechSynthesis {
  synthesize(input: CachedSpeechSynthesisInput): Promise<CachedSpeechResult>;
}

export interface CachedSpeechSynthesisRunner {
  (input: SpeachesSynthesisInput): Promise<SpeachesSynthesisResult>;
}

export function createApplicationSpeechCache(dataDirectory: string): SpeechCache {
  return createSpeechCache({
    rootDirectory: resolve(dataDirectory, "cache/speech"),
    validateAudio: async (bytes, signal) => {
      const result = await probeAudioWithFfprobe(bytes, signal);
      return result.decodable && result.formatName?.includes("wav") === true;
    }
  });
}

export function createCachedSpeechSynthesis(dependencies: {
  repository: Pick<ConnectionRepository, "getConnectionProfile" | "getConnectionCredentialReference">;
  credentials: CredentialStore;
  cache: SpeechCache;
  synthesize?: CachedSpeechSynthesisRunner;
}): CachedSpeechSynthesis {
  const runSynthesis = dependencies.synthesize ?? ((input) => synthesizeSpeech(input));
  return {
    async synthesize(input) {
      const profile = dependencies.repository.getConnectionProfile(input.connectionProfileId);
      if (!profile.baseUrl) throw new Error("The selected connection profile needs a Speaches URL.");
      const reference = dependencies.repository.getConnectionCredentialReference(profile.id);
      const apiKey = reference ? await dependencies.credentials.read(reference) : null;
      return await dependencies.cache.getOrCreate({
        adapterId: SPEACHES_CACHE_ADAPTER_ID,
        adapterVersion: SPEACHES_CACHE_ADAPTER_VERSION,
        serverIdentity: profile.baseUrl,
        profileId: profile.id,
        modelId: input.modelId,
        voiceId: input.voiceId,
        speed: input.speed,
        text: input.text,
        responseFormat: "wav"
      }, input.usage, async (normalizedText, signal) => {
        const result = await runSynthesis({
          baseUrl: profile.baseUrl!,
          modelId: input.modelId,
          voiceId: input.voiceId,
          speed: input.speed,
          text: normalizedText,
          ...(apiKey === null ? {} : { apiKey }),
          timeoutSeconds: profile.timeoutSeconds,
          retryCount: profile.retryCount,
          signal
        });
        return result.bytes;
      }, input.signal);
    }
  };
}

export function createSpeechCacheService(cache: SpeechCache): SpeechCacheClient {
  const cleanup = (result: Awaited<ReturnType<SpeechCache["clearAll"]>>) => SpeechCacheCleanupResultSchema.parse({
    contractVersion: SPEECH_CACHE_CONTRACT_VERSION,
    ...result
  });
  return {
    async status() {
      return SpeechCacheStatusSchema.parse({ contractVersion: SPEECH_CACHE_CONTRACT_VERSION, ...(await cache.status()) });
    },
    async clearAll() { return cleanup(await cache.clearAll()); },
    async clearProject(projectId) { return cleanup(await cache.clearProject(ProjectIdSchema.parse(projectId))); },
    async clearEntry(cacheKey) {
      return cleanup(await cache.clearEntry(SpeechCacheKeyInputSchema.parse({ cacheKey }).cacheKey));
    }
  };
}
