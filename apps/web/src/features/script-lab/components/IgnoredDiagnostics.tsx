import type { IgnoredDiagnostic } from "@studynarrator/core";
import styles from "./DiagnosticList.module.css";

interface IgnoredDiagnosticsProps {
  items: IgnoredDiagnostic[];
  onRestore: (item: IgnoredDiagnostic) => void;
}

export function IgnoredDiagnostics({ items, onRestore }: IgnoredDiagnosticsProps) {
  if (items.length === 0) return null;
  return (
    <section className={`${styles.list} ${styles.ignored}`} aria-labelledby="ignored-diagnostics">
      <h3 id="ignored-diagnostics">Ignored diagnostic patterns ({items.length})</h3>
      <p>Every matching parser or transformation diagnostic is ignored for this Script Lab session, regardless of its surrounding sentence. Durable personal preferences arrive in G04.</p>
      {items.map((item) => (
        <article key={`${item.code}:${item.pattern}`}>
          <strong>{item.code}</strong>
          <code>{item.pattern}</code>
          <button type="button" onClick={() => onRestore(item)}>Restore this pattern</button>
        </article>
      ))}
    </section>
  );
}
