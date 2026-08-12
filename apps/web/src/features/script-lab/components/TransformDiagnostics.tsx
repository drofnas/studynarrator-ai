import type { TransformScriptResult } from "@studynarrator/core";
import styles from "./DiagnosticList.module.css";

interface TransformDiagnosticsProps {
  errors: TransformScriptResult["errors"];
  warnings: TransformScriptResult["warnings"];
}

export function TransformDiagnostics({ errors, warnings }: TransformDiagnosticsProps) {
  return (
    <>
      {errors.length > 0 ? (
        <section className={`${styles.list} ${styles.errors}`} aria-labelledby="transform-errors" role="alert">
          <h3 id="transform-errors">Transformation errors ({errors.length})</h3>
          {errors.map((item) => <article key={`${item.nodeOrdinal}:${item.sourceStartOffset}:${item.code}`}><strong>Line {item.range.start.line}, column {item.range.start.column} · {item.code}</strong><span>{item.message}</span><code>{item.offendingText}</code><em>{item.suggestion}</em></article>)}
        </section>
      ) : null}
      {warnings.length > 0 ? (
        <section className={`${styles.list} ${styles.warnings}`} aria-labelledby="transform-warnings">
          <h3 id="transform-warnings">Transformation warnings ({warnings.length})</h3>
          {warnings.map((item) => <article key={`${item.nodeOrdinal}:${item.sourceStartOffset}:${item.code}`}><strong>Line {item.range.start.line}, column {item.range.start.column} · {item.code}</strong><span>{item.message}</span><em>{item.suggestion}</em></article>)}
        </section>
      ) : null}
    </>
  );
}
