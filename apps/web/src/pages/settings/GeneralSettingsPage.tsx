import { useEffect, useMemo, useState } from "react";
import {
  type SpeachesConnection,
  type SpeechCacheClient,
  type SpeechCacheStatus,
  type VoiceCatalog
} from "@studynarrator/shared-types";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { VoiceSelect } from "@/features/connections/VoiceSelect.js";
import { presentVoices } from "@/features/connections/voicePresentation.js";
import styles from "./SettingsPage.module.css";

const EMPTY_CONNECTION = { baseUrl: "", defaultModelId: "", defaultVoiceId: "", timeoutSeconds: 120, retryCount: 2 };

function connectionDraft(connection: SpeachesConnection | null) {
  return connection ? {
    baseUrl: connection.baseUrl ?? "",
    defaultModelId: connection.defaultModelId ?? "",
    defaultVoiceId: connection.defaultVoiceId ?? "",
    timeoutSeconds: connection.timeoutSeconds,
    retryCount: connection.retryCount
  } : { ...EMPTY_CONNECTION };
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value.toLocaleString()} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

export function GeneralSettingsPage({ cacheClient }: { cacheClient: SpeechCacheClient }) {
  const workspace = useConnections();
  const [draft, setDraft] = useState(EMPTY_CONNECTION);
  const [connectionTestAttempted, setConnectionTestAttempted] = useState(false);
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [cacheStatus, setCacheStatus] = useState<SpeechCacheStatus | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const refreshCache = async () => {
    try { setCacheStatus(await cacheClient.status()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Speech cache status could not be loaded."); }
  };

  useEffect(() => { void refreshCache(); }, [cacheClient]);

  useEffect(() => {
    setDraft(connectionDraft(workspace.connection));
  }, [workspace.connection]);

  useEffect(() => {
    if (!workspace.connection?.baseUrl || workspace.catalog.status !== "idle") return;
    void workspace.discover({
      baseUrl: workspace.connection.baseUrl,
      timeoutSeconds: workspace.connection.timeoutSeconds,
      retryCount: workspace.connection.retryCount
    }).catch(() => undefined);
  }, [workspace]);

  useEffect(() => {
    if (!draft.defaultModelId) { setCatalog(null); return; }
    let active = true;
    void workspace.getCatalog(draft.defaultModelId).then((next) => { if (active) setCatalog(next); }).catch(() => { if (active) setCatalog(null); });
    return () => { active = false; };
  }, [draft.defaultModelId, workspace]);

  const speechModels = workspace.catalog.status === "ready" ? workspace.catalog.catalog.models : [];
  const selectedSpeechModel = speechModels.find(({ modelId }) => modelId === draft.defaultModelId);
  const presentedVoices = useMemo(() => presentVoices(selectedSpeechModel?.voices ?? [], catalog?.entries ?? []), [catalog, selectedSpeechModel]);
  const defaultVoiceOptions = useMemo(() => presentedVoices.filter(({ availableOnServer }) => availableOnServer), [presentedVoices]);
  const connectionSummary = workspace.connection?.lastTestSummary;
  const showConnectionDiagnostics = Boolean(
    connectionSummary
    && connectionSummary.overall !== "connected"
    && (workspace.connection?.configured || connectionTestAttempted)
  );

  const refreshSpeechCatalog = async () => {
    setError("");
    try {
      const discovered = await workspace.discover({ baseUrl: draft.baseUrl, timeoutSeconds: draft.timeoutSeconds, retryCount: draft.retryCount });
      const model = discovered.models.find(({ modelId }) => modelId === draft.defaultModelId) ?? discovered.models[0];
      if (!model) throw new Error("This Speaches server did not report any speech models.");
      const voice = model.voices.find(({ voiceId }) => voiceId === draft.defaultVoiceId) ?? model.voices[0];
      if (!voice) throw new Error(`Model ${model.modelId} did not report any voices.`);
      setDraft((current) => ({ ...current, defaultModelId: model.modelId, defaultVoiceId: voice.voiceId }));
      setStatus(`Loaded ${String(discovered.models.length)} speech ${discovered.models.length === 1 ? "model" : "models"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The speech catalog could not be loaded.");
    }
  };

  const saveConnection = async () => {
    setConnectionTestAttempted(true);
    setError("");
    try {
      await workspace.update({ baseUrl: draft.baseUrl || null, defaultModelId: draft.defaultModelId || null, defaultVoiceId: draft.defaultVoiceId || null, timeoutSeconds: draft.timeoutSeconds, retryCount: draft.retryCount, responseFormat: "wav" });
      const result = await workspace.test();
      setStatus(`Connection test: ${result.overall}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The Speaches connection could not be saved and tested."); }
  };

  const exportDiagnostics = async () => {
    try {
      const exported = await workspace.exportDiagnostics();
      const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "studynarrator-connection-diagnostics.json"; anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Diagnostics could not be exported."); }
  };

  const clearAllCache = async () => {
    if (!window.confirm("Clear every cached speech preview? Future previews will contact Speaches again. This does not change projects or render history.")) return;
    setCacheBusy(true);
    try {
      const removed = await cacheClient.clearAll();
      setStatus(`Cleared ${String(removed.entriesRemoved)} cached speech ${removed.entriesRemoved === 1 ? "entry" : "entries"} and freed ${formatBytes(removed.bytesFreed)}.`);
      await refreshCache();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The speech cache could not be cleared."); }
    finally { setCacheBusy(false); }
  };

  return (
    <div className={`${styles.page} ${styles.singleColumnPage}`}>
      <header><p>Connection + storage</p><h2>General</h2><span>Manage the Speaches server, connection diagnostics, and disposable preview audio.</span></header>
      {error || workspace.error ? <p className={styles.error} role="alert">{error || workspace.error}</p> : null}
      {status ? <p className={styles.status} aria-live="polite">{status}</p> : null}

      <section className={styles.connections}>
        <div className={styles.sectionHeading}><div><p>Speaches server</p><h3>Connection workshop</h3></div><button type="button" className={styles.secondary} disabled={!draft.baseUrl || workspace.catalog.status === "loading"} onClick={() => void refreshSpeechCatalog()}>{workspace.catalog.status === "loading" ? "Loading…" : "Refresh catalog"}</button></div>
        <div className={styles.connectionForm}>
          <label>Address<input type="url" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value, defaultModelId: "", defaultVoiceId: "" })} placeholder="http://127.0.0.1:8000" /></label>
          <label>Model<select value={draft.defaultModelId} disabled={speechModels.length === 0} onChange={(event) => { const modelId = event.target.value; setDraft({ ...draft, defaultModelId: modelId, defaultVoiceId: speechModels.find((model) => model.modelId === modelId)?.voices[0]?.voiceId ?? "" }); }}><option value="">Load catalog to choose</option>{speechModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.modelId}</option>)}</select></label>
          <label>Default Voice<VoiceSelect value={draft.defaultVoiceId} voices={defaultVoiceOptions} disabled={!selectedSpeechModel} emptyOption="Choose a voice" onChange={(defaultVoiceId) => setDraft({ ...draft, defaultVoiceId })} /></label>
          <div className={styles.inline}><label>Timeout (seconds)<input type="number" min="1" max="600" value={draft.timeoutSeconds} onChange={(event) => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })} /></label><label>Retries<input type="number" min="0" max="5" value={draft.retryCount} onChange={(event) => setDraft({ ...draft, retryCount: Number(event.target.value) })} /></label></div>
          <div className={styles.actions}><button type="button" disabled={workspace.testing || !draft.baseUrl || !draft.defaultModelId || !draft.defaultVoiceId} onClick={() => void saveConnection()}>{workspace.testing ? "Testing…" : "Save and Test"}</button></div>
        </div>
        {showConnectionDiagnostics && connectionSummary ? <div className={styles.diagnostics}><div className={styles.diagnosticHeader}><div><p>Signal path</p><h4>{connectionSummary.overall}</h4></div><button type="button" className={styles.secondary} onClick={() => void exportDiagnostics()}>Export redacted JSON</button></div><ol>{connectionSummary.stages.map((item, index) => <li data-status={item.status} key={item.stage}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{item.stage}</strong><code>{item.code} · {item.durationMs} ms</code><span>{item.message}</span></div></li>)}</ol></div> : null}
      </section>

      <section className={styles.cache}>
        <div className={styles.sectionHeading}><div><p>Disposable preview audio</p><h3>Speech cache</h3></div><button type="button" className={styles.secondary} onClick={() => void refreshCache()}>Refresh</button></div>
        {cacheStatus ? <>
          <div className={styles.cacheGrid}><article><span>Stored</span><strong>{cacheStatus.entryCount.toLocaleString()} entries</strong><code>{formatBytes(cacheStatus.totalBytes)}</code></article><article><span>This session</span><strong>{cacheStatus.sessionHits.toLocaleString()} hits · {cacheStatus.sessionMisses.toLocaleString()} misses</strong><code>{cacheStatus.sessionWrites.toLocaleString()} writes · {cacheStatus.sessionCorruptMisses.toLocaleString()} corrupt misses</code></article><article><span>Activity</span><strong>{cacheStatus.inFlight.toLocaleString()} in flight</strong><code>{cacheStatus.lastUsedAt ? `Last used ${new Date(cacheStatus.lastUsedAt).toLocaleString()}` : "Not used yet"}</code></article></div>
          <p>Cached WAV files are disposable and never create render history. Clear them here when you want every future preview to contact Speaches again.</p>
        </> : <p>Loading cache statistics…</p>}
        <button type="button" className={styles.danger} disabled={cacheBusy || cacheStatus?.entryCount === 0} onClick={() => void clearAllCache()}>{cacheBusy ? "Clearing…" : "Clear all cached speech"}</button>
      </section>
    </div>
  );
}
