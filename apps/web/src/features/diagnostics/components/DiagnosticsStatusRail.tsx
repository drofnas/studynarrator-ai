import type { ReactNode } from "react";
import type { CheckStatus, SystemDiagnostics } from "@studynarrator/shared-types";
import styles from "./DiagnosticsStatusRail.module.css";

interface DiagnosticsStatusRailProps {
  diagnostics: SystemDiagnostics | undefined;
  loading: boolean;
}

function StatusValue({ status, children }: { status: CheckStatus | undefined; children: ReactNode }) {
  const statusClass = status === "pass" ? styles.statusPass : status === "fail" ? styles.statusFail : "";
  return (
    <span className={`${styles.statusValue} ${statusClass}`}>
      <span className={styles.statusLamp} aria-hidden="true" />
      {children}
    </span>
  );
}

function statusLabel(status?: CheckStatus) {
  if (!status) return "NOT RUN";
  return status.toUpperCase();
}

export function DiagnosticsStatusRail({ diagnostics, loading }: DiagnosticsStatusRailProps) {
  const sharedStatus = diagnostics?.checks.sharedCore.status;
  const storageStatus = diagnostics?.checks.storage.status;
  const ffmpegStatus = diagnostics?.checks.ffmpeg.status;

  return (
    <div className={styles.rail} aria-live="polite" aria-busy={loading}>
      <div className={styles.row}><span>Shared core</span><StatusValue status={sharedStatus}>{loading ? "CHECKING" : statusLabel(sharedStatus)}</StatusValue></div>
      <div className={styles.row}><span>Storage write/read</span><StatusValue status={storageStatus}>{loading ? "CHECKING" : statusLabel(storageStatus)}</StatusValue></div>
      <div className={styles.row}><span>FFmpeg</span><StatusValue status={ffmpegStatus}>{loading ? "CHECKING" : statusLabel(ffmpegStatus)}</StatusValue></div>
      <div className={`${styles.row} ${styles.metadataRow}`}><span>Transport</span><strong>{diagnostics?.transport.toUpperCase() ?? "—"}</strong></div>
      <div className={`${styles.row} ${styles.metadataRow}`}><span>Client</span><strong>{diagnostics ? (diagnostics.client === "web" ? "Web" : "Electron") : "—"}</strong></div>
    </div>
  );
}
