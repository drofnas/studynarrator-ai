import styles from "./ScriptEditor.module.css";

interface ScriptEditorProps {
  defaultSpeakerId: string;
  onDefaultSpeakerIdChange: (value: string) => void;
  onSourceChange: (value: string) => void;
  source: string;
}

export function ScriptEditor({ defaultSpeakerId, onDefaultSpeakerIdChange, onSourceChange, source }: ScriptEditorProps) {
  return (
    <div className={styles.grid}>
      <label htmlFor="script-source">Script source</label>
      <textarea id="script-source" value={source} onChange={(event) => onSourceChange(event.target.value)} spellCheck={false} />
      <label htmlFor="default-speaker">Default speaker ID <span>(optional, in memory only)</span></label>
      <input id="default-speaker" value={defaultSpeakerId} onChange={(event) => onDefaultSpeakerIdChange(event.target.value)} placeholder="narrator" />
    </div>
  );
}
