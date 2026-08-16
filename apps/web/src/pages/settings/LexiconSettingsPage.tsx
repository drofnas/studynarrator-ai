import { useCallback, useEffect, useRef, useState } from "react";
import { type LexiconEntryAuthoring } from "@studynarrator/core";
import { type PersistenceClient } from "@studynarrator/shared-types";
import { LexiconEditor, type LexiconEditorChange, type LexiconEditorValue } from "@/features/lexicon/LexiconEditor.js";
import { authoringLexicon } from "@/features/projects/projectAuthoring.js";
import styles from "./SettingsPage.module.css";

type SimplifiedGlobalEntry = {
  id?: string;
  scope: "global";
  displayText: string;
  spokenText: string;
  caseSensitive: false;
  wholeWord: true;
  priority: 0;
  enabled: boolean;
  notes: "";
} & ({ entryType: "exactTerm" } | { entryType: "namedSense"; senseId: string });
type GlobalLexiconRow = {
  id?: string;
  alias: string;
  spokenText: string;
  enabled: boolean;
};
type LexiconRowState = "saving" | "saved" | "error";

function fixedGlobalEntry(entry: LexiconEntryAuthoring): SimplifiedGlobalEntry {
  const common = {
    ...(entry.id ? { id: entry.id } : {}),
    scope: "global",
    displayText: entry.displayText,
    spokenText: entry.spokenText,
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: entry.enabled ?? true,
    notes: ""
  } as const;
  if (entry.entryType === "namedSense" && entry.senseId) {
    return { ...common, entryType: "namedSense", senseId: entry.senseId };
  }
  return { ...common, entryType: "exactTerm" };
}

function rowFromEntry(entry: SimplifiedGlobalEntry): GlobalLexiconRow {
  return {
    ...(entry.id ? { id: entry.id } : {}),
    alias: entry.entryType === "namedSense" ? `${entry.displayText}/${entry.senseId}` : entry.displayText,
    spokenText: entry.spokenText,
    enabled: entry.enabled
  };
}

function entryFromRow(row: GlobalLexiconRow): SimplifiedGlobalEntry {
  const alias = row.alias.trim();
  const parts = alias.split("/");
  if (!alias || !row.spokenText.trim()) throw new Error("Alias and Spoken Text are required.");
  if (parts.length === 1) {
    return fixedGlobalEntry({
      ...(row.id ? { id: row.id } : {}), scope: "global", entryType: "exactTerm",
      displayText: alias, spokenText: row.spokenText, caseSensitive: false, wholeWord: true,
      priority: 0, enabled: row.enabled, notes: ""
    });
  }
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
    throw new Error("Alias must be a term or one term/sense pair.");
  }
  const senseId = parts[1].trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(senseId)) {
    throw new Error("The sense in an Alias may use only letters, numbers, underscores, and hyphens.");
  }
  return fixedGlobalEntry({
    ...(row.id ? { id: row.id } : {}), scope: "global", entryType: "namedSense",
    displayText: parts[0].trim(), senseId, spokenText: row.spokenText, caseSensitive: false,
    wholeWord: true, priority: 0, enabled: row.enabled, notes: ""
  });
}

