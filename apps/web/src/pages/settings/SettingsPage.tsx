import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parsePauseDuration, type LexiconEntryAuthoring } from "@studynarrator/core";
import {
  type SpeachesConnection,
  type ScratchpadClient,
  type PersistenceClient,
  type SpeechCacheClient,
  type SpeechCacheStatus,
  type SystemPacingDefaults,
  type VoiceCatalog
} from "@studynarrator/shared-types";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { filterPresentedVoices, groupPresentedVoices, presentVoices, voiceOptionLabel, type PresentedVoice } from "@/features/connections/voicePresentation.js";
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

const EMPTY_GLOBAL_LEXICON: SimplifiedGlobalEntry = { scope: "global", entryType: "exactTerm", displayText: "", spokenText: "", caseSensitive: false, wholeWord: true, priority: 0, enabled: true, notes: "" };
const VOICE_TEST_SCRIPT = "This short sample lets you hear how this voice handles clear narration.";

type AuditionState = { voiceId: string; phase: "processing" | "playing" } | null;
type LexiconRowState = "saving" | "saved" | "error";

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
  const [pacing, setPacing] = useState<SystemPacingDefaults>({ enabled: true, durationMs: 750 });
  const [duration, setDuration] = useState("750 ms");
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
  const [lexiconDraft, setLexiconDraft] = useState<SimplifiedGlobalEntry>(EMPTY_GLOBAL_LEXICON);
  const [lexiconSearch, setLexiconSearch] = useState("");
  const [lexiconRowState, setLexiconRowState] = useState<Record<string, LexiconRowState>>({});
  const [lexiconAdding, setLexiconAdding] = useState(false);
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
      setPacing(loaded);
      setDuration(`${String(loaded.durationMs)} ms`);
      setStatus("These values are copied into each new project.");
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

  const savePacing = async () => {
    const parsed = parsePauseDuration(duration);
    if (!parsed.ok) { setError(parsed.message); return; }
    try {
      const saved = await client.settings.updatePacing({ enabled: pacing.enabled, durationMs: parsed.durationMs });
      setPacing(saved); setDuration(`${String(saved.durationMs)} ms`); setError("");
      setStatus("Pacing defaults saved. Existing projects were not changed.");
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

  const updateGlobalLexiconEntry = (id: string, change: Partial<Pick<SimplifiedGlobalEntry, "displayText" | "spokenText" | "enabled">>, immediate = false) => {
    lexiconRevisionRef.current += 1;
    const next = globalLexiconRef.current.map((entry) => entry.id === id ? fixedGlobalEntry({ ...entry, ...change }) : entry);
    globalLexiconRef.current = next;
    setGlobalLexicon(next);
    pendingLexiconRowsRef.current.add(id);
    setLexiconRowState((current) => ({ ...current, [id]: "saving" }));
    if (immediate) flushGlobalLexicon();
    else {
      if (lexiconTimerRef.current) clearTimeout(lexiconTimerRef.current);
      lexiconTimerRef.current = setTimeout(flushGlobalLexicon, 500);
    }
  };

  const saveGlobalLexiconEntry = async () => {
    const displayText = lexiconDraft.displayText.trim();
    const spokenText = lexiconDraft.spokenText.trim();
    if (!displayText || !spokenText) { setError("Script Text and Spoken Text are required."); return; }
    if (globalLexiconRef.current.some((entry) => entry.displayText.trim().toLocaleLowerCase("en-US") === displayText.toLocaleLowerCase("en-US"))) {
      setError("Script Text must be unique regardless of capitalization.");
      return;
    }
    flushGlobalLexicon();
    setLexiconAdding(true);
    lexiconRevisionRef.current += 1;
    const added = await persistGlobalLexicon([...globalLexiconRef.current, fixedGlobalEntry({ ...EMPTY_GLOBAL_LEXICON, displayText, spokenText })], [], "Global pronunciation added.");
    setLexiconAdding(false);
    if (added) setLexiconDraft(EMPTY_GLOBAL_LEXICON);
  };

  const deleteGlobalLexiconEntry = async (id: string) => {
    flushGlobalLexicon();
    lexiconRevisionRef.current += 1;
    await persistGlobalLexicon(globalLexiconRef.current.filter((entry) => entry.id !== id), [id], "Global pronunciation deleted.");
  };

  const speechModels = workspace.catalog.status === "ready" ? workspace.catalog.catalog.models : [];
  const selectedSpeechModel = speechModels.find(({ modelId }) => modelId === draft.defaultModelId);
  const presentedVoices = useMemo(() => presentVoices(selectedSpeechModel?.voices ?? [], catalog?.entries ?? []), [catalog, selectedSpeechModel]);
  const filteredVoices = useMemo(() => filterPresentedVoices(presentedVoices, catalogSearch), [catalogSearch, presentedVoices]);
  const voiceGroups = useMemo(() => groupPresentedVoices(filteredVoices.slice(0, 100)), [filteredVoices]);
  const defaultVoiceGroups = useMemo(() => groupPresentedVoices(presentedVoices.filter(({ availableOnServer }) => availableOnServer)), [presentedVoices]);
  const filteredLexicon = useMemo(() => globalLexicon.filter((entry) => !lexiconSearch || `${entry.displayText} ${entry.spokenText}`.toLocaleLowerCase().includes(lexiconSearch.toLocaleLowerCase())), [globalLexicon, lexiconSearch]);
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
          <label>Default Voice<select value={draft.defaultVoiceId} disabled={!selectedSpeechModel} onChange={(event) => setDraft({ ...draft, defaultVoiceId: event.target.value })}><option value="">Choose a voice</option>{defaultVoiceGroups.map((group) => <optgroup key={group.key} label={group.label}>{group.voices.map((voice) => <option key={voice.voiceId} value={voice.voiceId}>{voiceOptionLabel(voice)}</option>)}</optgroup>)}</select></label>
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
              <div><strong>{entry.friendlyName}</strong><code>{entry.voiceId}</code><span>{entry.enabled ? "enabled" : "disabled"} · {entry.localeLabel}</span></div>
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
        <form className={styles.lexiconAdd} onSubmit={(event) => { event.preventDefault(); void saveGlobalLexiconEntry(); }}>
          <label>Script Text<input value={lexiconDraft.displayText} onChange={(event) => setLexiconDraft((current) => ({ ...current, displayText: event.target.value }))} /></label>
          <span aria-hidden="true">→</span>
          <label>Spoken Text<input value={lexiconDraft.spokenText} onChange={(event) => setLexiconDraft((current) => ({ ...current, spokenText: event.target.value }))} /></label>
          <button type="submit" disabled={lexiconAdding}>{lexiconAdding ? "Adding…" : "Add"}</button>
        </form>
        <input className={styles.lexiconSearch} aria-label="Search global lexicon" placeholder="Search Script Text or Spoken Text" value={lexiconSearch} onChange={(event) => setLexiconSearch(event.target.value)} />
        <div className={styles.lexiconEntries}>{filteredLexicon.length === 0 ? <p>No matching global lexicon entries.</p> : filteredLexicon.map((entry, index) => {
          const id = entry.id ?? `global-${String(index)}`;
          const rowState = lexiconRowState[id];
          return <article key={id} aria-label={`Global lexicon entry ${entry.displayText || "without Script Text"}`}>
            <label>Script Text<input disabled={lexiconAdding} value={entry.displayText} onChange={(event) => updateGlobalLexiconEntry(id, { displayText: event.target.value })} onBlur={() => { pendingLexiconRowsRef.current.add(id); flushGlobalLexicon(); }} /></label>
            <span aria-hidden="true">→</span>
            <label>Spoken Text<input disabled={lexiconAdding} value={entry.spokenText} onChange={(event) => updateGlobalLexiconEntry(id, { spokenText: event.target.value })} onBlur={() => { pendingLexiconRowsRef.current.add(id); flushGlobalLexicon(); }} /></label>
            <label className={styles.enabledCheck}><input type="checkbox" disabled={lexiconAdding} checked={entry.enabled !== false} onChange={(event) => updateGlobalLexiconEntry(id, { enabled: event.target.checked }, true)} />Enabled</label>
            <span className={styles.lexiconSaveState} data-state={rowState} aria-live="polite">{rowState === "saving" ? "Saving…" : rowState === "saved" ? "Saved" : rowState === "error" ? "Not saved — edit or blur to retry" : ""}</span>
            <button type="button" className={styles.danger} disabled={lexiconAdding} onClick={() => void deleteGlobalLexiconEntry(id)}>Delete</button>
          </article>;
        })}</div>
      </section>

      <section className={styles.pacing}>
        <div><p>Pacing defaults</p><h3>New-project paragraph pause</h3></div>
        <label className={styles.check}><input type="checkbox" checked={pacing.enabled} onChange={(event) => setPacing({ ...pacing, enabled: event.target.checked })} />Pause at paragraph breaks</label>
        <label>Default <code>pause_medium</code> duration<input value={duration} onChange={(event) => { setDuration(event.target.value); setError(""); }} /></label>
        <button type="button" onClick={() => void savePacing()}>Save pacing defaults</button>
      </section>

      <section className={styles.cache}>
        <div className={styles.sectionHeading}><div><p>Disposable preview audio</p><h3>Speech cache</h3></div><button type="button" className={styles.secondary} onClick={() => void refreshCache()}>Refresh</button></div>
        {cacheStatus ? <>
          <div className={styles.cacheGrid}><article><span>Stored</span><strong>{cacheStatus.entryCount.toLocaleString()} entries</strong><code>{formatBytes(cacheStatus.totalBytes)}</code></article><article><span>This session</span><strong>{cacheStatus.sessionHits.toLocaleString()} hits · {cacheStatus.sessionMisses.toLocaleString()} misses</strong><code>{cacheStatus.sessionWrites.toLocaleString()} writes · {cacheStatus.sessionCorruptMisses.toLocaleString()} corrupt misses</code></article><article><span>Activity</span><strong>{cacheStatus.inFlight.toLocaleString()} in flight</strong><code>{cacheStatus.lastUsedAt ? `Last used ${new Date(cacheStatus.lastUsedAt).toLocaleString()}` : "Not used yet"}</code></article></div>
          <p>Cached WAV files are disposable and never create render history. Project cleanup can remove globally shared audio that was associated with that project.</p>
        </> : <p>Loading cache statistics…</p>}
        <button type="button" className={styles.danger} disabled={cacheBusy || cacheStatus?.entryCount === 0} onClick={() => void clearAllCache()}>{cacheBusy ? "Clearing…" : "Clear all cached speech"}</button>
      </section>
    </div>
  );
}
