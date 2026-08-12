import { useState } from "react";
import type { LexiconEntry } from "@studynarrator/core";
import type { LexiconEntryDraft } from "../useScriptLab.js";
import styles from "./LexiconEditor.module.css";

const initialDraft: LexiconEntryDraft = {
  scope: "global",
  entryType: "exactTerm",
  displayText: "",
  senseId: "",
  spokenText: "",
  caseSensitive: true,
  wholeWord: true,
  priority: 0,
  enabled: true,
  notes: ""
};

interface LexiconEditorProps {
  entries: LexiconEntry[];
  error?: string;
  onAdd: (draft: LexiconEntryDraft) => boolean;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
  removedEntries: LexiconEntry[];
}

export function LexiconEditor({ entries, error, onAdd, onRemove, onRestore, removedEntries }: LexiconEditorProps) {
  const [draft, setDraft] = useState(initialDraft);

  function update<Key extends keyof LexiconEntryDraft>(key: Key, value: LexiconEntryDraft[Key]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className={styles.editor} aria-labelledby="lexicon-editor-heading">
      <div className={styles.heading}>
        <div>
          <p>Memory-only rules</p>
          <h3 id="lexicon-editor-heading">Lexicon entries</h3>
        </div>
        <span>{entries.length} active · {removedEntries.length} removed</span>
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (onAdd(draft)) setDraft(initialDraft);
        }}
      >
        <label>Lexicon scope<select value={draft.scope} onChange={(event) => update("scope", event.target.value as LexiconEntryDraft["scope"])}><option value="global">Global</option><option value="project">Project</option></select></label>
        <label>Entry type<select value={draft.entryType} onChange={(event) => update("entryType", event.target.value as LexiconEntryDraft["entryType"])}><option value="exactTerm">Exact term</option><option value="exactPhrase">Exact phrase</option><option value="namedSense">Named sense</option></select></label>
        <label>Display text<input value={draft.displayText} onChange={(event) => update("displayText", event.target.value)} /></label>
        {draft.entryType === "namedSense" ? <label>Sense ID<input value={draft.senseId} onChange={(event) => update("senseId", event.target.value)} /></label> : null}
        <label>Spoken text<input value={draft.spokenText} onChange={(event) => update("spokenText", event.target.value)} /></label>
        <label>Priority<input type="number" value={draft.priority} onChange={(event) => update("priority", Number(event.target.value))} /></label>
        <label>Notes<input value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
        <div className={styles.checks}>
          <label><input type="checkbox" checked={draft.caseSensitive} onChange={(event) => update("caseSensitive", event.target.checked)} />Case sensitive</label>
          <label><input type="checkbox" checked={draft.wholeWord} onChange={(event) => update("wholeWord", event.target.checked)} />Whole word</label>
          <label><input type="checkbox" checked={draft.enabled} onChange={(event) => update("enabled", event.target.checked)} />Enabled</label>
        </div>
        <button type="submit">Add entry</button>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </form>
      <div className={styles.entries} aria-label="Active lexicon entries">
        {entries.length === 0 ? <p>No lexicon entries yet.</p> : entries.map((entry) => (
          <article key={entry.id}>
            <div><strong>{entry.displayText}{entry.senseId ? ` + ${entry.senseId}` : ""}</strong><span>{entry.spokenText}</span></div>
            <code>{entry.scope} · {entry.entryType} · priority {entry.priority} · {entry.id}</code>
            <button type="button" onClick={() => onRemove(entry.id)}>Delete entry</button>
          </article>
        ))}
      </div>
      {removedEntries.length > 0 ? (
        <div className={styles.removed} aria-label="Removed lexicon entries">
          <h4>Removed this session</h4>
          {removedEntries.map((entry) => <button type="button" key={entry.id} onClick={() => onRestore(entry.id)}>Restore {entry.displayText}{entry.senseId ? ` + ${entry.senseId}` : ""}</button>)}
        </div>
      ) : null}
    </section>
  );
}
