import { useEffect, useMemo, useState } from "react";
import { parsePauseDuration, type LexiconEntryAuthoring } from "@studynarrator/core";
import {
  VoiceCatalogSchema,
  type ConnectionProfile,
  type PersistenceClient,
  type SpeechCacheClient,
  type SpeechCacheStatus,
  type SystemPacingDefaults,
  type VoiceCatalog
} from "@studynarrator/shared-types";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { authoringLexicon } from "@/features/projects/projectAuthoring.js";
import styles from "./SettingsPage.module.css";

const EMPTY_PROFILE = { name: "", baseUrl: "", defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX", defaultVoiceId: "af_heart", timeoutSeconds: 120, retryCount: 2 };
const EMPTY_GLOBAL_LEXICON: LexiconEntryAuthoring = { scope: "global", entryType: "exactTerm", displayText: "", spokenText: "", caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "" };

function profileDraft(profile: ConnectionProfile | null) {
  return profile ? {
    name: profile.name,
    baseUrl: profile.baseUrl ?? "",
    defaultModelId: profile.defaultModelId ?? "",
    defaultVoiceId: profile.defaultVoiceId ?? "",
    timeoutSeconds: profile.timeoutSeconds,
    retryCount: profile.retryCount
  } : { ...EMPTY_PROFILE };
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value.toLocaleString()} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

export function SettingsPage({ client, cacheClient }: { client: PersistenceClient; cacheClient: SpeechCacheClient }) {
  const workspace = useConnections();
  const [pacing, setPacing] = useState<SystemPacingDefaults>({ enabled: true, durationMs: 750 });
  const [duration, setDuration] = useState("750 ms");
  const [status, setStatus] = useState("Loading settings…");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = workspace.profiles.find(({ id }) => id === selectedId) ?? null;
  const [draft, setDraft] = useState(EMPTY_PROFILE);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogJson, setCatalogJson] = useState("");
  const [cacheStatus, setCacheStatus] = useState<SpeechCacheStatus | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [globalLexicon, setGlobalLexicon] = useState<LexiconEntryAuthoring[]>([]);
  const [lexiconDraft, setLexiconDraft] = useState<LexiconEntryAuthoring>(EMPTY_GLOBAL_LEXICON);
  const [editingLexiconId, setEditingLexiconId] = useState<string>();
  const [lexiconSearch, setLexiconSearch] = useState("");
  const [lexiconType, setLexiconType] = useState<"all" | LexiconEntryAuthoring["entryType"]>("all");

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
    void client.globalLexicon.list().then((entries) => { if (active) setGlobalLexicon(authoringLexicon(entries)); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "The global lexicon could not be loaded."); });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (selectedId === null && workspace.profiles.length > 0) setSelectedId(workspace.setup?.activeProfileId ?? workspace.profiles[0]?.id ?? null);
  }, [selectedId, workspace.profiles, workspace.setup?.activeProfileId]);

  useEffect(() => {
    setDraft(profileDraft(selected));
    setApiKey("");
    setClearKey(false);
  }, [selected]);

  useEffect(() => {
    if (!draft.defaultModelId) { setCatalog(null); return; }
    let active = true;
    void workspace.getCatalog(draft.defaultModelId).then((next) => { if (active) setCatalog(next); }).catch(() => { if (active) setCatalog(null); });
    return () => { active = false; };
  }, [draft.defaultModelId, workspace]);

  const savePacing = async () => {
    const parsed = parsePauseDuration(duration);
    if (!parsed.ok) { setError(parsed.message); return; }
    try {
      const saved = await client.settings.updatePacing({ enabled: pacing.enabled, durationMs: parsed.durationMs });
      setPacing(saved); setDuration(`${String(saved.durationMs)} ms`); setError("");
      setStatus("Pacing defaults saved. Existing projects were not changed.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Settings could not be saved."); }
  };

  const saveProfile = async () => {
    setError("");
    try {
      const credential = workspace.setup?.client === "electron" && apiKey
        ? { action: "replace" as const, apiKey }
        : clearKey ? { action: "clear" as const } : { action: "keep" as const };
      const mutation = {
        profile: {
          name: draft.name,
          baseUrl: draft.baseUrl || null,
          defaultModelId: draft.defaultModelId || null,
          defaultVoiceId: draft.defaultVoiceId || null,
          timeoutSeconds: draft.timeoutSeconds,
          retryCount: draft.retryCount,
          responseFormat: "wav" as const
        },
        credential
      };
      const saved = selected ? await workspace.replace(selected.id, mutation) : await workspace.create(mutation);
      setSelectedId(saved.id);
      setStatus(`${saved.name} saved.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The connection profile could not be saved.");
    } finally {
      setApiKey("");
      setClearKey(false);
    }
  };

  const testProfile = async () => {
    if (!selected) return;
    try {
      const result = await workspace.test(selected.id);
      setStatus(`Connection test: ${result.overall}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection test failed unexpectedly."); }
  };

  const exportDiagnostics = async () => {
    if (!selected) return;
    try {
      const exported = await workspace.exportDiagnostics(selected.id);
      const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `studynarrator-${selected.id}-diagnostics.json`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Diagnostics could not be exported."); }
  };

  const replaceCatalog = async () => {
    try {
      const parsed = VoiceCatalogSchema.parse(JSON.parse(catalogJson) as unknown);
      const saved = await workspace.replaceCatalog(parsed);
      setCatalog(saved); setCatalogJson(""); setStatus(`Catalog overrides replaced for ${saved.modelId}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Catalog JSON is invalid."); }
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

  const replaceGlobalLexicon = async (entries: LexiconEntryAuthoring[], success: string) => {
    try {
      setGlobalLexicon(authoringLexicon(await client.globalLexicon.replace(entries.map((entry) => ({ ...entry, scope: "global" })))));
      setStatus(success);
      setError("");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The global lexicon could not be saved.");
      return false;
    }
  };

  const saveGlobalLexiconEntry = async () => {
    const candidate: LexiconEntryAuthoring = { ...lexiconDraft, scope: "global", ...(editingLexiconId ? { id: editingLexiconId } : {}) };
    if (!candidate.displayText.trim() || !candidate.spokenText.trim()) { setError("Display text and spoken text are required."); return; }
    const next = editingLexiconId ? globalLexicon.map((entry) => entry.id === editingLexiconId ? candidate : entry) : [...globalLexicon, candidate];
    if (!await replaceGlobalLexicon(next, editingLexiconId ? "Global pronunciation updated." : "Global pronunciation added.")) return;
    setLexiconDraft(EMPTY_GLOBAL_LEXICON);
    setEditingLexiconId(undefined);
  };

  const filteredVoices = useMemo(() => catalog?.entries.filter((entry) => !catalogSearch || `${entry.label} ${entry.voiceId} ${entry.language ?? ""}`.toLocaleLowerCase().includes(catalogSearch.toLocaleLowerCase())) ?? [], [catalog, catalogSearch]);
  const filteredLexicon = useMemo(() => globalLexicon.filter((entry) => (lexiconType === "all" || entry.entryType === lexiconType) && (!lexiconSearch || `${entry.displayText} ${entry.senseId ?? ""} ${entry.spokenText}`.toLocaleLowerCase().includes(lexiconSearch.toLocaleLowerCase()))), [globalLexicon, lexiconSearch, lexiconType]);
  const managed = selected?.source === "environment";

  return (
    <div className={styles.page}>
      <header><p>Installation + connections</p><h2>Settings</h2><span>Manage local authoring defaults, connection profiles, staged diagnostics, and the voice catalog.</span></header>
      {error || workspace.error ? <p className={styles.error} role="alert">{error || workspace.error}</p> : null}
      <p className={styles.status} aria-live="polite">{status}</p>

      <section className={styles.connections}>
        <div className={styles.sectionHeading}><div><p>Speaches profiles</p><h3>Connection workshop</h3></div><button type="button" className={styles.secondary} onClick={() => { setSelectedId("__new__"); setDraft({ ...EMPTY_PROFILE }); }}>New saved profile</button></div>
        <div className={styles.connectionGrid}>
          <aside className={styles.profileList}>{workspace.profiles.map((profile) => <button type="button" data-active={profile.id === selectedId} key={profile.id} onClick={() => setSelectedId(profile.id)}><strong>{profile.name}</strong><span>{profile.source} · {profile.lastTestSummary?.overall ?? (profile.configured ? "unverified" : "unconfigured")}</span></button>)}</aside>
          <div className={styles.profileForm}>
            {managed ? <p className={styles.managed}>Managed by environment · effective source: server environment · fields are read-only.</p> : null}
            <label>Name<input disabled={managed} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>Endpoint root or /v1<input disabled={managed} value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
            <label>Model ID<input disabled={managed} list="known-models" value={draft.defaultModelId} onChange={(event) => setDraft({ ...draft, defaultModelId: event.target.value })} /></label>
            <datalist id="known-models"><option value="speaches-ai/Kokoro-82M-v1.0-ONNX" /></datalist>
            <label>Default voice ID<input disabled={managed} list="known-voices" value={draft.defaultVoiceId} onChange={(event) => setDraft({ ...draft, defaultVoiceId: event.target.value })} /></label>
            <datalist id="known-voices">{catalog?.entries.filter(({ enabled }) => enabled).map((entry) => <option key={entry.voiceId} value={entry.voiceId}>{entry.label}</option>)}</datalist>
            <div className={styles.inline}><label>Timeout (seconds)<input disabled={managed} type="number" min="1" max="600" value={draft.timeoutSeconds} onChange={(event) => setDraft({ ...draft, timeoutSeconds: Number(event.target.value) })} /></label><label>Retries<input disabled={managed} type="number" min="0" max="5" value={draft.retryCount} onChange={(event) => setDraft({ ...draft, retryCount: Number(event.target.value) })} /></label></div>
            <p className={styles.keyState}>API key: {selected?.apiKeyConfigured ? "configured" : "not configured"}{workspace.setup?.client === "web" ? " · server-managed" : ""}</p>
            {workspace.setup?.client === "electron" && !managed ? <><label>Replace API key (one shot)<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label><label className={styles.check}><input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} />Clear stored key</label></> : null}
            <div className={styles.actions}><button type="button" disabled={managed || !draft.name.trim()} onClick={() => void saveProfile()}>{selected ? "Save profile" : "Create profile"}</button>{selected ? <button type="button" className={styles.secondary} disabled={workspace.testingProfileId === selected.id || !selected.configured} onClick={() => void testProfile()}>{workspace.testingProfileId === selected.id ? "Testing…" : "Test Connection"}</button> : null}{selected?.source === "saved" ? <button type="button" className={styles.danger} onClick={() => { if (window.confirm(`Delete ${selected.name}? Project references will be cleared.`)) void workspace.delete(selected.id).then(() => setSelectedId(null)); }}>Delete</button> : null}</div>
            {selected ? <label>Active profile<select disabled={workspace.setup?.activeProfileLocked} value={workspace.setup?.activeProfileId ?? ""} onChange={(event) => void workspace.setActive(event.target.value || null)}><option value="">No active profile</option>{workspace.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label> : null}
          </div>
        </div>
        {selected?.lastTestSummary ? <div className={styles.diagnostics}><div className={styles.diagnosticHeader}><div><p>Signal path</p><h4>{selected.lastTestSummary.overall}</h4></div><button type="button" className={styles.secondary} onClick={() => void exportDiagnostics()}>Export redacted JSON</button></div><ol>{selected.lastTestSummary.stages.map((item, index) => <li data-status={item.status} key={item.stage}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{item.stage}</strong><code>{item.code} · {item.durationMs} ms</code><span>{item.message}</span></div></li>)}</ol></div> : null}
      </section>

      <section className={styles.catalog}>
        <div className={styles.sectionHeading}><div><p>Versioned local catalog</p><h3>Voice browser</h3></div><span>{filteredVoices.length} matching voices</span></div>
        <input aria-label="Search voice catalog" placeholder="Search label, ID, or language" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} />
        <div className={styles.voiceList}>{filteredVoices.slice(0, 100).map((entry) => <article data-enabled={entry.enabled} key={entry.voiceId}><strong>{entry.label}</strong><code>{entry.voiceId}</code><span>{entry.enabled ? "enabled" : "disabled"} · {entry.locale ?? entry.language ?? "unspecified"}</span></article>)}</div>
        <label>Strict override JSON<textarea rows={7} spellCheck={false} value={catalogJson} onChange={(event) => setCatalogJson(event.target.value)} placeholder={'{"schemaVersion":1,"modelId":"…","entries":[]}'}/></label>
        <button type="button" disabled={!catalogJson.trim()} onClick={() => void replaceCatalog()}>Replace model overrides</button>
        <p className={styles.attribution}>Bundled Kokoro identifiers: hexgrad/Kokoro-82M VOICES.md · Apache-2.0. Labels omit subjective quality claims.</p>
      </section>

      <section className={styles.globalLexicon} id="global-lexicon" aria-labelledby="global-lexicon-heading">
        <div className={styles.sectionHeading}><div><p>Shared pronunciation</p><h3 id="global-lexicon-heading">Global lexicon</h3></div><span>{globalLexicon.length} entries</span></div>
        <p>These rules apply to every project and pronunciation preview. Project-only rules stay with their project.</p>
        <div className={styles.lexiconFilters}><input aria-label="Search global lexicon" placeholder="Search terms and replacements" value={lexiconSearch} onChange={(event) => setLexiconSearch(event.target.value)} /><select aria-label="Global lexicon type filter" value={lexiconType} onChange={(event) => setLexiconType(event.target.value as typeof lexiconType)}><option value="all">All types</option><option value="exactTerm">Exact terms</option><option value="exactPhrase">Exact phrases</option><option value="namedSense">Named senses</option></select></div>
        <div className={styles.lexiconWorkspace}>
          <form onSubmit={(event) => { event.preventDefault(); void saveGlobalLexiconEntry(); }}>
            <label>Type<select value={lexiconDraft.entryType} onChange={(event) => setLexiconDraft((current) => ({ ...current, entryType: event.target.value as LexiconEntryAuthoring["entryType"] }))}><option value="exactTerm">Exact term</option><option value="exactPhrase">Exact phrase</option><option value="namedSense">Named sense</option></select></label>
            <label>Display text<input value={lexiconDraft.displayText} onChange={(event) => setLexiconDraft((current) => ({ ...current, displayText: event.target.value }))} /></label>
            {lexiconDraft.entryType === "namedSense" ? <label>Sense ID<input value={lexiconDraft.senseId ?? ""} onChange={(event) => setLexiconDraft((current) => ({ ...current, senseId: event.target.value }))} /></label> : null}
            <label>Spoken text<input value={lexiconDraft.spokenText} onChange={(event) => setLexiconDraft((current) => ({ ...current, spokenText: event.target.value }))} /></label>
            <label>Notes<input value={lexiconDraft.notes ?? ""} onChange={(event) => setLexiconDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
            <div className={styles.lexiconChecks}><label><input type="checkbox" checked={lexiconDraft.caseSensitive ?? true} onChange={(event) => setLexiconDraft((current) => ({ ...current, caseSensitive: event.target.checked }))} />Case sensitive</label><label><input type="checkbox" checked={lexiconDraft.wholeWord ?? true} onChange={(event) => setLexiconDraft((current) => ({ ...current, wholeWord: event.target.checked }))} />Whole word</label><label><input type="checkbox" checked={lexiconDraft.enabled ?? true} onChange={(event) => setLexiconDraft((current) => ({ ...current, enabled: event.target.checked }))} />Enabled</label></div>
            <div className={styles.actions}><button type="submit">{editingLexiconId ? "Save entry" : "Add entry"}</button>{editingLexiconId ? <button type="button" className={styles.secondary} onClick={() => { setEditingLexiconId(undefined); setLexiconDraft(EMPTY_GLOBAL_LEXICON); }}>Cancel</button> : null}</div>
          </form>
          <div className={styles.lexiconEntries}>{filteredLexicon.length === 0 ? <p>No matching global lexicon entries.</p> : filteredLexicon.map((entry, index) => <article key={entry.id ?? `global-${String(index)}`}><div><strong>{entry.displayText}{entry.senseId ? ` + ${entry.senseId}` : ""}</strong><span>→ {entry.spokenText}</span></div><code>{entry.entryType} · {entry.enabled === false ? "disabled" : "enabled"}</code><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => { setEditingLexiconId(entry.id); setLexiconDraft({ ...entry, scope: "global", caseSensitive: entry.caseSensitive ?? true, wholeWord: entry.wholeWord ?? true, priority: entry.priority ?? 0, enabled: entry.enabled ?? true, notes: entry.notes ?? "" }); }}>Edit</button><button type="button" className={styles.secondary} onClick={() => void replaceGlobalLexicon(globalLexicon.map((item) => item.id === entry.id ? { ...item, enabled: !(item.enabled ?? true) } : item), `Global pronunciation ${entry.enabled === false ? "enabled" : "disabled"}.`)}>{entry.enabled === false ? "Enable" : "Disable"}</button><button type="button" className={styles.danger} onClick={() => void replaceGlobalLexicon(globalLexicon.filter((item) => item.id !== entry.id), "Global pronunciation deleted.")}>Delete</button></div></article>)}</div>
        </div>
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
