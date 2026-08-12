import { SYSTEM_DEFAULT_SPEAKER_ID } from "@studynarrator/core";
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
      <label htmlFor="default-speaker">Default speaker override <span>(optional, in memory only)</span></label>
      <input
        aria-describedby="default-speaker-help"
        id="default-speaker"
        value={defaultSpeakerId}
        onChange={(event) => onDefaultSpeakerIdChange(event.target.value)}
        placeholder={`System Default (${SYSTEM_DEFAULT_SPEAKER_ID})`}
      />
      <p className={styles.help} id="default-speaker-help">Leave blank to use System Default (<code>{SYSTEM_DEFAULT_SPEAKER_ID}</code>).</p>
    </div>
  );
}
