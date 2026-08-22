import styles from "./estimateStrip.module.css";

interface EstimateStripProps {
  wordCount: number;
  durationMs?: number;
  mp3Bytes?: number;
  cacheBytes?: number;
  peakDiskBytes?: number;
  /** Omitted is loading; null is unavailable. */
  freeSpaceBytes?: number | null;
  allVoicesCalibrated: boolean;
}

function formatDuration(durationMs: number | undefined): string {
  if (
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  )
    return "—";
  const totalSeconds = Math.round(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0)
    return `${String(hours)}h ${String(minutes)}m ${String(seconds)}s`;
  if (minutes > 0) return `${String(minutes)}m ${String(seconds)}s`;
  return `${String(seconds)}s`;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0)
    return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  return unitIndex === 0
    ? `${String(value)} ${units[unitIndex]}`
    : `${value.toFixed(1)} ${units[unitIndex]}`;
}

function EstimateValue({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.item}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function EstimateStrip({
  wordCount,
  durationMs,
  mp3Bytes,
  cacheBytes,
  peakDiskBytes,
  freeSpaceBytes,
  allVoicesCalibrated,
}: EstimateStripProps) {
  const hasEstimate = durationMs !== undefined;
  const status = hasEstimate
    ? allVoicesCalibrated
      ? "Voice timing calibration applied."
      : "Estimate uses default voice timing until calibration is available."
    : "Waiting for script analysis.";
  const estimated = !allVoicesCalibrated;

  return (
    <div className={styles.strip} role="group" aria-label="Script estimates">
      <p
        className={styles.status}
        role="status"
        aria-label="Estimate calibration status"
      >
        {status}
      </p>
      <dl className={styles.values}>
        <EstimateValue
          label="Words"
          value={
            Number.isSafeInteger(wordCount) && wordCount >= 0
              ? wordCount.toLocaleString()
              : "—"
          }
        />
        <EstimateValue
          label={estimated ? "Estimated duration" : "Duration"}
          value={formatDuration(durationMs)}
        />
        <EstimateValue
          label={estimated ? "Estimated MP3 size" : "MP3 size"}
          value={formatBytes(mp3Bytes)}
        />
        <EstimateValue
          label={estimated ? "Estimated cache footprint" : "Cache footprint"}
          value={formatBytes(cacheBytes)}
        />
        <EstimateValue
          label={estimated ? "Estimated peak disk" : "Peak disk"}
          value={formatBytes(peakDiskBytes)}
        />
        <EstimateValue
          label="Free space"
          value={
            freeSpaceBytes === undefined
              ? "Loading…"
              : freeSpaceBytes === null
                ? "Unavailable"
                : formatBytes(freeSpaceBytes)
          }
        />
      </dl>
    </div>
  );
}
