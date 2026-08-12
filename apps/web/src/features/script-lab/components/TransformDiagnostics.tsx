import type { IgnoredDiagnostic, TransformDiagnostic, TransformScriptResult } from "@studynarrator/core";
import styles from "./DiagnosticList.module.css";

interface TransformDiagnosticsProps {
  errors: TransformScriptResult["errors"];
  onIgnore: (item: IgnoredDiagnostic) => void;
  warnings: TransformScriptResult["warnings"];
}

function Diagnostic({ item, onIgnore }: { item: TransformDiagnostic; onIgnore: (item: IgnoredDiagnostic) => void }) {
  return (
    <article>
      <strong>Line {item.range.start.line}, column {item.range.start.column} · {item.code}</strong>
      <span>{item.message}</span>
      <code>{item.offendingText}</code>
      {item.ignorePattern !== item.offendingText ? <span>Ignore pattern: <code>{item.ignorePattern}</code></span> : null}
      <em>{item.suggestion}</em>
      <button type="button" onClick={() => onIgnore({ code: item.code, pattern: item.ignorePattern })}>Ignore this pattern</button>
    </article>
  );
}

export function TransformDiagnostics({ errors, onIgnore, warnings }: TransformDiagnosticsProps) {
  return (
    <>
      {errors.length > 0 ? (
        <section className={`${styles.list} ${styles.errors}`} aria-labelledby="transform-errors" role="alert">
          <h3 id="transform-errors">Transformation errors ({errors.length})</h3>
          {errors.map((item) => <Diagnostic item={item} key={`${item.nodeOrdinal}:${item.sourceStartOffset}:${item.code}`} onIgnore={onIgnore} />)}
        </section>
      ) : null}
      {warnings.length > 0 ? (
        <section className={`${styles.list} ${styles.warnings}`} aria-labelledby="transform-warnings">
          <h3 id="transform-warnings">Transformation warnings ({warnings.length})</h3>
          {warnings.map((item) => <Diagnostic item={item} key={`${item.nodeOrdinal}:${item.sourceStartOffset}:${item.code}`} onIgnore={onIgnore} />)}
        </section>
      ) : null}
    </>
  );
}
