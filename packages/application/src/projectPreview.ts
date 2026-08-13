import { randomUUID } from "node:crypto";
import { parseScript, transformScript, type LexiconEntry } from "@studynarrator/core";
import {
  PROJECT_PREVIEW_SCHEMA_VERSION,
  ProjectIdSchema,
  ProjectPreviewInputSchema,
  ProjectPreviewResultSchema,
  type ProjectDetail,
  type ProjectPreviewClient,
  type ProjectPreviewInput,
  type ProjectPreviewResult
} from "@studynarrator/shared-types";
import { SpeachesSynthesisError } from "@studynarrator/speaches-adapter";
import type { ConnectionRepository } from "./connections.js";
import type { PersistenceRepository } from "./persistence.js";
import type { CachedSpeechSynthesis } from "./cachedSpeech.js";
import { BUNDLED_VOICE_CATALOGS } from "./kokoroCatalog.js";

export type ProjectPreviewServiceErrorCode =
  | "PROJECT_PREVIEW_ABORTED"
  | "PROJECT_PREVIEW_AUTHENTICATION"
  | "PROJECT_PREVIEW_CONFIGURATION"
  | "PROJECT_PREVIEW_INVALID_AUDIO"
  | "PROJECT_PREVIEW_INVALID_SEGMENT"
  | "PROJECT_PREVIEW_SELECTION_REJECTED"
  | "PROJECT_PREVIEW_UNAVAILABLE";

export class ProjectPreviewServiceError extends Error {
  constructor(readonly code: ProjectPreviewServiceErrorCode, message: string) {
    super(message);
  }
}

export interface ProjectPreviewRepository extends ConnectionRepository, Pick<PersistenceRepository, "getProject" | "listGlobalLexicon"> {}

interface PreviewProjection {
  mode: ProjectPreviewInput["mode"];
  nodeOrdinal: number | null;
  sourceRange: ProjectPreviewResult["sourceRange"];
  speakerId: string;
  voiceId: string;
  speed: number;
  originalText: string;
  readableText: string;
  transformedText: string;
}

function safePreviewError(error: unknown): ProjectPreviewServiceError {
  if (error instanceof ProjectPreviewServiceError) return error;
  if (error instanceof SpeachesSynthesisError) {
    switch (error.code) {
      case "aborted": return new ProjectPreviewServiceError("PROJECT_PREVIEW_ABORTED", "Project preview was cancelled.");
      case "audioTooLarge": return new ProjectPreviewServiceError("PROJECT_PREVIEW_INVALID_AUDIO", "The preview WAV exceeded the 5 MiB limit.");
      case "authenticationRequired": return new ProjectPreviewServiceError("PROJECT_PREVIEW_AUTHENTICATION", "Speaches rejected authentication. Test the profile and update its API key.");
      case "configurationError": return new ProjectPreviewServiceError("PROJECT_PREVIEW_CONFIGURATION", "The project preview settings are incomplete.");
      case "invalidAudio": return new ProjectPreviewServiceError("PROJECT_PREVIEW_INVALID_AUDIO", "Speaches returned WAV audio that StudyNarrator could not validate.");
      case "selectionRejected": return new ProjectPreviewServiceError("PROJECT_PREVIEW_SELECTION_REJECTED", "Speaches rejected the selected model or voice.");
      case "unavailable": return new ProjectPreviewServiceError("PROJECT_PREVIEW_UNAVAILABLE", "The configured Speaches service is unavailable. Check the connection and retry.");
    }
  }
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  if (record?.code === "PERSISTENCE_NOT_FOUND") {
    return new ProjectPreviewServiceError("PROJECT_PREVIEW_CONFIGURATION", "The project or connection profile no longer exists.");
  }
  return new ProjectPreviewServiceError("PROJECT_PREVIEW_UNAVAILABLE", "StudyNarrator could not complete the project preview.");
}

function entries(repository: ProjectPreviewRepository, project: ProjectDetail): LexiconEntry[] {
  return [...repository.listGlobalLexicon(), ...project.lexiconEntries];
}

function projectConnection(project: ProjectDetail, repository: ProjectPreviewRepository) {
  if (!project.connectionProfileId) throw new ProjectPreviewServiceError("PROJECT_PREVIEW_CONFIGURATION", "Choose a connection profile before previewing.");
  const profile = repository.getConnectionProfile(project.connectionProfileId);
  const modelId = project.modelId ?? profile.defaultModelId;
  if (!modelId) throw new ProjectPreviewServiceError("PROJECT_PREVIEW_CONFIGURATION", "Choose a speech model before previewing.");
  return { profile, modelId };
}

