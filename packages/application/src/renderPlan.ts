import { createHash, randomUUID } from "node:crypto";
import {
  CIR_SCHEMA_VERSION,
  LEXICON_TRANSFORM_VERSION,
  PARAGRAPH_PACING_VERSION,
  SCRIPT_GRAMMAR_VERSION,
  parseScript,
  transformScript,
  type CirNode,
  type LexiconEntry,
  type SourceRange
} from "@studynarrator/core";
import {
  PROJECT_SNAPSHOT_SCHEMA_VERSION,
  RENDER_PLAN_SCHEMA_VERSION,
  ProjectIdSchema,
  RenderPlanIdSchema,
  type RenderPlan,
  type RenderPlanClient,
  type RenderPlanEntry,
  type SystemTimingConfiguration,
  type SystemTransitionPauseSetting
} from "@studynarrator/shared-types";
import {
  SPEECH_CACHE_SCHEMA_VERSION,
  SPEECH_CHUNKING_VERSION,
  SPEECH_NORMALIZATION_VERSION,
  createPcmSilence,
  type RenderPlanStore,
  type SpeechCache,
  withProjectSnapshotHash,
  withRenderPlanHash
} from "@studynarrator/rendering";
import type { ConnectionRepository } from "./connections.js";
import type { PersistenceRepository } from "./persistence.js";
import { SPEACHES_CACHE_ADAPTER_ID, SPEACHES_CACHE_ADAPTER_VERSION } from "./cachedSpeech.js";

export type RenderPlanServiceErrorCode =
  | "RENDER_PLAN_CONFIGURATION"
  | "RENDER_PLAN_INVALID_PROJECT"
  | "RENDER_PLAN_NOT_FOUND"
  | "RENDER_PLAN_STORAGE";

export class RenderPlanServiceError extends Error {
  constructor(readonly code: RenderPlanServiceErrorCode, message: string) { super(message); }
}

export interface RenderPlanRepository extends ConnectionRepository, Pick<PersistenceRepository,
  "getProject" | "getSystemPacing" | "listGlobalLexicon" | "getIgnoredDiagnostics"> {}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function safeError(error: unknown): RenderPlanServiceError {
  if (error instanceof RenderPlanServiceError) return error;
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  if (record?.code === "PERSISTENCE_NOT_FOUND" || (error instanceof Error && /ENOENT/u.test(error.message))) {
    return new RenderPlanServiceError("RENDER_PLAN_NOT_FOUND", "The requested project or render plan does not exist.");
  }
  return new RenderPlanServiceError("RENDER_PLAN_STORAGE", "StudyNarrator could not create or read the render plan.");
}

function transitionDuration(timing: SystemTimingConfiguration, setting: SystemTransitionPauseSetting): { pauseId: string | null; durationMs: number } | null {
  if (setting.mode === "none") return null;
  if (setting.mode === "duration") return { pauseId: null, durationMs: setting.durationMs };
  const preset = timing.pausePresets.find(({ pauseId }) => pauseId === setting.pauseId);
  if (!preset) throw new RenderPlanServiceError("RENDER_PLAN_CONFIGURATION", `Pause preset ${setting.pauseId} is missing.`);
  return { pauseId: setting.pauseId, durationMs: preset.durationMs };
}

function explicitDuration(timing: SystemTimingConfiguration, pauseId: string): number {
  const preset = timing.pausePresets.find((candidate) => candidate.pauseId === pauseId);
  if (!preset) throw new RenderPlanServiceError("RENDER_PLAN_CONFIGURATION", `Pause preset ${pauseId} is missing.`);
  return preset.durationMs;
}

