import { useMemo, useState } from "react";
import styles from "./LexiconEditor.module.css";

export interface LexiconEditorValue {
  id?: string;
  displayText: string;
  spokenText: string;
  enabled: boolean;
}

export type LexiconEditorChange =
  | { kind: "edit"; id: string }
  | { kind: "commit"; id: string }
  | { kind: "toggle"; id: string }
  | { kind: "add"; id: string }
  | { kind: "delete"; id: string };

export interface LexiconEditorProps {
  value: readonly LexiconEditorValue[];
  onChange: (next: LexiconEditorValue[], change: LexiconEditorChange) => boolean | void | Promise<boolean | void>;
  searchLabel: string;
  emptyMessage: string;
  disabled?: boolean;
  rowErrors?: Readonly<Record<string, string | undefined>>;
}

let generatedId = 0;
function nextId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  generatedId += 1;
  return `lexicon-${String(generatedId)}`;
}

function keyFor(entry: LexiconEditorValue, index: number): string {
  return entry.id ?? `lexicon-row-${String(index)}`;
}

function duplicateMessage(entries: readonly LexiconEditorValue[], displayText: string, exceptIndex?: number): string {
  const key = displayText.trim().toLocaleLowerCase("en-US");
  if (!key) return "Script Text and Spoken Text are required.";
  return entries.some((entry, index) => index !== exceptIndex && entry.displayText.trim().toLocaleLowerCase("en-US") === key)
    ? "Script Text must be unique regardless of capitalization."
    : "";
}

export function LexiconEditor({ value, onChange, searchLabel, emptyMessage, disabled = false, rowErrors = {} }: LexiconEditorProps) {
  const [draft, setDraft] = useState({ displayText: "", spokenText: "" });
  const [search, setSearch] = useState("");
  const [validationError, setValidationError] = useState("");
  const [pending, setPending] = useState(false);
  const filtered = useMemo(() => value
    .map((entry, index) => ({ entry, index, id: keyFor(entry, index) }))
    .filter(({ entry }) => !search || `${entry.displayText} ${entry.spokenText}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [search, value]);

  const submit = async () => {
    const displayText = draft.displayText.trim();
    const spokenText = draft.spokenText.trim();
    const validation = !displayText || !spokenText
      ? "Script Text and Spoken Text are required."
      : duplicateMessage(value, displayText);
    if (validation) { setValidationError(validation); return; }
    const id = nextId();
    setPending(true);
    const saved = await onChange([...value, { id, displayText, spokenText, enabled: true }], { kind: "add", id });
    setPending(false);
    if (saved !== false) {
      setDraft({ displayText: "", spokenText: "" });
      setValidationError("");
    }
  };

  const update = (index: number, id: string, field: "displayText" | "spokenText", nextValue: string) => {
    if (field === "displayText") setValidationError(duplicateMessage(value, nextValue, index));
    else if (!nextValue.trim()) setValidationError("Script Text and Spoken Text are required.");
    else setValidationError("");
    void onChange(value.map((entry, candidateIndex) => candidateIndex === index ? { ...entry, [field]: nextValue } : entry), { kind: "edit", id });
  };

  return <div className={styles.editor}>
    <form className={styles.add} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>Script Text<input disabled={disabled || pending} value={draft.displayText} onChange={(event) => { setDraft((current) => ({ ...current, displayText: event.target.value })); setValidationError(""); }} /></label>
      <span aria-hidden="true">→</span>
      <label>Spoken Text<input disabled={disabled || pending} value={draft.spokenText} onChange={(event) => { setDraft((current) => ({ ...current, spokenText: event.target.value })); setValidationError(""); }} /></label>
      <button type="submit" disabled={disabled || pending}>{pending ? "Adding…" : "Add"}</button>
    </form>
    {validationError ? <p className={styles.validation} role="alert">{validationError}</p> : null}
    <input className={styles.search} aria-label={searchLabel} placeholder="Search Script Text or Spoken Text" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className={styles.entries}>{filtered.length === 0 ? <p>{emptyMessage}</p> : filtered.map(({ entry, index, id }) => {
      return <article key={id} aria-label={`Lexicon entry ${entry.displayText || "without Script Text"}`}>
        <label>Script Text<input disabled={disabled || pending} value={entry.displayText} onChange={(event) => update(index, id, "displayText", event.target.value)} onBlur={() => void onChange([...value], { kind: "commit", id })} /></label>
        <span aria-hidden="true">→</span>
        <label>Spoken Text<input disabled={disabled || pending} value={entry.spokenText} onChange={(event) => update(index, id, "spokenText", event.target.value)} onBlur={() => void onChange([...value], { kind: "commit", id })} /></label>
        <label className={styles.enabled}><input type="checkbox" disabled={disabled || pending} checked={entry.enabled} onChange={(event) => void onChange(value.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, enabled: event.target.checked } : candidate), { kind: "toggle", id })} />Enabled</label>
        {rowErrors[id] ? <span className={styles.rowError} role="alert">{rowErrors[id]}</span> : null}
        <button type="button" className={styles.danger} disabled={disabled || pending} onClick={() => void onChange(value.filter((_candidate, candidateIndex) => candidateIndex !== index), { kind: "delete", id })}>Delete</button>
      </article>;
    })}</div>
  </div>;
}
