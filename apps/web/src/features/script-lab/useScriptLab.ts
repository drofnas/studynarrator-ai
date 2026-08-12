import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
  DEFAULT_PARAGRAPH_PAUSE_ID,
  LexiconEntrySchema,
  normalizeLexiconEntries,
  type IgnoredDiagnostic,
  type LexiconEntry
} from "@studynarrator/core";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import type { ScriptAnalysisResult } from "@/workers/parser/parserWorkerProtocol.js";
import type { SystemPacingDefaults } from "@studynarrator/shared-types";

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

export type LexiconJsonSaveResult =
  | { success: true }
  | { success: false; errors: string[] };

export type ScriptLabState =
  | { phase: "idle" }
  | { phase: "parsing" }
  | { phase: "parsed"; result: ScriptAnalysisResult }
  | { phase: "stale" }
  | { phase: "error"; message: string };

export function useScriptLab(analyzer: ScriptAnalyzer, systemPacing: SystemPacingDefaults = { enabled: true, durationMs: DEFAULT_PARAGRAPH_PAUSE_DURATION_MS }) {
  const [source, setSourceState] = useState("");
  const [defaultSpeakerId, setDefaultSpeakerIdState] = useState("");
  const [paragraphPauseEnabled, setParagraphPauseEnabledState] = useState(true);
  const [paragraphPauseDurationMs, setParagraphPauseDurationMs] = useState(DEFAULT_PARAGRAPH_PAUSE_DURATION_MS);
  const [ignoredDiagnostics, setIgnoredDiagnostics] = useState<IgnoredDiagnostic[]>([]);
  const [entries, setEntries] = useState<LexiconEntry[]>([]);
  const [removedEntries, setRemovedEntries] = useState<LexiconEntry[]>([]);
  const [lexiconError, setLexiconError] = useState<string>();
  const [state, setState] = useState<ScriptLabState>({ phase: "idle" });
  const currentInput = useRef({ source, defaultSpeakerId, entries, paragraphPauseEnabled, paragraphPauseDurationMs });
  const analysisRevision = useRef(0);
  const nextEntryId = useRef(1);
  currentInput.current = { source, defaultSpeakerId, entries, paragraphPauseEnabled, paragraphPauseDurationMs };

  useEffect(() => {
    if (source || state.phase !== "idle") return;
    setParagraphPauseEnabledState(systemPacing.enabled);
    setParagraphPauseDurationMs(systemPacing.durationMs);
  }, [source, state.phase, systemPacing]);

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

  function setParagraphPauseEnabled(value: boolean): void {
    setParagraphPauseEnabledState(value);
    markInputChanged();
  }

  function replaceEntries(next: LexiconEntry[]): void {
    setEntries(next);
    setLexiconError(undefined);
    markInputChanged();
  }

  function addEntry(draft: LexiconEntryDraft): boolean {
    if (!draft.spokenText.trim()) {
      setLexiconError("Spoken text is required.");
      return false;
    }
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

  function replaceEntriesFromJson(value: unknown): LexiconJsonSaveResult {
    try {
      const normalized = normalizeLexiconEntries(value, {
        existingEntries: entries,
        nextId: nextEntryId.current,
        timestamp: new Date().toISOString()
      });
      nextEntryId.current = normalized.nextId;
      setRemovedEntries([]);
      replaceEntries(normalized.entries);
      return { success: true };
    } catch (error) {
      if (typeof error === "object" && error !== null && "issues" in error && Array.isArray(error.issues)) {
        const errors = error.issues.map((issue: unknown) => {
          if (typeof issue !== "object" || issue === null) return "The lexicon entry is invalid.";
          const pathValue = "path" in issue && Array.isArray(issue.path) ? issue.path : [];
          const path = pathValue.reduce<string>((result, segment) =>
            typeof segment === "number" ? `${result}[${String(segment)}]` : result ? `${result}.${String(segment)}` : String(segment), "");
          const message = "message" in issue && typeof issue.message === "string" ? issue.message : "The value is invalid.";
          return `${path || "$"}: ${message}`;
        });
        return { success: false, errors };
      }
      return { success: false, errors: [error instanceof Error ? error.message : "The lexicon JSON is invalid."] };
    }
  }

  async function runParser(nextIgnoredDiagnostics = ignoredDiagnostics, nextEntries = entries) {
    const submitted = { source, defaultSpeakerId, entries: nextEntries, paragraphPauseEnabled, paragraphPauseDurationMs };
    const submittedRevision = analysisRevision.current + 1;
    analysisRevision.current = submittedRevision;
    setState({ phase: "parsing" });
    try {
      const result = await analyzer.analyze({
        source: submitted.source,
        entries: submitted.entries,
        paragraphPause: {
          enabled: submitted.paragraphPauseEnabled,
          pauseId: DEFAULT_PARAGRAPH_PAUSE_ID,
          durationMs: submitted.paragraphPauseDurationMs
        },
        ...(submitted.defaultSpeakerId.trim() ? { defaultSpeakerId: submitted.defaultSpeakerId.trim() } : {}),
        ...(nextIgnoredDiagnostics.length > 0 ? { ignoredDiagnostics: nextIgnoredDiagnostics } : {})
      });
      if (analysisRevision.current !== submittedRevision) return;
      if (
        currentInput.current.source !== submitted.source
        || currentInput.current.defaultSpeakerId !== submitted.defaultSpeakerId
        || currentInput.current.entries !== submitted.entries
        || currentInput.current.paragraphPauseEnabled !== submitted.paragraphPauseEnabled
        || currentInput.current.paragraphPauseDurationMs !== submitted.paragraphPauseDurationMs
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
    pacingResult: result?.pacingResult,
    paragraphPauseEnabled,
    paragraphPauseDurationMs,
    parseResult: result?.parseResult,
    removeEntry,
    removedEntries,
    replaceEntriesFromJson,
    restoreDiagnostic,
    restoreEntry,
    runParser,
    setDefaultSpeakerId,
    setParagraphPauseEnabled,
    setSource,
    source,
    state,
    transformResult: result?.transformResult
  };
}