export function createRenderPlanService(dependencies: {
  repository: RenderPlanRepository;
  cache: SpeechCache;
  store: RenderPlanStore;
  createId?: () => string;
  now?: () => Date;
}): RenderPlanClient {
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  return {
    async create(projectIdInput) {
      try {
        const projectId = ProjectIdSchema.parse(projectIdInput);
        const project = dependencies.repository.getProject(projectId);
        const timing = dependencies.repository.getSystemPacing();
        const connection = dependencies.repository.getSpeachesConnection();
        if (!connection.baseUrl) throw new RenderPlanServiceError("RENDER_PLAN_CONFIGURATION", "The Speaches connection needs a server address.");
        const modelId = connection.defaultModelId;
        if (!modelId) throw new RenderPlanServiceError("RENDER_PLAN_CONFIGURATION", "Choose a speech model before freezing a render plan.");
        const globalLexiconEntries = dependencies.repository.listGlobalLexicon();
        const ignoredDiagnostics = dependencies.repository.getIgnoredDiagnostics();
        const lexiconEntries: LexiconEntry[] = [...globalLexiconEntries, ...project.lexiconEntries];
        const parsed = parseScript({ source: project.scriptSource, ...(ignoredDiagnostics.length > 0 ? { ignoredDiagnostics } : {}) });
        const transformed = transformScript({ parsedScript: parsed, entries: lexiconEntries, ...(ignoredDiagnostics.length > 0 ? { ignoredDiagnostics } : {}) });
        if (parsed.errors.length > 0 || transformed.errors.length > 0 || !transformed.synthesisReady) {
          throw new RenderPlanServiceError("RENDER_PLAN_INVALID_PROJECT", "Resolve blocking script and pronunciation errors before freezing a render plan.");
        }
        const capturedAt = now().toISOString();
        const snapshot = withProjectSnapshotHash({
          schemaVersion: PROJECT_SNAPSHOT_SCHEMA_VERSION,
          capturedAt,
          project,
          timing,
          globalLexiconEntries,
          ignoredDiagnostics,
          connection: {
            modelId,
            serverIdentityHash: sha256(connection.baseUrl)
          },
          versions: {
            scriptGrammar: SCRIPT_GRAMMAR_VERSION,
            cirSchema: CIR_SCHEMA_VERSION,
            lexiconTransform: LEXICON_TRANSFORM_VERSION,
            pacing: PARAGRAPH_PACING_VERSION,
            speechCacheSchema: SPEECH_CACHE_SCHEMA_VERSION,
            speechNormalization: SPEECH_NORMALIZATION_VERSION,
            speechChunking: SPEECH_CHUNKING_VERSION,
            speechAdapter: SPEACHES_CACHE_ADAPTER_VERSION
          }
        });

        const entries: RenderPlanEntry[] = [];
        const silenceAssets = new Map<string, Uint8Array>();
        let previousSpeech: Extract<CirNode, { type: "speech" }> | undefined;
        let activeSectionTitle: string | null = null;
        let boundary = { explicit: false, paragraph: false, section: false };
        const pushPause = (input: {
          pauseKind: "explicit" | "automatic";
          reason: "explicit" | "paragraph" | "speakerChange" | "section";
          pauseId: string | null;
          durationMs: number;
          sourceRange: SourceRange | null;
          sectionTitle: string | null;
        }) => {
          const { bytes, asset } = createPcmSilence(input.durationMs);
          if (bytes && asset) silenceAssets.set(asset.checksum, bytes);
          entries.push({ type: "pause", ordinal: entries.length + 1, silence: asset, ...input });
        };

        for (let index = 0; index < parsed.nodes.length; index += 1) {
          const node = parsed.nodes[index]!;
          if (node.type === "section") {
            activeSectionTitle = node.title;
            entries.push({ type: "section", ordinal: entries.length + 1, nodeOrdinal: node.ordinal, title: node.title, sectionTitle: node.title, sourceRange: node.range });
            boundary.section = true;
            continue;
          }
          if (node.type === "paragraphBreak") {
            boundary.paragraph = true;
            continue;
          }
          if (node.type === "pause") {
            pushPause({ pauseKind: "explicit", reason: "explicit", pauseId: node.pauseId, durationMs: explicitDuration(timing, node.pauseId), sourceRange: node.range, sectionTitle: activeSectionTitle });
            boundary.explicit = true;
            continue;
          }
          if (previousSpeech && !boundary.explicit) {
            const automatic = boundary.section
              ? { reason: "section" as const, setting: timing.transitionPauses.section }
              : previousSpeech.speakerId !== node.speakerId
                ? { reason: "speakerChange" as const, setting: timing.transitionPauses.speakerChange }
                : boundary.paragraph
                  ? { reason: "paragraph" as const, setting: timing.transitionPauses.paragraph }
                  : null;
            if (automatic) {
              const resolved = transitionDuration(timing, automatic.setting);
              if (resolved) pushPause({ pauseKind: "automatic", reason: automatic.reason, ...resolved, sourceRange: null, sectionTitle: activeSectionTitle });
            }
          }
          const transformedSegment = transformed.segments.find(({ nodeOrdinal }) => nodeOrdinal === node.ordinal);
          const speaker = project.speakerMappings.find(({ speakerId }) => speakerId === node.speakerId);
          if (!transformedSegment || !speaker?.voiceId) throw new RenderPlanServiceError("RENDER_PLAN_CONFIGURATION", `Speaker ${node.speakerId} needs a voice before freezing a render plan.`);
          const cache = await dependencies.cache.inspect({
            adapterId: SPEACHES_CACHE_ADAPTER_ID,
            adapterVersion: SPEACHES_CACHE_ADAPTER_VERSION,
            serverIdentity: connection.baseUrl,
            modelId,
            voiceId: speaker.voiceId,
            speed: speaker.speed,
            text: transformedSegment.ttsText,
            responseFormat: "wav"
          });
          entries.push({
            type: "speech",
            ordinal: entries.length + 1,
            nodeOrdinal: node.ordinal,
            sectionTitle: activeSectionTitle,
            sourceRange: node.range,
            speakerId: node.speakerId,
            voiceId: speaker.voiceId,
            speed: speaker.speed,
            gainDb: speaker.gainDb,
            originalText: node.rawText,
            readableText: transformedSegment.readableText,
            ttsText: transformedSegment.ttsText,
            chunks: [{ ordinal: 1, text: transformedSegment.ttsText, cacheKey: cache.key, cacheStatus: cache.status }]
          });
          previousSpeech = node;
          boundary = { explicit: false, paragraph: false, section: false };
        }

        const planId = RenderPlanIdSchema.parse(createId());
        const speechEntries = entries.filter((entry) => entry.type === "speech");
        const pauseEntries = entries.filter((entry) => entry.type === "pause");
        const plan: RenderPlan = withRenderPlanHash({
          schemaVersion: RENDER_PLAN_SCHEMA_VERSION,
          id: planId,
          projectId,
          createdAt: capturedAt,
          snapshotHash: snapshot.snapshotHash,
          scriptHash: project.scriptHash,
          entries,
          summary: {
            sectionCount: entries.filter((entry) => entry.type === "section").length,
            speechCount: speechEntries.length,
            pauseCount: pauseEntries.length,
            cacheHits: speechEntries.filter((entry) => entry.chunks[0]?.cacheStatus === "hit").length,
            cacheMisses: speechEntries.filter((entry) => entry.chunks[0]?.cacheStatus === "miss").length,
            silenceDurationMs: pauseEntries.reduce((total, entry) => total + entry.durationMs, 0)
          }
        });
        return await dependencies.store.save(snapshot, plan, silenceAssets);
      } catch (error) { throw safeError(error); }
    },
    async list(projectId) {
      try { return await dependencies.store.list(ProjectIdSchema.parse(projectId)); } catch (error) { throw safeError(error); }
    },
    async get(planId) {
      try { return await dependencies.store.get(RenderPlanIdSchema.parse(planId)); } catch (error) { throw safeError(error); }
    }
  };
}
