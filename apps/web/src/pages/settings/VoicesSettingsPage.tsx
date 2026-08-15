import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ScratchpadClient, type VoiceCatalog } from "@studynarrator/shared-types";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { filterPresentedVoices, groupPresentedVoices, presentVoices, type PresentedVoice } from "@/features/connections/voicePresentation.js";
import styles from "./SettingsPage.module.css";

const VOICE_TEST_SCRIPT = "This short sample lets you hear how this voice handles clear narration.";
type AuditionState = { voiceId: string; phase: "processing" | "playing" } | null;

function decodedAudio(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function VoicesSettingsPage({ scratchpadClient }: { scratchpadClient: ScratchpadClient }) {
  const workspace = useConnections();
  const modelId = workspace.connection?.defaultModelId ?? "";
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [voiceTestScript, setVoiceTestScript] = useState(VOICE_TEST_SCRIPT);
  const [audition, setAudition] = useState<AuditionState>(null);
  const [auditionError, setAuditionError] = useState("");
  const [favoriteSaving, setFavoriteSaving] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const auditionAbortRef = useRef<AbortController | undefined>(undefined);
  const auditionContextRef = useRef<AudioContext | undefined>(undefined);
  const auditionSourceRef = useRef<AudioBufferSourceNode | undefined>(undefined);
  const auditionGenerationRef = useRef(0);

  useEffect(() => {
    if (!workspace.connection?.baseUrl || workspace.catalog.status !== "idle") return;
    void workspace.discover({
      baseUrl: workspace.connection.baseUrl,
      timeoutSeconds: workspace.connection.timeoutSeconds,
      retryCount: workspace.connection.retryCount
    }).catch(() => undefined);
  }, [workspace]);

  useEffect(() => {
    if (!modelId) { setCatalog(null); return; }
    let active = true;
    void workspace.getCatalog(modelId).then((next) => { if (active) setCatalog(next); }).catch(() => { if (active) setCatalog(null); });
    return () => { active = false; };
  }, [modelId, workspace]);

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

  useEffect(() => () => { stopAudition(false); }, [stopAudition]);

  const speechModels = workspace.catalog.status === "ready" ? workspace.catalog.catalog.models : [];
  const selectedSpeechModel = speechModels.find((model) => model.modelId === modelId);
  const presentedVoices = useMemo(() => presentVoices(selectedSpeechModel?.voices ?? [], catalog?.entries ?? []), [catalog, selectedSpeechModel]);
  const filteredVoices = useMemo(() => filterPresentedVoices(presentedVoices, catalogSearch), [catalogSearch, presentedVoices]);
  const voiceGroups = useMemo(() => groupPresentedVoices(filteredVoices.slice(0, 100)), [filteredVoices]);
  const auditionReady = Boolean(
    workspace.connection?.configured
    && workspace.connection.baseUrl
    && modelId
    && voiceTestScript.trim()
  );

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
        modelId,
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

  const toggleVoiceFavorite = async (voice: PresentedVoice) => {
    if (!catalog || favoriteSaving) return;
    const currentModelId = catalog.modelId;
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
      setCatalog((current) => current?.modelId === currentModelId ? saved : current);
    } catch (reason) {
      setCatalog((current) => current?.modelId === currentModelId ? previous : current);
      setFavoriteError(reason instanceof Error ? reason.message : "This favorite could not be saved. Try the heart again.");
    } finally { setFavoriteSaving(""); }
  };

  return (
    <div className={`${styles.page} ${styles.singleColumnPage}`}>
      <header><p>Catalog + audition</p><h2>Voices</h2><span>Browse the saved model’s voices, keep favorites close, and audition narration samples.</span></header>
      {workspace.error ? <p className={styles.error} role="alert">{workspace.error}</p> : null}

      <section className={styles.catalog}>
        <div className={styles.sectionHeading}><div><p>Versioned local catalog</p><h3>Voice browser</h3></div><div className={styles.catalogMeta}>{catalog && catalog.modelId === modelId ? <><span className={styles.defaultModelBadge}>Default model</span><code>{catalog.modelId}</code></> : null}<span>{filteredVoices.length} matching voices</span></div></div>
        <label className={styles.voiceTestScript}>Voice test script<textarea rows={3} maxLength={1200} value={voiceTestScript} onChange={(event) => { setVoiceTestScript(event.target.value); setAuditionError(""); }} /></label>
        {auditionError ? <p className={styles.auditionError} role="alert">Voice test failed: {auditionError}</p> : null}
        {favoriteError ? <p className={styles.favoriteError} role="alert">Favorite not saved: {favoriteError}</p> : null}
        <input aria-label="Search voice catalog" placeholder="Search name, ID, language, or locale" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} />
        <div className={styles.voiceList} role="region" aria-label="Voice catalog results">{voiceGroups.map((group) => <section className={styles.voiceGroup} data-group={group.key === "favorites" ? "favorites" : "locale"} aria-label={`${group.label} voices`} key={group.key}>
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
    </div>
  );
}