function segmentProjection(project: ProjectDetail, input: Extract<ProjectPreviewInput, { mode: "segment" }>, lexicon: LexiconEntry[]): PreviewProjection {
  const parsed = parseScript({ source: project.scriptSource });
  if (parsed.errors.length > 0) throw new ProjectPreviewServiceError("PROJECT_PREVIEW_INVALID_SEGMENT", "Resolve script errors before previewing this segment.");
  const node = parsed.nodes.find((candidate) => candidate.ordinal === input.nodeOrdinal);
  if (!node || node.type !== "speech") throw new ProjectPreviewServiceError("PROJECT_PREVIEW_INVALID_SEGMENT", "The selected row is not a current speech segment.");
  const transformed = transformScript({ parsedScript: parsed, entries: lexicon });
  const segment = transformed.segments.find((candidate) => candidate.nodeOrdinal === node.ordinal);
  if (!segment || transformed.errors.length > 0) throw new ProjectPreviewServiceError("PROJECT_PREVIEW_INVALID_SEGMENT", "Resolve pronunciation errors before previewing this segment.");
  const speaker = project.speakerMappings.find((candidate) => candidate.speakerId === node.speakerId);
  if (!speaker?.voiceId) throw new ProjectPreviewServiceError("PROJECT_PREVIEW_CONFIGURATION", `Speaker ${node.speakerId} needs a voice before previewing.`);
  return {
    mode: input.mode,
    nodeOrdinal: node.ordinal,
    sourceRange: node.range,
    speakerId: node.speakerId,
    voiceId: speaker.voiceId,
    speed: speaker.speed,
    originalText: node.rawText,
    readableText: segment.readableText,
    transformedText: segment.ttsText
  };
}

function pronunciationProjection(
  project: ProjectDetail,
  input: Extract<ProjectPreviewInput, { mode: "pronunciation" }>,
  lexicon: LexiconEntry[],
  defaultVoiceId: string | null
): PreviewProjection {
  const speakerId = input.speakerId ?? "narrator";
  const parsed = parseScript({ source: input.text, defaultSpeakerId: speakerId });
  const hasControl = parsed.nodes.some((node) => node.type !== "speech")
    || /(^|[^\\])\[speaker_[A-Za-z0-9][A-Za-z0-9_-]*\]/u.test(input.text);
  if (parsed.errors.length > 0 || hasControl) {
    throw new ProjectPreviewServiceError("PROJECT_PREVIEW_INVALID_SEGMENT", "Pronunciation preview accepts one plain speech sample without script controls.");
  }
  const transformed = transformScript({ parsedScript: parsed, entries: lexicon });
  if (!transformed.synthesisReady || transformed.segments.length === 0) {
    throw new ProjectPreviewServiceError("PROJECT_PREVIEW_INVALID_SEGMENT", "Resolve pronunciation errors before previewing this sample.");
  }
  const configured = project.speakerMappings.find((candidate) => candidate.speakerId === speakerId);
  const voiceId = configured?.voiceId ?? (speakerId === "narrator" ? defaultVoiceId : null);
  if (!voiceId) throw new ProjectPreviewServiceError("PROJECT_PREVIEW_CONFIGURATION", `Speaker ${speakerId} needs a voice before previewing.`);
  return {
    mode: input.mode,
    nodeOrdinal: null,
    sourceRange: null,
    speakerId,
    voiceId,
    speed: speakerId === "narrator" ? 1 : configured?.speed ?? 1,
    originalText: input.text,
    readableText: transformed.readableTranscript,
    transformedText: transformed.ttsTranscript
  };
}

export function createProjectPreviewService(dependencies: {
  repository: ProjectPreviewRepository;
  speech: CachedSpeechSynthesis;
  createId?: () => string;
  now?: () => Date;
}): ProjectPreviewClient {
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());
  return {
    async preview(projectIdValue, inputValue, signal) {
      try {
        const projectId = ProjectIdSchema.parse(projectIdValue);
        const input = ProjectPreviewInputSchema.parse(inputValue);
        const project = dependencies.repository.getProject(projectId);
        const { profile, modelId } = projectConnection(project, dependencies.repository);
        const lexicon = entries(dependencies.repository, project);
        const projection = input.mode === "segment"
          ? segmentProjection(project, input, lexicon)
          : pronunciationProjection(project, input, lexicon, profile.defaultVoiceId);
        const cached = await dependencies.speech.synthesize({
          connectionProfileId: profile.id,
          modelId,
          voiceId: projection.voiceId,
          speed: projection.speed,
          text: projection.transformedText,
          usage: { projectId },
          ...(signal === undefined ? {} : { signal })
        });
        const voiceLabel = dependencies.repository.getVoiceCatalogOverrides(modelId).entries
          .find((entry) => entry.voiceId === projection.voiceId)?.label
          ?? BUNDLED_VOICE_CATALOGS.get(modelId)?.entries.find((entry) => entry.voiceId === projection.voiceId)?.label
          ?? projection.voiceId;
        return ProjectPreviewResultSchema.parse({
          schemaVersion: PROJECT_PREVIEW_SCHEMA_VERSION,
          id: createId(),
          createdAt: now().toISOString(),
          projectId,
          ...projection,
          connectionProfileId: profile.id,
          connectionProfileName: profile.name,
          modelId,
          voiceLabel,
          cache: {
            key: cached.key,
            status: cached.status,
            byteLength: cached.metadata.byteLength,
            createdAt: cached.metadata.createdAt,
            lastUsedAt: cached.metadata.lastUsedAt
          },
          audio: {
            mimeType: "audio/wav",
            base64: Buffer.from(cached.bytes).toString("base64"),
            byteLength: cached.bytes.byteLength
          }
        });
      } catch (error) {
        throw safePreviewError(error);
      }
    }
  };
}
