import { useCallback, useEffect, useRef, useState } from "react";
import { type LexiconEntryAuthoring } from "@studynarrator/core";
import { type PersistenceClient } from "@studynarrator/shared-types";
import { LexiconEditor, type LexiconEditorChange, type LexiconEditorValue } from "@/features/lexicon/LexiconEditor.js";
import { authoringLexicon } from "@/features/projects/projectAuthoring.js";
import styles from "./SettingsPage.module.css";

type SimplifiedGlobalEntry = {
  id?: string;
  scope: "global";
  entryType: "exactTerm";
  displayText: string;
  spokenText: string;
  caseSensitive: false;
  wholeWord: true;
  priority: 0;
  enabled: boolean;
  notes: "";
};
type LexiconRowState = "saving" | "saved" | "error";

function fixedGlobalEntry(entry: LexiconEntryAuthoring): SimplifiedGlobalEntry {
  return {
    ...(entry.id ? { id: entry.id } : {}),
    scope: "global",
    entryType: "exactTerm",
    displayText: entry.displayText,
    spokenText: entry.spokenText,
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: entry.enabled ?? true,
    notes: ""
  };
}

export function LexiconSettingsPage({ client }: { client: PersistenceClient }) {
  const [globalLexicon, setGlobalLexicon] = useState<SimplifiedGlobalEntry[]>([]);
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
      const loaded = authoringLexicon(entries).map(fixedGlobalEntry);
      globalLexiconRef.current = loaded;
      setGlobalLexicon(loaded);
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "The global lexicon could not be loaded."); });
    return () => { active = false; };
  }, [client]);

  useEffect(() => () => {
    if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
  }, []);

  const persistGlobalLexicon = useCallback((entries: SimplifiedGlobalEntry[], affectedIds: string[], success?: string) => {
    const snapshot = entries.map(fixedGlobalEntry);
    const blankEntry = snapshot.find((entry) => !entry.displayText.trim() || !entry.spokenText.trim());
    const seenTerms = new Set<string>();
    const duplicateEntry = snapshot.find((entry) => {
      if (!entry.enabled) return false;
      const key = entry.displayText.trim().toLocaleLowerCase("en-US");
      if (!key || !seenTerms.has(key)) { seenTerms.add(key); return false; }
      return true;
    });
    if (blankEntry || duplicateEntry) {
      const invalidId = blankEntry?.id ?? duplicateEntry?.id;
      const ids = invalidId ? [invalidId] : affectedIds;
      setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, "error" as const])) }));
      setError(blankEntry ? "Script Text and Spoken Text are required." : "Script Text must be unique regardless of capitalization.");
      return Promise.resolve(false);
    }
    const revision = lexiconRevisionRef.current;
    setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(affectedIds.map((id) => [id, "saving" as const])) }));
    const task = lexiconQueueRef.current.then(async () => {
      try {
        const saved = authoringLexicon(await client.globalLexicon.replace(snapshot)).map(fixedGlobalEntry);
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
    const next = value.map((entry) => fixedGlobalEntry({ ...entry, scope: "global", entryType: "exactTerm", caseSensitive: false, wholeWord: true, priority: 0, notes: "" }));
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
        <p>Script Text matches complete words regardless of capitalization. These rules apply to every project and pronunciation preview; project-only rules stay with their project.</p>
        <LexiconEditor
          value={globalLexicon.map(({ id, displayText, spokenText, enabled }) => ({ ...(id ? { id } : {}), displayText, spokenText, enabled }))}
          onChange={changeGlobalLexicon}
          searchLabel="Search global lexicon"
          emptyMessage="No matching global lexicon entries."
          rowErrors={Object.fromEntries(Object.entries(lexiconRowState).filter(([, state]) => state === "error").map(([id]) => [id, "Not saved — edit or blur to retry"]))}
        />
      </section>
    </div>
  );
}
