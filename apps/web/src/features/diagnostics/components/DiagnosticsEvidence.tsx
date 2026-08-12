import type { SystemDiagnostics } from "@studynarrator/shared-types";
import styles from "./DiagnosticsEvidence.module.css";

interface DiagnosticsEvidenceProps {
  diagnostics: SystemDiagnostics;
}

export function DiagnosticsEvidence({ diagnostics }: DiagnosticsEvidenceProps) {
  return (
    <div className={styles.grid}>
      <article><p>Data directory</p><code>{diagnostics.runtime.dataDirectory}</code></article>
      <article><p>Runtime</p><code>{diagnostics.runtime.runtimeName} {diagnostics.runtime.runtimeVersion}{diagnostics.runtime.electronVersion ? ` · Electron ${diagnostics.runtime.electronVersion}` : ""}</code></article>
      <article><p>Persistent marker</p><code>{diagnostics.checks.storage.status === "pass" ? `${diagnostics.checks.storage.markerValue} · ${diagnostics.checks.storage.createdAt}` : diagnostics.checks.storage.message}</code></article>
      <article><p>Native tools</p><code>{diagnostics.checks.storage.status === "pass" ? `SQLite ${diagnostics.checks.storage.sqliteVersion}` : "SQLite unavailable"}{" · "}{diagnostics.checks.ffmpeg.status === "pass" ? diagnostics.checks.ffmpeg.version : diagnostics.checks.ffmpeg.message}</code></article>
    </div>
  );
}
