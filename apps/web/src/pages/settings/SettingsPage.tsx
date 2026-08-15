import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parsePauseDuration, type LexiconEntryAuthoring } from "@studynarrator/core";
import {
  type SpeachesConnection,
  type ScratchpadClient,
  type PersistenceClient,
  type SpeechCacheClient,
  type SpeechCacheStatus,
  DEFAULT_SYSTEM_TIMING,
  type SystemTimingConfiguration,
  type SystemTransitionPauseSetting,
  type VoiceCatalog
} from "@studynarrator/shared-types";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { VoiceSelect } from "@/features/connections/VoiceSelect.js";
import { filterPresentedVoices, groupPresentedVoices, presentVoices, type PresentedVoice } from "@/features/connections/voicePresentation.js";
import { LexiconEditor, type LexiconEditorChange, type LexiconEditorValue } from "@/features/lexicon/LexiconEditor.js";
import { authoringLexicon } from "@/features/projects/projectAuthoring.js";
import styles from "./SettingsPage.module.css";

const EMPTY_CONNECTION = { baseUrl: "", defaultModelId: "", defaultVoiceId: "", timeoutSeconds: 120, retryCount: 2 };
type SimplifiedGlobalEntry = {
  id?: string;
  scope: "global";
  entryType: "exactTerm";
  displayText: string;
  spokenText: string;
  caseSensitive: false;
  wholeWord: true;
  priority: 0;
  enabled: boolean;
  notes: "";
};

const VOICE_TEST_SCRIPT = "This short sample lets you hear how this voice handles clear narration.";

type AuditionState = { voiceId: string; phase: "processing" | "playing" } | null;
type LexiconRowState = "saving" | "saved" | "error";
type TransitionKey = keyof SystemTimingConfiguration["transitionPauses"];

function TimingTransitionEditor({ label, setting, duration, onSettingChange, onDurationChange }: {
  label: string;
  setting: SystemTransitionPauseSetting;
  duration: string;
  onSettingChange: (setting: SystemTransitionPauseSetting) => void;
  onDurationChange: (value: string) => void;
}) {
  return <fieldset className={styles.transitionField}>
    <legend>{label}</legend>
    <label>Behavior<select value={setting.mode} onChange={(event) => {
      const mode = event.target.value;
      onSettingChange(mode === "none" ? { mode } : mode === "preset" ? { mode, pauseId: "pause_medium" } : { mode: "duration", durationMs: 750 });
    }}><option value="none">None</option><option value="preset">Named preset</option><option value="duration">Direct duration</option></select></label>
    {setting.mode === "preset" ? <label>Preset<select value={setting.pauseId} onChange={(event) => onSettingChange({ mode: "preset", pauseId: event.target.value as "pause_short" | "pause_medium" | "pause_long" })}><option value="pause_short">pause_short</option><option value="pause_medium">pause_medium</option><option value="pause_long">pause_long</option></select></label> : null}
    {setting.mode === "duration" ? <label>Duration<input value={duration} onChange={(event) => onDurationChange(event.target.value)} /></label> : null}
  </fieldset>;
}

function fixedGlobalEntry(entry: LexiconEntryAuthoring): SimplifiedGlobalEntry {
  return {
    ...(entry.id ? { id: entry.id } : {}),
    scope: "global",
    entryType: "exactTerm",
    displayText: entry.displayText,
    spokenText: entry.spokenText,
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: entry.enabled ?? true,
    notes: ""
  };
}

