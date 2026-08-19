import { resolve } from "node:path";
import {
  SPEECH_CACHE_CONTRACT_VERSION,
  ProjectIdSchema,
  SpeechCacheKeyInputSchema,
  SpeechCacheCleanupResultSchema,
  SpeechCacheStatusSchema,
  type SpeechCacheClient,
} from "@studynarrator/shared-types";
import {
  createSpeechCache,
  createSpeechCacheKey,
  type CachedSpeechResult,
  type SpeechCache,
  type SpeechCacheUsage,
} from "@studynarrator/rendering";
import {
  parseScript,
  transformScript,
  type LexiconEntry,
} from "@studynarrator/core";
import type { ProjectReplaceInput } from "@studynarrator/shared-types";
import {
  probeAudioWithFfprobe,
  synthesizeSpeech,
  type SpeachesSynthesisInput,
  type SpeachesSynthesisResult,
} from "@studynarrator/speaches-adapter";
import type { ConnectionRepository } from "./connections.js";

export const SPEACHES_CACHE_ADAPTER_ID = "speaches-openai-compatible";
export const SPEACHES_CACHE_ADAPTER_VERSION = 1;

export function createProjectSpeechCacheKeyPlanner(
  repository: Pick<ConnectionRepository, "getSpeachesConnection"> & {
    listGlobalLexicon(): LexiconEntry[];
  },
) {
  return (input: ProjectReplaceInput): readonly string[] | undefined => {
    const connection = repository.getSpeachesConnection();
    if (!connection.baseUrl || !connection.defaultModelId) return undefined;
    const parsed = parseScript({ source: input.scriptSource });
    const timestamp = "2000-01-01T00:00:00.000Z";
    const projectLexicon: LexiconEntry[] = input.lexiconEntries.map(
      (entry, index) => ({
        id: entry.id ?? `cache-planner-${String(index + 1).padStart(4, "0")}`,
        scope: entry.scope,
        entryType: entry.entryType ?? "exactTerm",
        displayText: entry.displayText,
        spokenText: entry.spokenText,
        caseSensitive: entry.caseSensitive ?? true,
        wholeWord: entry.wholeWord ?? true,
        priority: entry.priority ?? 0,
        enabled: entry.enabled ?? true,
        notes: entry.notes ?? "",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    const transformed = transformScript({
      parsedScript: parsed,
      entries: [...repository.listGlobalLexicon(), ...projectLexicon],
    });
    if (
      parsed.errors.length > 0 ||
      transformed.errors.length > 0 ||
      !transformed.synthesisReady
    )
      return undefined;
    const keys = new Set<string>();
    for (const node of parsed.nodes) {
      if (node.type !== "speech") continue;
      const segment = transformed.segments.find(
        (candidate) => candidate.nodeOrdinal === node.ordinal,
      );
      const speaker = input.speakerMappings.find(
        (candidate) => candidate.speakerId === node.speakerId,
      );
      if (!segment || !speaker?.voiceId) return undefined;
      keys.add(
        createSpeechCacheKey({
          adapterId: SPEACHES_CACHE_ADAPTER_ID,
          adapterVersion: SPEACHES_CACHE_ADAPTER_VERSION,
          serverIdentity: connection.baseUrl,
          modelId: connection.defaultModelId,
          voiceId: speaker.voiceId,
          speed: speaker.speed,
          text: segment.ttsText,
          responseFormat: "wav",
        }),
      );
    }
    return [...keys].sort();
  };
}

interface CachedSpeechSynthesisInput {
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

export function createApplicationSpeechCache(
  dataDirectory: string,
): SpeechCache {
  return createSpeechCache({
    rootDirectory: resolve(dataDirectory, "cache/speech"),
    validateAudio: async (bytes, signal) => {
      const result = await probeAudioWithFfprobe(bytes, signal);
      return result.decodable && result.formatName?.includes("wav") === true;
    },
  });
}

export function createCachedSpeechSynthesis(dependencies: {
  repository: Pick<ConnectionRepository, "getSpeachesConnection">;
  cache: SpeechCache;
  synthesize?: CachedSpeechSynthesisRunner;
}): CachedSpeechSynthesis {
  const runSynthesis =
    dependencies.synthesize ?? ((input) => synthesizeSpeech(input));
  return {
    async synthesize(input) {
      const connection = dependencies.repository.getSpeachesConnection();
      if (!connection.baseUrl)
        throw new Error("The Speaches connection needs a server address.");
      return await dependencies.cache.getOrCreate(
        {
          adapterId: SPEACHES_CACHE_ADAPTER_ID,
          adapterVersion: SPEACHES_CACHE_ADAPTER_VERSION,
          serverIdentity: connection.baseUrl,
          modelId: input.modelId,
          voiceId: input.voiceId,
          speed: input.speed,
          text: input.text,
          responseFormat: "wav",
        },
        input.usage,
        async (normalizedText, signal) => {
          const result = await runSynthesis({
            baseUrl: connection.baseUrl!,
            modelId: input.modelId,
            voiceId: input.voiceId,
            speed: input.speed,
            text: normalizedText,
            timeoutSeconds: connection.timeoutSeconds,
            retryCount: connection.retryCount,
            signal,
          });
          return result.bytes;
        },
        input.signal,
      );
    },
  };
}

export function createSpeechCacheService(
  cache: SpeechCache,
): SpeechCacheClient {
  const cleanup = (result: Awaited<ReturnType<SpeechCache["clearAll"]>>) =>
    SpeechCacheCleanupResultSchema.parse({
      contractVersion: SPEECH_CACHE_CONTRACT_VERSION,
      ...result,
    });
  return {
    async status() {
      return SpeechCacheStatusSchema.parse({
        contractVersion: SPEECH_CACHE_CONTRACT_VERSION,
        ...(await cache.status()),
      });
    },
    async clearAll() {
      return cleanup(await cache.clearAll());
    },
    async clearProject(projectId) {
      return cleanup(
        await cache.clearProject(ProjectIdSchema.parse(projectId)),
      );
    },
    async clearEntry(cacheKey) {
      return cleanup(
        await cache.clearEntry(
          SpeechCacheKeyInputSchema.parse({ cacheKey }).cacheKey,
        ),
      );
    },
  };
}
