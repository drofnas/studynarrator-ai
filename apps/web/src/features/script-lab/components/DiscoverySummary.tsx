import type { ParseScriptResult } from "@studynarrator/core";
import styles from "./DiscoverySummary.module.css";

interface DiscoverySummaryProps {
  summary: ParseScriptResult["summary"];
}

export function DiscoverySummary({ summary }: DiscoverySummaryProps) {
  return (
    <div className={styles.grid} aria-label="Discovery summary">
      <article><strong>{summary.speakerCount}</strong><span>Speakers</span></article>
      <article><strong>{summary.pauseIdCount}</strong><span>Pause IDs</span></article>
      <article><strong>{summary.sectionCount}</strong><span>Sections</span></article>
      <article><strong>{summary.speechSegmentCount}</strong><span>Speech segments</span></article>
      <article><strong>{summary.explicitPauseSegmentCount}</strong><span>Explicit pauses</span></article>
      <article><strong>{summary.pronunciationAnnotationCount}</strong><span>Annotations</span></article>
    </div>
  );
}
