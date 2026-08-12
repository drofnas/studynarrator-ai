import type { ResolveParagraphPausesResult } from "@studynarrator/core";
import styles from "./PacingPreview.module.css";

interface PacingPreviewProps {
  result: ResolveParagraphPausesResult;
}

function boundaryLocations(result: ResolveParagraphPausesResult["audits"][number]): string {
  return result.paragraphBreaks.map(({ range }) => `Line ${String(range.start.line)}, column ${String(range.start.column)}`).join("; ");
}

export function PacingPreview({ result }: PacingPreviewProps) {
  const appliedCount = result.audits.filter(({ status }) => status === "applied").length;
  const suppressedCount = result.audits.length - appliedCount;

  return (
    <section className={styles.preview} aria-labelledby="pacing-preview-heading">
      <div className={styles.heading}>
        <div>
          <p>Deterministic analysis</p>
          <h3 id="pacing-preview-heading">Paragraph pacing preview</h3>
        </div>
        <span>{appliedCount} applied · {suppressedCount} suppressed</span>
      </div>
      {!result.configuration.enabled ? <p>Automatic paragraph pauses are disabled.</p> : null}
      {result.configuration.enabled && result.audits.length === 0 ? <p>No eligible paragraph boundaries were found.</p> : null}
      {result.audits.length > 0 ? (
        <div className={styles.tableWrap}>
          <table aria-label="Paragraph pacing preview">
            <thead><tr><th>Boundary</th><th>Speech interval</th><th>Resolution</th><th>Pause</th></tr></thead>
            <tbody>{result.audits.map((audit) => (
              <tr key={`${String(audit.previousSpeechNodeOrdinal)}:${String(audit.nextSpeechNodeOrdinal)}`}>
                <td>{boundaryLocations(audit)}<small>Nodes {audit.paragraphBreaks.map(({ nodeOrdinal }) => `#${String(nodeOrdinal)}`).join(", ")}</small></td>
                <td>Speech #{audit.previousSpeechNodeOrdinal} → #{audit.nextSpeechNodeOrdinal}</td>
                <td>{audit.status === "applied" ? "Applied automatic pause" : "Suppressed by explicit pause"}{audit.explicitPauseNodeOrdinals.length > 0 ? <small>Explicit nodes {audit.explicitPauseNodeOrdinals.map((ordinal) => `#${String(ordinal)}`).join(", ")}</small> : null}</td>
                <td><code>{audit.pauseId}</code><small>{audit.durationMs} ms</small></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
