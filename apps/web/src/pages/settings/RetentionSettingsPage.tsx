import { useEffect, useState } from "react";
import {
  DEFAULT_RETENTION_SETTINGS,
  type PersistenceClient,
  type RetentionReclaimPreview,
  type RetentionSettings,
  type RetentionUsage,
} from "@studynarrator/shared-types";
import styles from "./SettingsPage.module.css";

const GIB = 1_024 ** 3;
const ttlOptions = [
  ["8h", "8 hours"],
  ["24h", "24 hours"],
  ["7d", "7 days"],
  ["never", "Never"],
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KiB`;
  if (bytes < GIB) return `${(bytes / 1_024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

function total(usage: RetentionUsage): number {
  return Object.values(usage).reduce((sum, item) => sum + item.bytes, 0);
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function RetentionSettingsPage({
  client,
}: {
  client: PersistenceClient;
}) {
  const [settings, setSettings] = useState<RetentionSettings>();
  const [usage, setUsage] = useState<RetentionUsage>();
  const [capGiB, setCapGiB] = useState(
    String(DEFAULT_RETENTION_SETTINGS.speechCacheSizeCapBytes / GIB),
  );
  const [preview, setPreview] = useState<RetentionReclaimPreview>();
  const [status, setStatus] = useState("Loading retention settings…");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);

  const refreshUsage = async () => setUsage(await client.retention.usage());

  useEffect(() => {
    let active = true;
    void Promise.all([client.retention.get(), client.retention.usage()])
      .then(([loaded, loadedUsage]) => {
        if (!active) return;
        setSettings(loaded);
        setCapGiB(String(loaded.speechCacheSizeCapBytes / GIB));
        setUsage(loadedUsage);
        setStatus("Retention settings are loaded.");
      })
      .catch((reason: unknown) => {
        if (active)
          setError(message(reason, "Retention settings could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [client]);

  const save = async () => {
    if (!settings) return;
    const cap = Math.round(Number(capGiB) * GIB);
    if (!Number.isSafeInteger(cap) || cap < 1) {
      setError("Speech cache cap must be a positive whole number of bytes.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await client.retention.update({
        speechCacheTtl: settings.speechCacheTtl,
        jobSnapshotTtl: settings.jobSnapshotTtl,
        renderArtifactTtl: settings.renderArtifactTtl,
        speechCacheSizeCapBytes: cap,
      });
      setSettings(saved);
      setCapGiB(String(saved.speechCacheSizeCapBytes / GIB));
      setStatus("Retention settings saved.");
    } catch (reason) {
      setError(message(reason, "Retention settings could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const showPreview = async () => {
    setReclaiming(true);
    setError("");
    try {
      const next = await client.retention.previewReclaim();
      setPreview(next);
      setStatus(
        next.skipped
          ? "Reclaim is unavailable while a render is active."
          : `Preview found ${formatBytes(total(next.reclaimable))} reclaimable.`,
      );
    } catch (reason) {
      setError(message(reason, "A reclaim preview could not be created."));
    } finally {
      setReclaiming(false);
    }
  };

  const confirmReclaim = async () => {
    setReclaiming(true);
    setError("");
    try {
      const result = await client.retention.reclaim({ confirm: true });
      await refreshUsage();
      setPreview(undefined);
      setStatus(
        result.skipped
          ? "Reclaim was skipped while a render is active."
          : `Reclaimed ${formatBytes(total(result.reclaimed))}.`,
      );
    } catch (reason) {
      setError(message(reason, "Reclaim could not be completed."));
    } finally {
      setReclaiming(false);
    }
  };

  return (
    <div className={`${styles.page} ${styles.singleColumnPage}`}>
      <header>
        <p>Storage lifecycle</p>
        <h2>Retention</h2>
        <span>
          Choose how long managed speech cache, frozen job snapshots, and render
          output stay on this device. Pinned renders are never reclaimed.
        </span>
      </header>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <p className={styles.status} aria-live="polite">
        {status}
      </p>

      <section
        className={styles.pacing}
        aria-labelledby="retention-policy-heading"
      >
        <div>
          <p>Saved policy</p>
          <h3 id="retention-policy-heading">Storage controls</h3>
        </div>
        {settings ? (
          <div className={styles.connectionForm}>
            <label>
              Speech cache retention
              <select
                value={settings.speechCacheTtl}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    speechCacheTtl: event.target
                      .value as RetentionSettings["speechCacheTtl"],
                  })
                }
              >
                {ttlOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Job snapshot retention
              <select
                value={settings.jobSnapshotTtl}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    jobSnapshotTtl: event.target
                      .value as RetentionSettings["jobSnapshotTtl"],
                  })
                }
              >
                {ttlOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Render artifact retention
              <select
                value={settings.renderArtifactTtl}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    renderArtifactTtl: event.target
                      .value as RetentionSettings["renderArtifactTtl"],
                  })
                }
              >
                {ttlOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Speech cache cap (GiB)
              <input
                type="number"
                min="0.001"
                step="0.1"
                value={capGiB}
                onChange={(event) => setCapGiB(event.target.value)}
              />
            </label>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save retention settings"}
              </button>
            </div>
          </div>
        ) : (
          <p>Loading saved retention settings…</p>
        )}
      </section>

      <section
        className={styles.cache}
        aria-labelledby="retention-usage-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p>Managed storage</p>
            <h3 id="retention-usage-heading">Current usage</h3>
          </div>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void refreshUsage()}
          >
            Refresh usage
          </button>
        </div>
        {usage ? (
          <div className={styles.cacheGrid}>
            <article>
              <span>Speech cache segments</span>
              <strong>
                {usage.speechCache.entries.toLocaleString()} entries
              </strong>
              <code>{formatBytes(usage.speechCache.bytes)}</code>
            </article>
            <article>
              <span>Job snapshots</span>
              <strong>
                {usage.jobSnapshots.entries.toLocaleString()} jobs
              </strong>
              <code>{formatBytes(usage.jobSnapshots.bytes)}</code>
            </article>
            <article>
              <span>Render artifacts</span>
              <strong>
                {usage.renderArtifacts.entries.toLocaleString()} renders
              </strong>
              <code>{formatBytes(usage.renderArtifacts.bytes)}</code>
            </article>
          </div>
        ) : (
          <p>Loading managed storage usage…</p>
        )}
        <p>
          Reclaim always shows a preview first. It only visits managed roots,
          and it skips active or pinned render data.
        </p>
        <button
          type="button"
          className={styles.danger}
          disabled={reclaiming}
          onClick={() => void showPreview()}
        >
          {reclaiming ? "Preparing preview…" : "Preview reclaim"}
        </button>
      </section>

      {preview ? (
        <section
          className={styles.cache}
          role="dialog"
          aria-labelledby="reclaim-heading"
        >
          <div>
            <p>Non-destructive preview</p>
            <h3 id="reclaim-heading">Confirm reclaim</h3>
          </div>
          {preview.skipped ? (
            <p>A render is active, so no managed data can be reclaimed now.</p>
          ) : (
            <p>
              Reclaim {formatBytes(total(preview.reclaimable))} from{" "}
              {preview.reclaimable.speechCache.entries.toLocaleString()} cache
              entries,{" "}
              {preview.reclaimable.jobSnapshots.entries.toLocaleString()} job
              snapshots, and{" "}
              {preview.reclaimable.renderArtifacts.entries.toLocaleString()}{" "}
              render artifact directories.
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={reclaiming}
              onClick={() => setPreview(undefined)}
            >
              Cancel reclaim
            </button>
            <button
              type="button"
              className={styles.danger}
              disabled={preview.skipped || reclaiming}
              onClick={() => void confirmReclaim()}
            >
              {reclaiming ? "Reclaiming…" : "Confirm reclaim"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
