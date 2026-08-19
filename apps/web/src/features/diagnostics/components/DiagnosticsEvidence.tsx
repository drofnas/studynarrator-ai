import type { SystemDiagnostics } from "@studynarrator/shared-types";
import styles from "./DiagnosticsEvidence.module.css";

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DiagnosticsEvidenceProps {
  diagnostics: SystemDiagnostics;
}

export function DiagnosticsEvidence({ diagnostics }: DiagnosticsEvidenceProps) {
  const storage = diagnostics.checks.storage;
  return (
    <div className={styles.grid}>
      <article>
        <p>Application</p>
        <code>
          StudyNarrator {diagnostics.runtime.applicationVersion} · diagnostics
          schema {diagnostics.schemaVersion}
        </code>
      </article>
      <article>
        <p>Data directory</p>
        <code>{diagnostics.runtime.dataDirectory}</code>
      </article>
      <article>
        <p>Runtime</p>
        <code>
          {diagnostics.runtime.runtimeName} {diagnostics.runtime.runtimeVersion}
          {diagnostics.runtime.electronVersion
            ? ` · Electron ${diagnostics.runtime.electronVersion}`
            : ""}
        </code>
      </article>
      <article>
        <p>Source revision</p>
        <code>{diagnostics.runtime.sourceRevision}</code>
      </article>
      <article>
        <p>Transport</p>
        <code>
          {diagnostics.client} · {diagnostics.transport}
        </code>
      </article>
      <article>
        <p>Database</p>
        <code>
          {storage.status === "pass"
            ? storage.databasePath
            : (storage.databasePath ?? storage.message)}
        </code>
      </article>
      <article>
        <p>Storage check</p>
        <code>
          {storage.status === "pass"
            ? `Schema ${storage.migrationVersion} · verified ${storage.createdAt}`
            : storage.message}
        </code>
      </article>
      <article>
        <p>Latest backup</p>
        <code>
          {storage.status === "pass"
            ? (storage.latestBackupPath ?? "No migration backup")
            : (storage.recoveryBackupPath ?? "Unavailable")}
        </code>
      </article>
      <article>
        <p>Backup storage</p>
        <code>
          {diagnostics.backupCount} {" "}
          {diagnostics.backupCount === 1 ? "backup" : "backups"} ·{" "}
          {formatBytes(diagnostics.backupTotalBytes)} total
          {diagnostics.oldestBackupAt !== null
            ? ` · oldest ${diagnostics.oldestBackupAt}`
            : ""}
        </code>
      </article>
      <article>
        <p>Native tools</p>
        <code>
          {storage.status === "pass"
            ? `SQLite ${storage.sqliteVersion}`
            : "SQLite unavailable"}
          {" · "}
          {diagnostics.checks.ffmpeg.status === "pass"
            ? diagnostics.checks.ffmpeg.version
            : diagnostics.checks.ffmpeg.message}
        </code>
      </article>
    </div>
  );
}
