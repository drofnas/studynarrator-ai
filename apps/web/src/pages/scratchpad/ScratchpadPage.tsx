import { useEffect, useMemo, useRef, useState } from "react";
import { transformScratchpadPassage, type LexiconEntry } from "@studynarrator/core";
import type { PersistenceClient, ScratchpadClient, VoiceCatalog } from "@studynarrator/shared-types";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { BasicAudioPlayer } from "@/features/scratchpad/BasicAudioPlayer.js";
import { useScratchpadSession } from "@/features/scratchpad/ScratchpadSessionProvider.js";
import { ErrorNotice } from "@/shared/ui/ErrorNotice.js";
import styles from "./ScratchpadPage.module.css";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "StudyNarrator could not complete speech synthesis.";
}

export function ScratchpadPage({ client, persistence }: { client: ScratchpadClient; persistence: PersistenceClient }) {
  const connections = useConnections();
  const session = useScratchpadSession();
  const [profileId, setProfileId] = useState("");
  const [modelId, setModelId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [speed, setSpeed] = useState(1);
  const [text, setText] = useState("");
  const [applyGlobalLexicon, setApplyGlobalLexicon] = useState(false);
  const [globalLexicon, setGlobalLexicon] = useState<LexiconEntry[]>([]);
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void persistence.globalLexicon.list().then(setGlobalLexicon).catch(() => setGlobalLexicon([]));
  }, [persistence]);

  useEffect(() => {
    if (profileId || connections.loading) return;
    const initial = connections.activeProfile ?? connections.profiles.find(({ configured }) => configured) ?? connections.profiles[0];
    if (!initial) return;
    setProfileId(initial.id);
    setModelId(initial.defaultModelId ?? "");
    setVoiceId(initial.defaultVoiceId ?? "");
  }, [connections.activeProfile, connections.loading, connections.profiles, profileId]);

  useEffect(() => {
    let current = true;
    if (!modelId.trim()) { setCatalog(null); return; }
    void connections.getCatalog(modelId).then((value) => { if (current) setCatalog(value); }).catch(() => { if (current) setCatalog(null); });
    return () => { current = false; };
  }, [connections, modelId]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const profile = connections.profiles.find(({ id }) => id === profileId) ?? null;
  const voice = catalog?.entries.find((entry) => entry.voiceId === voiceId);
  const projection = useMemo(() => {
    if (!text.trim()) return { result: null, error: "" };
    try {
      return { result: transformScratchpadPassage({ text, entries: globalLexicon, applyGlobalLexicon }), error: "" };
    } catch (reason) {
      return { result: null, error: message(reason) };
    }
  }, [applyGlobalLexicon, globalLexicon, text]);
  const validSpeed = Number.isFinite(speed) && speed > 0 && speed <= 4;
  const ready = Boolean(profile?.baseUrl && modelId.trim() && voiceId.trim() && text.trim() && validSpeed && projection.result);

  const chooseProfile = (nextId: string) => {
    const next = connections.profiles.find(({ id }) => id === nextId);
    setProfileId(nextId);
    setModelId(next?.defaultModelId ?? "");
    setVoiceId(next?.defaultVoiceId ?? "");
  };

  const synthesize = async () => {
    if (!ready) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await client.preview({ connectionProfileId: profileId, modelId, voiceId, speed, text, applyGlobalLexicon }, controller.signal);
      if (!controller.signal.aborted) session.add(result);
    } catch (reason) {
      if (!controller.signal.aborted) setError(message(reason));
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); }
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p className={styles.kicker}>One passage · one request</p><h2>Quick Scratchpad</h2><p>Test a voice or pronunciation without touching a project.</p></div>
        <div className={styles.connectionState} data-state={connections.shellState}><span>Active signal</span><strong>{profile?.name ?? "No profile selected"}</strong><code>{connections.shellState}</code></div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.controls} aria-label="Scratchpad synthesis controls">
          <div><span className={styles.step}>Signal path</span><h3>Voice setup</h3></div>
          <label htmlFor="scratchpad-profile">Connection profile</label><select id="scratchpad-profile" value={profileId} onChange={(event) => chooseProfile(event.target.value)}><option value="">Choose a profile</option>{connections.profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <label htmlFor="scratchpad-model">Model ID</label><input id="scratchpad-model" list="scratchpad-models" value={modelId} onChange={(event) => setModelId(event.target.value)} /><datalist id="scratchpad-models">{profile?.lastTestSummary?.availableModelIds.map((id) => <option key={id} value={id} />)}</datalist>
          <label htmlFor="scratchpad-voice">Voice catalog or manual ID</label><input id="scratchpad-voice" list="scratchpad-voices" value={voiceId} onChange={(event) => setVoiceId(event.target.value)} /><datalist id="scratchpad-voices">{catalog?.entries.filter(({ enabled }) => enabled).map((entry) => <option key={entry.voiceId} value={entry.voiceId}>{entry.label}</option>)}</datalist>
          <div className={styles.voiceCard}><strong>{voice?.label ?? (voiceId ? "Manual voice ID" : "No voice selected")}</strong><code>{voiceId || "—"}</code></div>
          <label htmlFor="scratchpad-speed">Speed</label><input id="scratchpad-speed" type="number" min="0.01" max="4" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
          {!profile?.baseUrl && profileId ? <p className={styles.fieldError}>This profile needs a Speaches URL before synthesis.</p> : null}
        </aside>

        <main className={styles.composer}>
          <section className={styles.passagePanel}>
            <div className={styles.sectionHeading}><div><span className={styles.step}>Source</span><h3>Short passage</h3></div><b>{text.length} / 1200</b></div>
            <label htmlFor="scratchpad-text">Passage</label>
            <textarea id="scratchpad-text" maxLength={1200} value={text} onChange={(event) => setText(event.target.value)} placeholder="SQL indexes can improve database reads." />
            <label className={styles.lexiconToggle}><input type="checkbox" checked={applyGlobalLexicon} onChange={(event) => setApplyGlobalLexicon(event.target.checked)} />Apply global lexicon</label>
            {projection.error ? <p className={styles.fieldError} role="alert">{projection.error}</p> : null}
          </section>

          <section className={styles.transformation} aria-label="Scratchpad text preview">
            <article><span>Original</span><p>{text || "Your passage stays unchanged here."}</p></article>
            <div className={styles.transformMark} aria-hidden="true">→</div>
            <article><span>Sent to Speaches</span><p>{projection.result?.transformedText || "The exact synthesis text appears here."}</p></article>
          </section>
          {projection.result?.warnings.length ? <ul className={styles.warnings}>{projection.result.warnings.map((item) => <li key={`${item.code}:${String(item.line ?? 0)}:${item.message}`}>{item.message}</li>)}</ul> : null}
          <div className={styles.synthesisBar}><div><span className={styles.step}>Audible proof</span><strong>{busy ? "Generating a validated WAV…" : "Ready for one fresh synthesis request"}</strong></div><button type="button" onClick={() => void synthesize()} disabled={!ready || busy}>{busy ? "Synthesizing…" : error ? "Retry synthesis" : "Synthesize passage"}</button></div>
          {error ? <ErrorNotice title="Synthesis did not complete">{error} Your passage and selections are ready to retry.</ErrorNotice> : null}

          {session.active ? <>
            <BasicAudioPlayer label={`${session.active.result.connectionProfileName} · ${session.active.result.voiceId}`} src={session.active.audioUrl} />
            <section className={styles.resultDetail}><div><span>Result</span><strong>{session.active.result.voiceId}</strong></div><code>{session.active.result.modelId} · {String(session.active.result.speed)}× · {String(session.active.result.audio.byteLength)} bytes</code><p>{session.active.result.transformedText}</p></section>
          </> : <section className={styles.emptyResult}><span aria-hidden="true">◌</span><div><h3>No audio loaded</h3><p>Your first validated result will appear here. Scratchpad results never enter project or render history.</p></div></section>}
        </main>

        <aside className={styles.history} aria-label="Scratchpad session history">
          <div className={styles.historyHeading}><div><span className={styles.step}>This session</span><h3>Recent results</h3></div>{session.results.length ? <button type="button" onClick={() => session.clear()}>Clear</button> : null}</div>
          {session.results.length === 0 ? <p>Up to five successful tests remain here until reload or restart.</p> : session.results.map(({ result }) => <button type="button" className={result.id === session.active?.result.id ? styles.activeResult : ""} key={result.id} onClick={() => session.select(result.id)}><strong>{result.voiceId}</strong><span>{result.transformedText}</span><code>{new Date(result.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</code></button>)}
        </aside>
      </div>
    </div>
  );
}
