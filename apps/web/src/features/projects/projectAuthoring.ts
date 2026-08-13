import type { LexiconEntry, LexiconEntryAuthoring } from "@studynarrator/core";
import type { ProjectDetail, ProjectReplaceInput } from "@studynarrator/shared-types";

export const MAX_SCRIPT_CHARACTERS = 5_000_000;

export type ProjectDraft = ProjectReplaceInput;

export function authoringLexicon(entries: readonly LexiconEntry[]): LexiconEntryAuthoring[] {
  return entries.map((entry) => ({
    id: entry.id,
    scope: entry.scope,
    entryType: entry.entryType,
    displayText: entry.displayText,
    ...(entry.senseId === undefined ? {} : { senseId: entry.senseId }),
    spokenText: entry.spokenText,
    caseSensitive: entry.caseSensitive,
    wholeWord: entry.wholeWord,
    priority: entry.priority,
    enabled: entry.enabled,
    notes: entry.notes
  }));
}

export function draftFromProject(project: ProjectDetail): ProjectDraft {
  return {
    name: project.name,
    description: project.description,
    scriptSource: project.scriptSource,
    connectionProfileId: project.connectionProfileId,
    modelId: project.modelId,
    speakerMappings: project.speakerMappings,
    pausePresets: project.pausePresets,
    paragraphPause: project.paragraphPause,
    lexiconEntries: authoringLexicon(project.lexiconEntries)
  };
}

export async function readUtf8TextFile(file: File): Promise<string> {
  if (!file.name.toLowerCase().endsWith(".txt")) throw new Error("Choose a .txt file.");
  const bytes = await file.arrayBuffer();
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The file is not valid UTF-8 text.");
  }
  if (source.length > MAX_SCRIPT_CHARACTERS) throw new Error("The script exceeds the five-million-character limit.");
  return source;
}

export function stripSingleSurroundingCodeFence(source: string): string | undefined {
  const match = /^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/u.exec(source);
  return match?.[1];
}

export function replaceLiteral(source: string, search: string, replacement: string, caseSensitive: boolean): string {
  if (!search) return source;
  if (caseSensitive) return source.split(search).join(replacement);
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return source.replace(new RegExp(escaped, "giu"), replacement);
}

export function materializeLexicon(entries: readonly (LexiconEntryAuthoring | ProjectReplaceInput["lexiconEntries"][number])[], scopePrefix: string): LexiconEntry[] {
  const timestamp = "2000-01-01T00:00:00.000Z";
  return entries.map((entry, index) => ({
    ...entry,
    id: entry.id ?? `${scopePrefix}-${String(index + 1).padStart(4, "0")}`,
    caseSensitive: entry.caseSensitive ?? true,
    wholeWord: entry.wholeWord ?? true,
    priority: entry.priority ?? 0,
    enabled: entry.enabled ?? true,
    notes: entry.notes ?? "",
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}
