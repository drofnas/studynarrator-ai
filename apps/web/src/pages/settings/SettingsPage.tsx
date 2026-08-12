import { useEffect, useState } from "react";
import { parsePauseDuration } from "@studynarrator/core";
import type { PersistenceClient, SystemPacingDefaults } from "@studynarrator/shared-types";
import styles from "./SettingsPage.module.css";

export function SettingsPage({ client }: { client: PersistenceClient }) {
  const [pacing, setPacing] = useState<SystemPacingDefaults>({ enabled: true, durationMs: 750 });
  const [duration, setDuration] = useState("750 ms");
  const [status, setStatus] = useState("Loading pacing defaults…");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void client.settings.getPacing().then((loaded) => {
      if (!active) return;
      setPacing(loaded);
      setDuration(`${String(loaded.durationMs)} ms`);
      setStatus("These values are copied into each new project.");
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Settings could not be loaded."); });
    return () => { active = false; };
  }, [client]);

  const save = async () => {
    const parsed = parsePauseDuration(duration);
    if (!parsed.ok) { setError(parsed.message); return; }
    try {
      const saved = await client.settings.updatePacing({ enabled: pacing.enabled, durationMs: parsed.durationMs });
      setPacing(saved);
      setDuration(`${String(saved.durationMs)} ms`);
      setError("");
      setStatus("Pacing defaults saved. Existing projects were not changed.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Settings could not be saved."); }
  };

  return (
    <div className={styles.page}>
      <header><p>G05 · Installation defaults</p><h2>Settings</h2><span>Control how projectless analysis and newly created projects handle paragraph pacing.</span></header>
      <section>
        <div><p>Pacing defaults</p><h3>New-project paragraph pause</h3></div>
        <label className={styles.check}><input type="checkbox" checked={pacing.enabled} onChange={(event) => setPacing({ ...pacing, enabled: event.target.checked })} />Pause at paragraph breaks</label>
        <label>Default <code>pause_medium</code> duration<input value={duration} aria-invalid={Boolean(error)} onChange={(event) => { setDuration(event.target.value); setError(""); }} /></label>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button type="button" onClick={() => void save()}>Save pacing defaults</button>
        <p className={styles.status} aria-live="polite">{status}</p>
      </section>
      <aside><strong>Offline by design</strong><p>These settings use local persistence only. Connection profiles and live voice checks arrive in G06.</p></aside>
    </div>
  );
}
