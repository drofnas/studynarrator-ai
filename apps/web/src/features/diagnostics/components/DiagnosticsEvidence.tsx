import type { SystemDiagnostics } from "@studynarrator/shared-types";
import styles from "./DiagnosticsEvidence.module.css";

interface DiagnosticsEvidenceProps {
  diagnostics: SystemDiagnostics;
}

export function DiagnosticsEvidence({ diagnostics }: DiagnosticsEvidenceProps) {
  const storage = diagnostics.checks.storage;
  return (
    <div className={styles.grid}>
      <article><p>Application</p><code>StudyNarrator {diagnostics.runtime.applicationVersion} · diagnostics schema {diagnostics.schemaVersion}</code></article>
      <article><p>Data directory</p><code>{diagnostics.runtime.dataDirectory}</code></article>
      <article><p>Runtime</p><code>{diagnostics.runtime.runtimeName} {diagnostics.runtime.runtimeVersion}{diagnostics.runtime.electronVersion ? ` · Electron ${diagnostics.runtime.electronVersion}` : ""}</code></article>
      <article><p>Source revision</p><code>{diagnostics.runtime.sourceRevision}</code></article>
      <article><p>Transport</p><code>{diagnostics.client} · {diagnostics.transport}</code></article>
      <article><p>Database</p><code>{storage.status === "pass" ? storage.databasePath : storage.databasePath ?? storage.message}</code></article>
      <article><p>Storage check</p><code>{storage.status === "pass" ? `Schema ${storage.migrationVersion} · verified ${storage.createdAt}` : storage.message}</code></article>
      <article><p>Latest backup</p><code>{storage.status === "pass" ? storage.latestBackupPath ?? "No migration backup" : storage.recoveryBackupPath ?? "Unavailable"}</code></article>
      <article><p>Native tools</p><code>{storage.status === "pass" ? `SQLite ${storage.sqliteVersion}` : "SQLite unavailable"}{" · "}{diagnostics.checks.ffmpeg.status === "pass" ? diagnostics.checks.ffmpeg.version : diagnostics.checks.ffmpeg.message}</code></article>
    </div>
  );
}
