import { useState } from "react";
import type { LexiconEntry } from "@studynarrator/core";
import type { LexiconEntryDraft, LexiconJsonSaveResult } from "../useScriptLab.js";
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
  onReplaceFromJson: (value: unknown) => LexiconJsonSaveResult;
  onRestore: (id: string) => void;
  removedEntries: LexiconEntry[];
}

function entriesToJson(entries: LexiconEntry[]): string {
  return JSON.stringify(entries.map((entry) => ({
    id: entry.id,
    scope: entry.scope,
    entryType: entry.entryType,
    displayText: entry.displayText,
    ...(entry.senseId ? { senseId: entry.senseId } : {}),
    spokenText: entry.spokenText,
    caseSensitive: entry.caseSensitive,
    wholeWord: entry.wholeWord,
    priority: entry.priority,
    enabled: entry.enabled,
    notes: entry.notes
  })), null, 2);
}

export function LexiconEditor({ entries, error, onAdd, onRemove, onReplaceFromJson, onRestore, removedEntries }: LexiconEditorProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);
  const [jsonMode, setJsonMode] = useState(false);

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
        <div className={styles.headingActions}>
          <span>{entries.length} active · {removedEntries.length} removed</span>
          {!jsonMode ? <button type="button" onClick={() => { setJsonDraft(entriesToJson(entries)); setJsonErrors([]); setJsonMode(true); }}>Edit as JSON</button> : null}
        </div>
      </div>
      {jsonMode ? (
        <div className={styles.jsonEditor}>
          <label htmlFor="lexicon-json">Lexicon entries JSON</label>
          <p id="lexicon-json-help">Save replaces the active list for this session only. IDs are optional for new entries; timestamps are managed internally.</p>
          <textarea
            id="lexicon-json"
            value={jsonDraft}
            onChange={(event) => { setJsonDraft(event.target.value); setJsonErrors([]); }}
            aria-describedby="lexicon-json-help lexicon-json-errors"
            aria-invalid={jsonErrors.length > 0}
            spellCheck={false}
          />
          {jsonErrors.length > 0 ? (
            <div className={styles.jsonErrors} id="lexicon-json-errors" role="alert">
              <strong>JSON could not be saved.</strong>
              <ul>{jsonErrors.map((item, index) => <li key={`${String(index)}:${item}`}>{item}</li>)}</ul>
            </div>
          ) : <span id="lexicon-json-errors" />}
          <div className={styles.jsonActions}>
            <button
              type="button"
              onClick={() => {
                let value: unknown;
                try {
                  value = JSON.parse(jsonDraft) as unknown;
                } catch (parseError) {
                  setJsonErrors([`JSON syntax: ${parseError instanceof Error ? parseError.message : "The text is not valid JSON."}`]);
                  return;
                }
                const result = onReplaceFromJson(value);
                if (!result.success) {
                  setJsonErrors(result.errors);
                  return;
                }
                setJsonErrors([]);
                setJsonMode(false);
              }}
            >Save JSON</button>
            <button className={styles.secondaryButton} type="button" onClick={() => { setJsonErrors([]); setJsonMode(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}
    </section>
  );
}
