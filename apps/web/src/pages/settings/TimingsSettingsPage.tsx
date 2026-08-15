import { useEffect, useState } from "react";
import { parsePauseDuration, SUPPORTED_PAUSE_IDS, type SupportedPauseId } from "@studynarrator/core";
import {
  DEFAULT_SYSTEM_TIMING,
  type PersistenceClient,
  type SystemTimingConfiguration,
  type SystemTransitionPauseSetting
} from "@studynarrator/shared-types";
import styles from "./SettingsPage.module.css";

function nearestNamedTransition(setting: SystemTransitionPauseSetting, timing: SystemTimingConfiguration): SystemTransitionPauseSetting {
  if (setting.mode !== "duration") return setting;
  const nearest = timing.pausePresets.reduce((closest, candidate) =>
    Math.abs(candidate.durationMs - setting.durationMs) < Math.abs(closest.durationMs - setting.durationMs) ? candidate : closest
  );
  return { mode: "preset", pauseId: nearest.pauseId };
}

function timingWithNamedTransitions(timing: SystemTimingConfiguration): SystemTimingConfiguration {
  return {
    ...timing,
    transitionPauses: {
      paragraph: nearestNamedTransition(timing.transitionPauses.paragraph, timing),
      speakerChange: nearestNamedTransition(timing.transitionPauses.speakerChange, timing),
      section: nearestNamedTransition(timing.transitionPauses.section, timing)
    }
  };
}

function TimingTransitionEditor({ label, setting, onSettingChange }: {
  label: string;
  setting: SystemTransitionPauseSetting;
  onSettingChange: (setting: SystemTransitionPauseSetting) => void;
}) {
  return <fieldset className={styles.transitionField}>
    <legend>{label}</legend>
    <label>Pause<select value={setting.mode === "preset" ? setting.pauseId : "none"} onChange={(event) => {
      const pauseId = event.target.value;
      onSettingChange(pauseId === "none" ? { mode: "none" } : { mode: "preset", pauseId: pauseId as SupportedPauseId });
    }}><option value="none">None</option>{SUPPORTED_PAUSE_IDS.map((pauseId) => <option key={pauseId} value={pauseId}>{pauseId}</option>)}</select></label>
  </fieldset>;
}

export function TimingsSettingsPage({ client }: { client: PersistenceClient }) {
  const [timing, setTiming] = useState<SystemTimingConfiguration>(DEFAULT_SYSTEM_TIMING);
  const [pauseInputs, setPauseInputs] = useState<Record<string, string>>(() => Object.fromEntries(DEFAULT_SYSTEM_TIMING.pausePresets.map((preset) => [preset.pauseId, `${String(preset.durationMs)} ms`])));
  const [status, setStatus] = useState("Loading timing settings…");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void client.settings.getPacing().then((loaded) => {
      if (!active) return;
      setTiming(timingWithNamedTransitions(loaded));
      setPauseInputs(Object.fromEntries(loaded.pausePresets.map((preset) => [preset.pauseId, `${String(preset.durationMs)} ms`])));
      setStatus("Timing settings apply to every editable project.");
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Settings could not be loaded."); });
    return () => { active = false; };
  }, [client]);

  const saveTiming = async () => {
    const parsedPresets = timing.pausePresets.map((preset) => ({ preset, parsed: parsePauseDuration(pauseInputs[preset.pauseId] ?? "") }));
    const invalidPreset = parsedPresets.find(({ parsed }) => !parsed.ok);
    if (invalidPreset && !invalidPreset.parsed.ok) { setError(`${invalidPreset.preset.pauseId}: ${invalidPreset.parsed.message}`); return; }
    try {
      const saved = await client.settings.updatePacing({
        pausePresets: parsedPresets.map(({ preset, parsed }) => ({ ...preset, durationMs: parsed.ok ? parsed.durationMs : preset.durationMs })) as SystemTimingConfiguration["pausePresets"],
        transitionPauses: timing.transitionPauses
      });
      setTiming(timingWithNamedTransitions(saved));
      setPauseInputs(Object.fromEntries(saved.pausePresets.map((preset) => [preset.pauseId, `${String(preset.durationMs)} ms`])));
      setError("");
      setStatus("Global timing saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Settings could not be saved."); }
  };

  return (
    <div className={`${styles.page} ${styles.singleColumnPage}`}>
      <header><p>Shared render rhythm</p><h2>Timings</h2><span>Set the pause presets and transitions used by editable projects and future render plans.</span></header>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <p className={styles.status} aria-live="polite">{status}</p>

      <section className={styles.pacing} aria-labelledby="timing-heading">
        <div><p>Shared render rhythm</p><h3 id="timing-heading">Global timing</h3></div>
        <p>Saved changes affect every project and newly frozen render plan. Existing frozen plans keep their captured timing.</p>
        <div className={styles.pauseTableScroll}><table className={styles.pauseTable}><thead><tr><th scope="col">Directive</th><th scope="col">Duration</th><th scope="col">Description</th></tr></thead><tbody>{timing.pausePresets.map((preset, index) => <tr key={preset.pauseId}><th scope="row"><code>{preset.pauseId}</code></th><td><label><span className={styles.srOnly}>{preset.pauseId} duration</span><input value={pauseInputs[preset.pauseId] ?? ""} onChange={(event) => { setPauseInputs((current) => ({ ...current, [preset.pauseId]: event.target.value })); setError(""); }} /></label></td><td><label><span className={styles.srOnly}>{preset.pauseId} description</span><input value={preset.description} onChange={(event) => setTiming((current) => ({ ...current, pausePresets: current.pausePresets.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) as SystemTimingConfiguration["pausePresets"] }))} /></label></td></tr>)}</tbody></table></div>
        <div className={styles.transitionGrid}>{(["paragraph", "speakerChange", "section"] as const).map((key) => <TimingTransitionEditor key={key} label={key === "speakerChange" ? "Speaker change" : key[0]!.toUpperCase() + key.slice(1)} setting={timing.transitionPauses[key]} onSettingChange={(setting) => setTiming((current) => ({ ...current, transitionPauses: { ...current.transitionPauses, [key]: setting } }))} />)}</div>
        <button type="button" onClick={() => void saveTiming()}>Save timing</button>
      </section>
    </div>
  );
}
