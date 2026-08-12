import type { ReactNode } from "react";
import type { CirNode } from "@studynarrator/core";
import styles from "./CanonicalNodeTable.module.css";

interface CanonicalNodeTableProps {
  nodes: CirNode[];
}

function nodeContent(node: CirNode): ReactNode {
  switch (node.type) {
    case "speech": return (
      <span className={styles.speechContent}>
        <span className={styles.speakerChip} aria-label={`Speaker ${node.speakerId}`}>
          <span className={styles.speakerLabel} aria-hidden="true">speaker</span>
          <span className={styles.speakerName} aria-hidden="true">{node.speakerId}</span>
        </span>
        <span className={styles.speechCopy}>{node.readableText}</span>
      </span>
    );
    case "pause": return node.pauseId;
    case "section": return node.title;
    case "paragraphBreak": return `${String(node.lineCount)} blank line${node.lineCount === 1 ? "" : "s"}`;
  }
}

export function CanonicalNodeTable({ nodes }: CanonicalNodeTableProps) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption>Ordered canonical nodes</caption>
        <thead><tr><th scope="col">#</th><th scope="col">Type</th><th scope="col">Source line</th><th scope="col">Content</th></tr></thead>
        <tbody>{nodes.map((node) => <tr key={node.ordinal}><td>{node.ordinal}</td><td>{node.type}</td><td>{node.range.start.line}</td><td>{nodeContent(node)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
