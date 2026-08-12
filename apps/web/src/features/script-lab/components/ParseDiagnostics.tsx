import type { IgnoredDiagnostic, ParseScriptResult } from "@studynarrator/core";
import styles from "./DiagnosticList.module.css";

interface ParseDiagnosticsProps {
  errors: ParseScriptResult["errors"];
  onIgnore: (item: IgnoredDiagnostic) => void;
  warnings: ParseScriptResult["warnings"];
}

export function ParseDiagnostics({ errors, onIgnore, warnings }: ParseDiagnosticsProps) {
  return (
    <>
      {errors.length > 0 ? (
        <section className={`${styles.list} ${styles.errors}`} aria-labelledby="parse-errors" role="alert">
          <h3 id="parse-errors">Blocking errors ({errors.length})</h3>
          {errors.map((item) => (
            <article key={`${item.line}:${item.column}:${item.code}`}>
              <strong>Line {item.line}, column {item.column} · {item.code}</strong>
              <span>{item.message}</span>
              <code>{item.offendingText}</code>
              {item.ignorePattern !== item.offendingText ? <span>Ignore pattern: <code>{item.ignorePattern}</code></span> : null}
              <em>{item.suggestion}</em>
              <button type="button" onClick={() => onIgnore({ code: item.code, pattern: item.ignorePattern })}>Ignore this pattern</button>
            </article>
          ))}
        </section>
      ) : null}
      {warnings.length > 0 ? (
        <section className={`${styles.list} ${styles.warnings}`} aria-labelledby="parse-warnings">
          <h3 id="parse-warnings">Warnings ({warnings.length})</h3>
          {warnings.map((item) => (
            <article key={`${item.line}:${item.column}:${item.code}`}>
              <strong>Line {item.line}, column {item.column} · {item.code}</strong>
              <span>{item.message}</span>
              <em>{item.suggestion}</em>
              <button type="button" onClick={() => onIgnore({ code: item.code, pattern: item.ignorePattern })}>Ignore this pattern</button>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