function decodedAudio(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

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

export function SettingsPage({ client, cacheClient, scratchpadClient }: { client: PersistenceClient; cacheClient: SpeechCacheClient; scratchpadClient: ScratchpadClient }) {
  const workspace = useConnections();
  const [timing, setTiming] = useState<SystemTimingConfiguration>(DEFAULT_SYSTEM_TIMING);
  const [pauseInputs, setPauseInputs] = useState<Record<string, string>>(() => Object.fromEntries(DEFAULT_SYSTEM_TIMING.pausePresets.map((preset) => [preset.pauseId, `${String(preset.durationMs)} ms`])));
  const [transitionInputs, setTransitionInputs] = useState<Record<TransitionKey, string>>({ paragraph: "750 ms", speakerChange: "750 ms", section: "750 ms" });
  const [status, setStatus] = useState("Loading settings…");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(EMPTY_CONNECTION);
  const [connectionTestAttempted, setConnectionTestAttempted] = useState(false);
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [voiceTestScript, setVoiceTestScript] = useState(VOICE_TEST_SCRIPT);
  const [audition, setAudition] = useState<AuditionState>(null);
  const [auditionError, setAuditionError] = useState("");
  const [favoriteSaving, setFavoriteSaving] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const [cacheStatus, setCacheStatus] = useState<SpeechCacheStatus | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [globalLexicon, setGlobalLexicon] = useState<SimplifiedGlobalEntry[]>([]);
  const [lexiconRowState, setLexiconRowState] = useState<Record<string, LexiconRowState>>({});
  const globalLexiconRef = useRef(globalLexicon);
  const lexiconRevisionRef = useRef(0);
  const lexiconQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lexiconTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingLexiconRowsRef = useRef(new Set<string>());
  const auditionAbortRef = useRef<AbortController | undefined>(undefined);
  const auditionContextRef = useRef<AudioContext | undefined>(undefined);
  const auditionSourceRef = useRef<AudioBufferSourceNode | undefined>(undefined);
  const auditionGenerationRef = useRef(0);

  const refreshCache = async () => {
    try { setCacheStatus(await cacheClient.status()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Speech cache status could not be loaded."); }
  };

  useEffect(() => {
    let active = true;
    void client.settings.getPacing().then((loaded) => {
      if (!active) return;
      setTiming(loaded);
      setPauseInputs(Object.fromEntries(loaded.pausePresets.map((preset) => [preset.pauseId, `${String(preset.durationMs)} ms`])));
      setTransitionInputs(Object.fromEntries(Object.entries(loaded.transitionPauses).map(([key, setting]) => [key, setting.mode === "duration" ? `${String(setting.durationMs)} ms` : "750 ms"])) as Record<TransitionKey, string>);
      setStatus("Timing settings apply to every editable project.");
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Settings could not be loaded."); });
    return () => { active = false; };
  }, [client]);

  useEffect(() => { void refreshCache(); }, [cacheClient]);

  useEffect(() => {
    let active = true;
    void client.globalLexicon.list().then((entries) => {
      if (!active) return;
      const loaded = authoringLexicon(entries).map(fixedGlobalEntry);
      globalLexiconRef.current = loaded;
      setGlobalLexicon(loaded);
    })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "The global lexicon could not be loaded."); });
    return () => { active = false; };
  }, [client]);

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

  const stopAudition = useCallback((resetState = true) => {
    auditionGenerationRef.current += 1;
    auditionAbortRef.current?.abort();
    auditionAbortRef.current = undefined;
    if (auditionSourceRef.current) {
      auditionSourceRef.current.onended = null;
      try { auditionSourceRef.current.stop(); } catch { /* The source may not have started yet. */ }
      auditionSourceRef.current.disconnect();
      auditionSourceRef.current = undefined;
    }
    if (auditionContextRef.current) {
      void auditionContextRef.current.close().catch(() => undefined);
      auditionContextRef.current = undefined;
    }
    if (resetState) setAudition(null);
  }, []);

  useEffect(() => () => {
    stopAudition(false);
    if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
  }, [stopAudition]);

  const saveTiming = async () => {
    const parsedPresets = timing.pausePresets.map((preset) => ({ preset, parsed: parsePauseDuration(pauseInputs[preset.pauseId] ?? "") }));
    const invalidPreset = parsedPresets.find(({ parsed }) => !parsed.ok);
    if (invalidPreset && !invalidPreset.parsed.ok) { setError(`${invalidPreset.preset.pauseId}: ${invalidPreset.parsed.message}`); return; }
    const transitions = { ...timing.transitionPauses };
    for (const key of Object.keys(transitions) as TransitionKey[]) {
      const setting = transitions[key];
      if (setting.mode !== "duration") continue;
      const parsed = parsePauseDuration(transitionInputs[key]);
      if (!parsed.ok) { setError(`${key}: ${parsed.message}`); return; }
      transitions[key] = { mode: "duration", durationMs: parsed.durationMs };
    }
    try {
      const saved = await client.settings.updatePacing({
        pausePresets: parsedPresets.map(({ preset, parsed }) => ({ ...preset, durationMs: parsed.ok ? parsed.durationMs : preset.durationMs })) as SystemTimingConfiguration["pausePresets"],
        transitionPauses: transitions
      });
      setTiming(saved);
      setPauseInputs(Object.fromEntries(saved.pausePresets.map((preset) => [preset.pauseId, `${String(preset.durationMs)} ms`])));
      setError("");
      setStatus("Global timing saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Settings could not be saved."); }
  };

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

  const auditionVoice = async (voiceId: string) => {
    stopAudition();
    setAuditionError("");
    const generation = auditionGenerationRef.current;
    const controller = new AbortController();
    auditionAbortRef.current = controller;
    let context: AudioContext;
    try {
      context = new AudioContext();
      auditionContextRef.current = context;
      await context.resume();
      if (controller.signal.aborted || generation !== auditionGenerationRef.current) return;
      setAudition({ voiceId, phase: "processing" });
      const result = await scratchpadClient.preview({
        modelId: draft.defaultModelId,
        voiceId,
        speed: 1,
        text: voiceTestScript.trim(),
        applyGlobalLexicon: false
      }, controller.signal);
      if (controller.signal.aborted || generation !== auditionGenerationRef.current) return;
      const buffer = await context.decodeAudioData(decodedAudio(result.audio.base64));
      if (controller.signal.aborted || generation !== auditionGenerationRef.current) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      auditionSourceRef.current = source;
      source.onended = () => {
        if (generation !== auditionGenerationRef.current) return;
        auditionSourceRef.current = undefined;
        auditionContextRef.current = undefined;
        auditionAbortRef.current = undefined;
        setAudition(null);
        void context.close().catch(() => undefined);
      };
      setAudition({ voiceId, phase: "playing" });
      source.start();
    } catch (reason) {
      if (controller.signal.aborted || generation !== auditionGenerationRef.current) return;
      stopAudition();
      setAuditionError(reason instanceof Error ? reason.message : "This voice sample could not be played. Check the connection and try again.");
    }
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

  const persistGlobalLexicon = useCallback((entries: SimplifiedGlobalEntry[], affectedIds: string[], success?: string) => {
    const snapshot = entries.map(fixedGlobalEntry);
    const blankEntry = snapshot.find((entry) => !entry.displayText.trim() || !entry.spokenText.trim());
    const seenTerms = new Set<string>();
    const duplicateEntry = snapshot.find((entry) => {
      if (!entry.enabled) return false;
      const key = entry.displayText.trim().toLocaleLowerCase("en-US");
      if (!key || !seenTerms.has(key)) { seenTerms.add(key); return false; }
      return true;
    });
    if (blankEntry || duplicateEntry) {
      const invalidId = blankEntry?.id ?? duplicateEntry?.id;
      const ids = invalidId ? [invalidId] : affectedIds;
      setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, "error" as const])) }));
      setError(blankEntry ? "Script Text and Spoken Text are required." : "Script Text must be unique regardless of capitalization.");
      return Promise.resolve(false);
    }
    const revision = lexiconRevisionRef.current;
    setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(affectedIds.map((id) => [id, "saving" as const])) }));
    const task = lexiconQueueRef.current.then(async () => {
      try {
        const saved = authoringLexicon(await client.globalLexicon.replace(snapshot)).map(fixedGlobalEntry);
        if (revision === lexiconRevisionRef.current) {
          globalLexiconRef.current = saved;
          setGlobalLexicon(saved);
          setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(affectedIds.map((id) => [id, "saved" as const])) }));
          if (success) setStatus(success);
          setError("");
        }
        return true;
      } catch (reason) {
        if (revision === lexiconRevisionRef.current) {
          setLexiconRowState((current) => ({ ...current, ...Object.fromEntries(affectedIds.map((id) => [id, "error" as const])) }));
          setError(reason instanceof Error ? reason.message : "The global lexicon could not be saved. Your edits are still here; try again.");
        }
        return false;
      }
    });
    lexiconQueueRef.current = task.then(() => undefined, () => undefined);
    return task;
  }, [client]);

  const flushGlobalLexicon = useCallback(() => {
    if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
    lexiconTimerRef.current = undefined;
    const affectedIds = [...pendingLexiconRowsRef.current];
    pendingLexiconRowsRef.current.clear();
    if (affectedIds.length === 0) return;
    void persistGlobalLexicon(globalLexiconRef.current, affectedIds, "Global pronunciation saved.");
  }, [persistGlobalLexicon]);

  const changeGlobalLexicon = (value: LexiconEditorValue[], change: LexiconEditorChange) => {
    const next = value.map((entry) => fixedGlobalEntry({ ...entry, scope: "global", entryType: "exactTerm", caseSensitive: false, wholeWord: true, priority: 0, notes: "" }));
    if (change.kind === "add" || change.kind === "delete") {
      flushGlobalLexicon();
      lexiconRevisionRef.current += 1;
      return persistGlobalLexicon(next, [change.id], change.kind === "add" ? "Global pronunciation added." : "Global pronunciation deleted.");
    }
    if (change.kind === "commit") {
      pendingLexiconRowsRef.current.add(change.id);
      flushGlobalLexicon();
      return;
    }
    lexiconRevisionRef.current += 1;
    globalLexiconRef.current = next;
    setGlobalLexicon(next);
    pendingLexiconRowsRef.current.add(change.id);
    setLexiconRowState((current) => ({ ...current, [change.id]: "saving" }));
    if (change.kind === "toggle") flushGlobalLexicon();
    else {
      if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
      lexiconTimerRef.current = setTimeout(flushGlobalLexicon, 500);
    }
  };

  const speechModels = workspace.catalog.status === "ready" ? workspace.catalog.catalog.models : [];
  const selectedSpeechModel = speechModels.find(({ modelId }) => modelId === draft.defaultModelId);
  const presentedVoices = useMemo(() => presentVoices(selectedSpeechModel?.voices ?? [], catalog?.entries ?? []), [catalog, selectedSpeechModel]);
  const filteredVoices = useMemo(() => filterPresentedVoices(presentedVoices, catalogSearch), [catalogSearch, presentedVoices]);
  const voiceGroups = useMemo(() => groupPresentedVoices(filteredVoices.slice(0, 100)), [filteredVoices]);
  const defaultVoiceOptions = useMemo(() => presentedVoices.filter(({ availableOnServer }) => availableOnServer), [presentedVoices]);
  const connectionSummary = workspace.connection?.lastTestSummary;
  const showConnectionDiagnostics = Boolean(
    connectionSummary
    && connectionSummary.overall !== "connected"
    && (workspace.connection?.configured || connectionTestAttempted)
  );
  const auditionReady = Boolean(
    workspace.connection?.configured
    && workspace.connection.baseUrl
    && workspace.connection.baseUrl === draft.baseUrl
    && draft.defaultModelId
    && voiceTestScript.trim()
  );

  const toggleVoiceFavorite = async (voice: PresentedVoice) => {
    if (!catalog || favoriteSaving) return;
    const modelId = catalog.modelId;
    const previous = catalog;
    const nextFavorite = !voice.favorite;
    const includesVoice = catalog.entries.some(({ voiceId }) => voiceId === voice.voiceId);
    const optimistic: VoiceCatalog = {
      ...catalog,
      entries: includesVoice
        ? catalog.entries.map((entry) => entry.voiceId === voice.voiceId ? { ...entry, favorite: nextFavorite } : entry)
        : [...catalog.entries, { ...voice.catalogEntry, favorite: nextFavorite }]
    };
    setFavoriteSaving(voice.voiceId);
    setFavoriteError("");
    setCatalog(optimistic);
    try {
      const saved = await workspace.replaceCatalog(optimistic);
      setCatalog((current) => current?.modelId === modelId ? saved : current);
    } catch (reason) {
      setCatalog((current) => current?.modelId === modelId ? previous : current);
      setFavoriteError(reason instanceof Error ? reason.message : "This favorite could not be saved. Try the heart again.");
    } finally { setFavoriteSaving(""); }
  };

  return (
    <div className={styles.page}>
      <header><p>Installation + connection</p><h2>Settings</h2><span>Manage the Speaches server, local authoring defaults, staged diagnostics, and the voice catalog.</span></header>
      {error || workspace.error ? <p className={styles.error} role="alert">{error || workspace.error}</p> : null}
      <p className={styles.status} aria-live="polite">{status}</p>

      <section className={styles.connections}>
        <div className={styles.sectionHeading}><div><p>Speaches server</p><h3>Connection workshop</h3></div><button type="button" className={styles.secondary} disabled={!draft.baseUrl || workspace.catalog.status === "loading"} onClick={() => void refreshSpeechCatalog()}>{workspace.catalog.status === "loading" ? "Loading…" : "Refresh catalog"}</button></div>
        <div className={styles.profileForm}>
          <label>Address<input type="url" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value, defaultModelId: "", defaultVoiceId: "" })} placeholder="http://127.0.0.1:8000" /></label>
          <label>Model<select value={draft.defaultModelId} disabled={speechModels.length === 0} onChange={(event) => { const modelId = event.target.value; setDraft({ ...draft, defaultModelId: modelId, defaultVoiceId: speechModels.find((model) => model.modelId === modelId)?.voices[0]?.voiceId ?? "" }); }}><option value="">Load catalog to choose</option>{speechModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.modelId}</option>)}</select></label>
          <label>Default Voice<VoiceSelect value={draft.defaultVoiceId} voices={defaultVoiceOptions} disabled={!selectedSpeechModel} emptyOption="Choose a voice" onChange={(defaultVoiceId) => setDraft({ ...draft, defaultVoiceId })} /></label>
          <div className={styles.inline}><label>Timeout (seconds)<input type="number" min="1" max="600" value={draft.timeoutSeconds} onChange={(event) => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })} /></label><label>Retries<input type="number" min="0" max="5" value={draft.retryCount} onChange={(event) => setDraft({ ...draft, retryCount: Number(event.target.value) })} /></label></div>
          <div className={styles.actions}><button type="button" disabled={workspace.testing || !draft.baseUrl || !draft.defaultModelId || !draft.defaultVoiceId} onClick={() => void saveConnection()}>{workspace.testing ? "Testing…" : "Save and Test"}</button></div>
        </div>
        {showConnectionDiagnostics && connectionSummary ? <div className={styles.diagnostics}><div className={styles.diagnosticHeader}><div><p>Signal path</p><h4>{connectionSummary.overall}</h4></div><button type="button" className={styles.secondary} onClick={() => void exportDiagnostics()}>Export redacted JSON</button></div><ol>{connectionSummary.stages.map((item, index) => <li data-status={item.status} key={item.stage}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{item.stage}</strong><code>{item.code} · {item.durationMs} ms</code><span>{item.message}</span></div></li>)}</ol></div> : null}
      </section>

      <section className={styles.catalog}>
        <div className={styles.sectionHeading}><div><p>Versioned local catalog</p><h3>Voice browser</h3></div><div className={styles.catalogMeta}>{catalog && catalog.modelId === workspace.connection?.defaultModelId ? <><span className={styles.defaultModelBadge}>Default model</span><code>{catalog.modelId}</code></> : null}<span>{filteredVoices.length} matching voices</span></div></div>
        <label className={styles.voiceTestScript}>Voice test script<textarea rows={3} maxLength={1200} value={voiceTestScript} onChange={(event) => { setVoiceTestScript(event.target.value); setAuditionError(""); }} /></label>
        {auditionError ? <p className={styles.auditionError} role="alert">Voice test failed: {auditionError}</p> : null}
        {favoriteError ? <p className={styles.favoriteError} role="alert">Favorite not saved: {favoriteError}</p> : null}
        <input aria-label="Search voice catalog" placeholder="Search name, ID, language, or locale" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} />
        <div className={styles.voiceList}>{voiceGroups.map((group) => <section className={styles.voiceGroup} data-group={group.key === "favorites" ? "favorites" : "locale"} aria-label={`${group.label} voices`} key={group.key}>
          <div className={styles.voiceGroupRibbon}><strong>{group.label}</strong><span>{group.voices.length}</span></div>
          <div className={styles.voiceGroupEntries}>{group.voices.map((entry) => {
            const phase = audition?.voiceId === entry.voiceId ? audition.phase : "normal";
            const action = phase === "processing" ? "Preparing" : phase === "playing" ? "Playing" : "Test";
            return <article data-enabled={entry.enabled} key={entry.voiceId}>
              <div><strong>{entry.friendlyName}</strong><code>{entry.voiceId} | {entry.localeLabel}</code></div>
              <div className={styles.voiceActions}>
                <button type="button" className={styles.favoriteButton} data-active={entry.favorite} disabled={Boolean(favoriteSaving)} aria-pressed={entry.favorite} aria-label={`${entry.favorite ? "Remove" : "Add"} ${entry.friendlyName} ${entry.favorite ? "from" : "to"} favorites`} onClick={() => void toggleVoiceFavorite(entry)}>
                  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 20.5 4.4 13A5.1 5.1 0 0 1 11.6 5.8L12 6.2l.4-.4A5.1 5.1 0 0 1 19.6 13L12 20.5Z" /></svg>
                </button>
                <button type="button" className={styles.auditionButton} data-state={phase} disabled={!auditionReady} aria-label={`${action} ${entry.friendlyName}`} onClick={() => void auditionVoice(entry.voiceId)}>
                  {phase === "normal" ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5.75v12.5L18 12 8 5.75Z" /></svg> : phase === "processing" ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 1-8.3 5.5" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 9v6M12 6v12M17 9v6" /></svg>}
                </button>
              </div>
            </article>;
          })}</div>
        </section>)}</div>
        <p className={styles.attribution}>Bundled Kokoro identifiers: hexgrad/Kokoro-82M VOICES.md · Apache-2.0. Labels omit subjective quality claims.</p>
      </section>

      <section className={styles.globalLexicon} id="global-lexicon" aria-labelledby="global-lexicon-heading">
        <div className={styles.sectionHeading}><div><p>Shared pronunciation</p><h3 id="global-lexicon-heading">Global lexicon</h3></div><span>{globalLexicon.length} entries</span></div>
        <p>Script Text matches complete words regardless of capitalization. These rules apply to every project and pronunciation preview; project-only rules stay with their project.</p>
        <LexiconEditor
          value={globalLexicon.map(({ id, displayText, spokenText, enabled }) => ({ ...(id ? { id } : {}), displayText, spokenText, enabled }))}
          onChange={changeGlobalLexicon}
          searchLabel="Search global lexicon"
          emptyMessage="No matching global lexicon entries."
          rowErrors={Object.fromEntries(Object.entries(lexiconRowState).filter(([, state]) => state === "error").map(([id]) => [id, "Not saved — edit or blur to retry"]))}
        />
      </section>

      <section className={styles.pacing} aria-labelledby="timing-heading">
        <div><p>Shared render rhythm</p><h3 id="timing-heading">Global timing</h3></div>
        <p>Saved changes affect every project and newly frozen render plan. Existing frozen plans keep their captured timing.</p>
        <div className={styles.pauseTableScroll}><table className={styles.pauseTable}><thead><tr><th scope="col">Directive</th><th scope="col">Duration</th><th scope="col">Description</th></tr></thead><tbody>{timing.pausePresets.map((preset, index) => <tr key={preset.pauseId}><th scope="row"><code>{preset.pauseId}</code></th><td><label><span className={styles.srOnly}>{preset.pauseId} duration</span><input value={pauseInputs[preset.pauseId] ?? ""} onChange={(event) => { setPauseInputs((current) => ({ ...current, [preset.pauseId]: event.target.value })); setError(""); }} /></label></td><td><label><span className={styles.srOnly}>{preset.pauseId} description</span><input value={preset.description} onChange={(event) => setTiming((current) => ({ ...current, pausePresets: current.pausePresets.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) as SystemTimingConfiguration["pausePresets"] }))} /></label></td></tr>)}</tbody></table></div>
        <div className={styles.transitionGrid}>{(["paragraph", "speakerChange", "section"] as const).map((key) => <TimingTransitionEditor key={key} label={key === "speakerChange" ? "Speaker change" : key[0]!.toUpperCase() + key.slice(1)} setting={timing.transitionPauses[key]} duration={transitionInputs[key]} onDurationChange={(value) => { setTransitionInputs((current) => ({ ...current, [key]: value })); setError(""); }} onSettingChange={(setting) => setTiming((current) => ({ ...current, transitionPauses: { ...current.transitionPauses, [key]: setting } }))} />)}</div>
        <button type="button" onClick={() => void saveTiming()}>Save timing</button>
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
