import {
  DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
  DEFAULT_PARAGRAPH_PAUSE_ID
} from "@studynarrator/core";
import styles from "./TransitionSettings.module.css";

interface TransitionSettingsProps {
  paragraphPauseEnabled: boolean;
  onParagraphPauseEnabledChange: (enabled: boolean) => void;
}

export function TransitionSettings({ paragraphPauseEnabled, onParagraphPauseEnabledChange }: TransitionSettingsProps) {
  return (
    <section className={styles.settings} aria-labelledby="transition-settings-heading">
      <div className={styles.heading}>
        <div>
          <p>In-memory pacing</p>
          <h3 id="transition-settings-heading">Transition settings</h3>
        </div>
        <span><code>{DEFAULT_PARAGRAPH_PAUSE_ID}</code> · {DEFAULT_PARAGRAPH_PAUSE_DURATION_MS} ms</span>
      </div>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={paragraphPauseEnabled}
          onChange={(event) => onParagraphPauseEnabledChange(event.target.checked)}
        />
        <span>
          <strong>Pause at paragraph breaks</strong>
          <small>Resolve eligible blank-line boundaries to the medium pause. Explicit pause directives take precedence.</small>
        </span>
      </label>
      <p className={styles.help}>This G03 preview does not generate audio. System Settings will provide the default duration, and projects will keep an independent override.</p>
    </section>
  );
}
