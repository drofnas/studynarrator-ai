import { useRef, useState } from "react";
import {
  LexiconEntrySchema,
  type IgnoredDiagnostic,
  type LexiconEntry
} from "@studynarrator/core";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import type { ScriptAnalysisResult } from "@/workers/parser/parserWorkerProtocol.js";

export interface LexiconEntryDraft {
  scope: LexiconEntry["scope"];
  entryType: LexiconEntry["entryType"];
  displayText: string;
  senseId: string;
  spokenText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  priority: number;
  enabled: boolean;
  notes: string;
}

export type ScriptLabState =
  | { phase: "idle" }
  | { phase: "parsing" }
  | { phase: "parsed"; result: ScriptAnalysisResult }
  | { phase: "stale" }
  | { phase: "error"; message: string };

export function useScriptLab(analyzer: ScriptAnalyzer) {
  const [source, setSourceState] = useState("");
  const [defaultSpeakerId, setDefaultSpeakerIdState] = useState("");
  const [ignoredDiagnostics, setIgnoredDiagnostics] = useState<IgnoredDiagnostic[]>([]);
  const [entries, setEntries] = useState<LexiconEntry[]>([]);
  const [removedEntries, setRemovedEntries] = useState<LexiconEntry[]>([]);
  const [lexiconError, setLexiconError] = useState<string>();
  const [state, setState] = useState<ScriptLabState>({ phase: "idle" });
  const currentInput = useRef({ source, defaultSpeakerId, entries });
  const analysisRevision = useRef(0);
  const nextEntryId = useRef(1);
  currentInput.current = { source, defaultSpeakerId, entries };

  function markInputChanged(): void {
    analysisRevision.current += 1;
    setState((current) => current.phase === "idle" || current.phase === "error" ? current : { phase: "stale" });
  }

  function setSource(value: string): void {
    setSourceState(value);
    markInputChanged();
  }

  function setDefaultSpeakerId(value: string): void {
    setDefaultSpeakerIdState(value);
    markInputChanged();
  }

  function replaceEntries(next: LexiconEntry[]): void {
    setEntries(next);
    setLexiconError(undefined);
    markInputChanged();
  }

  function addEntry(draft: LexiconEntryDraft): boolean {
    const timestamp = new Date().toISOString();
    const candidate = LexiconEntrySchema.safeParse({
      id: `g03-${draft.scope}-${String(nextEntryId.current).padStart(3, "0")}`,
      scope: draft.scope,
      entryType: draft.entryType,
      displayText: draft.displayText,
      ...(draft.entryType === "namedSense" ? { senseId: draft.senseId } : {}),
      spokenText: draft.spokenText,
      caseSensitive: draft.caseSensitive,
      wholeWord: draft.wholeWord,
      priority: draft.priority,
      enabled: draft.enabled,
      notes: draft.notes,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    if (!candidate.success) {
      setLexiconError(candidate.error.issues[0]?.message ?? "The lexicon entry is invalid.");
      return false;
    }
    nextEntryId.current += 1;
    replaceEntries([...entries, candidate.data]);
    return true;
  }

  function removeEntry(id: string): void {
    const removed = entries.find((entry) => entry.id === id);
    if (!removed) return;
    setRemovedEntries((current) => [...current, removed]);
    replaceEntries(entries.filter((entry) => entry.id !== id));
  }

  function restoreEntry(id: string): void {
    const restored = removedEntries.find((entry) => entry.id === id);
    if (!restored) return;
    setRemovedEntries((current) => current.filter((entry) => entry.id !== id));
    replaceEntries([...entries, restored]);
  }

  async function runParser(nextIgnoredDiagnostics = ignoredDiagnostics, nextEntries = entries) {
    const submitted = { source, defaultSpeakerId, entries: nextEntries };
    const submittedRevision = analysisRevision.current + 1;
    analysisRevision.current = submittedRevision;
    setState({ phase: "parsing" });
    try {
      const result = await analyzer.analyze({
        source: submitted.source,
        entries: submitted.entries,
        ...(submitted.defaultSpeakerId.trim() ? { defaultSpeakerId: submitted.defaultSpeakerId.trim() } : {}),
        ...(nextIgnoredDiagnostics.length > 0 ? { ignoredDiagnostics: nextIgnoredDiagnostics } : {})
      });
      if (analysisRevision.current !== submittedRevision) return;
      if (
        currentInput.current.source !== submitted.source
        || currentInput.current.defaultSpeakerId !== submitted.defaultSpeakerId
        || currentInput.current.entries !== submitted.entries
      ) {
        setState({ phase: "stale" });
        return;
      }
      setState({ phase: "parsed", result });
    } catch (error) {
      if (analysisRevision.current !== submittedRevision) return;
      setState({ phase: "error", message: error instanceof Error ? error.message : "The script could not be analyzed." });
    }
  }

  function ignoreDiagnostic(item: IgnoredDiagnostic): void {
    const next = ignoredDiagnostics.some((candidate) => candidate.code === item.code && candidate.pattern === item.pattern)
      ? ignoredDiagnostics
      : [...ignoredDiagnostics, item];
    setIgnoredDiagnostics(next);
    void runParser(next);
  }

  function restoreDiagnostic(item: IgnoredDiagnostic): void {
    const next = ignoredDiagnostics.filter((candidate) =>
      candidate.code !== item.code || candidate.pattern !== item.pattern
    );
    setIgnoredDiagnostics(next);
    void runParser(next);
  }

  const result = state.phase === "parsed" ? state.result : undefined;
  return {
    addEntry,
    defaultSpeakerId,
    entries,
    ignoreDiagnostic,
    ignoredDiagnostics,
    lexiconError,
    parseResult: result?.parseResult,
    removeEntry,
    removedEntries,
    restoreDiagnostic,
    restoreEntry,
    runParser,
    setDefaultSpeakerId,
    setSource,
    source,
    state,
    transformResult: result?.transformResult
  };
}
