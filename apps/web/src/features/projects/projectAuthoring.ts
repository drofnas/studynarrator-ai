import type { LexiconEntry, LexiconEntryAuthoring } from "@studynarrator/core";
import type {
  ProjectDetail,
  ProjectReplaceInput,
  SpeechCatalogVoice,
  SystemTimingConfiguration,
  VoiceCatalogEntry,
} from "@studynarrator/shared-types";

export const GLOBAL_VOICE_CATALOG_MODEL_ID = "speaches-ai/Kokoro-82M-v1.0-ONNX";
export const GLOBAL_VOICE_CATALOG_DEFAULT_VOICE_ID = "af_heart";

export type ProjectDraft = ProjectReplaceInput;

export function resolveProjectSpeakerVoiceId(
  currentVoiceId: string | null,
  connectionDefaultVoiceId: string | null,
  catalogEntries: readonly VoiceCatalogEntry[],
): string | null {
  const enabledVoiceIds = new Set(
    catalogEntries
      .filter(({ enabled }) => enabled)
      .map(({ voiceId }) => voiceId),
  );
  if (currentVoiceId && enabledVoiceIds.has(currentVoiceId))
    return currentVoiceId;
  if (connectionDefaultVoiceId && enabledVoiceIds.has(connectionDefaultVoiceId))
    return connectionDefaultVoiceId;
  return catalogEntries.find(({ enabled }) => enabled)?.voiceId ?? null;
}

export function supportedProjectVoices(
  catalogEntries: readonly VoiceCatalogEntry[],
  supportedVoices: readonly SpeechCatalogVoice[],
): VoiceCatalogEntry[] {
  const supported = new Map(
    supportedVoices.map((voice) => [voice.voiceId, voice]),
  );
  const configured = new Map(
    catalogEntries.map((entry) => [entry.voiceId, entry]),
  );
  const result = catalogEntries.filter(
    (entry) => entry.enabled && supported.has(entry.voiceId),
  );
  for (const voice of supportedVoices) {
    if (configured.has(voice.voiceId)) continue;
    result.push({
      voiceId: voice.voiceId,
      label:
        voice.name && voice.name !== voice.voiceId
          ? `${voice.name} — ${voice.voiceId}`
          : voice.voiceId,
      enabled: true,
      favorite: false,
      language: voice.language,
      locale: null,
      accent: null,
      category: voice.gender,
      style: null,
      sampleText: null,
    });
  }
  return result;
}

export function authoringLexicon(
  entries: readonly LexiconEntry[],
): LexiconEntryAuthoring[] {
  return entries.map((entry) => ({
    id: entry.id,
    scope: entry.scope,
    entryType: entry.entryType,
    displayText: entry.displayText,
    ...("senseId" in entry && entry.senseId !== undefined
      ? { senseId: entry.senseId }
      : {}),
    spokenText: entry.spokenText,
    caseSensitive: entry.caseSensitive,
    wholeWord: entry.wholeWord,
    priority: entry.priority,
    enabled: entry.enabled,
    notes: entry.notes,
  }));
}

export function draftFromProject(project: ProjectDetail): ProjectDraft {
  return {
    name: project.name,
    description: project.description,
    scriptSource: project.scriptSource,
    speakerMappings: project.speakerMappings,
    lexiconEntries: project.lexiconEntries.map((entry) => ({
      id: entry.id,
      scope: "project",
      entryType: "exactTerm",
      displayText: entry.displayText,
      spokenText: entry.spokenText,
      caseSensitive: false,
      wholeWord: true,
      priority: 0,
      enabled: entry.enabled,
      notes: "",
    })),
  };
}

export function paragraphPauseForAnalysis(timing: SystemTimingConfiguration) {
  const paragraph = timing.transitionPauses.paragraph;
  if (paragraph.mode === "duration") {
    return {
      enabled: true,
      pauseId: "pause_medium" as const,
      durationMs: paragraph.durationMs,
    };
  }
  if (paragraph.mode === "preset") {
    return {
      enabled: true,
      pauseId: paragraph.pauseId,
      durationMs:
        timing.pausePresets.find(({ pauseId }) => pauseId === paragraph.pauseId)
          ?.durationMs ?? 0,
    };
  }
  return { enabled: false, pauseId: "pause_medium" as const, durationMs: 0 };
}

export function stripSingleSurroundingCodeFence(
  source: string,
): string | undefined {
  const match = /^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/u.exec(source);
  return match?.[1];
}

export function materializeLexicon(
  entries: readonly (
    LexiconEntryAuthoring | ProjectReplaceInput["lexiconEntries"][number]
  )[],
  scopePrefix: string,
): LexiconEntry[] {
  const timestamp = "2000-01-01T00:00:00.000Z";
  return entries.map((entry, index) => ({
    id: entry.id ?? `${scopePrefix}-${String(index + 1).padStart(4, "0")}`,
    scope: entry.scope,
    entryType: entry.entryType ?? "exactTerm",
    displayText: entry.displayText,
    ...("senseId" in entry && entry.senseId !== undefined
      ? { senseId: entry.senseId }
      : {}),
    spokenText: entry.spokenText,
    caseSensitive: entry.caseSensitive ?? true,
    wholeWord: entry.wholeWord ?? true,
    priority: entry.priority ?? 0,
    enabled: entry.enabled ?? true,
    notes: entry.notes ?? "",
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}