export function LexiconSettingsPage({ client }: { client: PersistenceClient }) {
  const [globalLexicon, setGlobalLexicon] = useState<GlobalLexiconRow[]>([]);
  const [lexiconRowState, setLexiconRowState] = useState<Record<string, LexiconRowState>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const globalLexiconRef = useRef(globalLexicon);
  const lexiconRevisionRef = useRef(0);
  const lexiconQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lexiconTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingLexiconRowsRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    void client.globalLexicon.list().then((entries) => {
      if (!active) return;
      const loaded = authoringLexicon(entries).map(fixedGlobalEntry).map(rowFromEntry);
      globalLexiconRef.current = loaded;
      setGlobalLexicon(loaded);
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "The global lexicon could not be loaded."); });
    return () => { active = false; };
  }, [client]);

  useEffect(() => () => {
    if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
  }, []);

  const persistGlobalLexicon = useCallback((entries: GlobalLexiconRow[], affectedIds: string[], success?: string) => {
    let snapshot: SimplifiedGlobalEntry[];
    try {
      snapshot = entries.map(entryFromRow);
    } catch (reason) {
      setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(affectedIds.map((id) => [id, "error" as const])) }));
      setError(reason instanceof Error ? reason.message : "The Global Lexicon Alias is invalid.");
      return Promise.resolve(false);
    }
    const seenAliases = new Set<string>();
    const duplicateEntry = entries.find((entry) => {
      const key = entry.alias.trim().toLocaleLowerCase("en-US");
      if (!key || !seenAliases.has(key)) { seenAliases.add(key); return false; }
      return true;
    });
    if (duplicateEntry) {
      const ids = duplicateEntry.id ? [duplicateEntry.id] : affectedIds;
      setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, "error" as const])) }));
      setError("Alias must be unique regardless of capitalization.");
      return Promise.resolve(false);
    }
    const revision = lexiconRevisionRef.current;
    setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(affectedIds.map((id) => [id, "saving" as const])) }));
    const task = lexiconQueueRef.current.then(async () => {
      try {
        const saved = authoringLexicon(await client.globalLexicon.replace(snapshot)).map(fixedGlobalEntry).map(rowFromEntry);
        if (revision === lexiconRevisionRef.current) {
          globalLexiconRef.current = saved;
          setGlobalLexicon(saved);
          setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(affectedIds.map((id) => [id, "saved" as const])) }));
          if (success) setStatus(success);
          setError("");
        }
        return true;
      } catch (reason) {
        if (revision === lexiconRevisionRef.current) {
          setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(affectedIds.map((id) => [id, "error" as const])) }));
          setError(reason instanceof Error ? reason.message : "The global lexicon could not be saved. Your edits are still here; try again.");
        }
        return false;
      }
    });
    lexiconQueueRef.current = task.then(() => undefined, () => undefined);
    return task;
  }, [client]);

  const flushGlobalLexicon = useCallback(() => {
    if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
    lexiconTimerRef.current = undefined;
    const affectedIds = [...pendingLexiconRowsRef.current];
    pendingLexiconRowsRef.current.clear();
    if (affectedIds.length === 0) return;
    void persistGlobalLexicon(globalLexiconRef.current, affectedIds, "Global pronunciation saved.");
  }, [persistGlobalLexicon]);

  const changeGlobalLexicon = (value: LexiconEditorValue[], change: LexiconEditorChange) => {
    const next = value.map((entry) => ({
      ...(entry.id ? { id: entry.id } : {}),
      alias: entry.displayText,
      spokenText: entry.spokenText,
      enabled: entry.enabled
    }));
    if (change.kind === "add" || change.kind === "delete") {
      flushGlobalLexicon();
      lexiconRevisionRef.current += 1;
      return persistGlobalLexicon(next, [change.id], change.kind === "add" ? "Global pronunciation added." : "Global pronunciation deleted.");
    }
    if (change.kind === "commit") {
      pendingLexiconRowsRef.current.add(change.id);
      flushGlobalLexicon();
      return;
    }
    lexiconRevisionRef.current += 1;
    globalLexiconRef.current = next;
    setGlobalLexicon(next);
    pendingLexiconRowsRef.current.add(change.id);
    setLexiconRowState((current) => ({ ...current, [change.id]: "saving" }));
    if (change.kind === "toggle") flushGlobalLexicon();
    else {
      if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
      lexiconTimerRef.current = setTimeout(flushGlobalLexicon, 500);
    }
  };

  return (
    <div className={`${styles.page} ${styles.singleColumnPage}`}>
      <header><p>Shared pronunciation</p><h2>Lexicon</h2><span>Manage pronunciation rules that apply to every project and preview.</span></header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {status ? <p className={styles.status} aria-live="polite">{status}</p> : null}

      <section className={styles.globalLexicon} aria-labelledby="global-lexicon-heading">
        <div className={styles.sectionHeading}><div><p>Shared pronunciation</p><h3 id="global-lexicon-heading">Global lexicon</h3></div><span>{globalLexicon.length} entries</span></div>
        <p>Aliases match regardless of capitalization. Use <code>resume/cv</code> to resolve the script annotation <code>{"{{resume|cv}}"}</code>. These rules apply to every project and pronunciation preview.</p>
        <LexiconEditor
          value={globalLexicon.map(({ id, alias, spokenText, enabled }) => ({ ...(id ? { id } : {}), displayText: alias, spokenText, enabled }))}
          onChange={changeGlobalLexicon}
          searchLabel="Search global lexicon"
          emptyMessage="No matching global lexicon entries."
          displayTextLabel="Alias"
          rowErrors={Object.fromEntries(Object.entries(lexiconRowState).filter(([, state]) => state === "error").map(([id]) => [id, "Not saved — edit or blur to retry"]))}
        />
      </section>
    </div>
  );
}
