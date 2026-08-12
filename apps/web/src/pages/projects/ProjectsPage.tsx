import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  buildAuthoringDryRun,
  parsePauseDuration,
  parseScript,
  reconcileDiscoveredConfiguration,
  transformScript,
  type AuthoringDryRunResult,
  type AuthoringPauseRow,
  type AuthoringSpeakerRow,
  type LexiconEntryAuthoring
} from "@studynarrator/core";
import {
  ProjectReplaceInputSchema,
  type IgnoredDiagnosticCollection,
  type PersistenceClient,
  type ProjectDetail,
  type ProjectSummary
} from "@studynarrator/shared-types";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import type { ScriptAnalysisResult } from "@/workers/parser/parserWorkerProtocol.js";
import {
  authoringLexicon,
  draftFromProject,
  materializeLexicon,
  readUtf8TextFile,
  replaceLiteral,
  stripSingleSurroundingCodeFence,
  type ProjectDraft
} from "@/features/projects/projectAuthoring.js";
import styles from "./ProjectsPage.module.css";

type SaveState = "saved" | "unsaved" | "saving" | "invalid" | "failed";
type AnalysisState = "idle" | "parsing" | "ready" | "failed";

const emptyLexiconDraft: LexiconEntryAuthoring = {
  scope: "project",
  entryType: "exactTerm",
  displayText: "",
  spokenText: "",
  caseSensitive: true,
  wholeWord: true,
  priority: 0,
  enabled: true,
  notes: ""
};

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function sameDraft(left: ProjectDraft, right: ProjectDraft): boolean {
  return left.name === right.name
    && left.description === right.description
    && left.scriptSource === right.scriptSource
    && left.connectionProfileId === right.connectionProfileId
    && left.speakerMappings === right.speakerMappings
    && left.pausePresets === right.pausePresets
    && left.paragraphPause === right.paragraphPause
    && left.lexiconEntries === right.lexiconEntries;
}
function message(error: unknown): string { return error instanceof Error ? error.message : "The operation failed."; }

export function ProjectsPage({ client, analyzer }: { client: PersistenceClient; analyzer: ScriptAnalyzer }) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectDetail>();
  const [draft, setDraft] = useState<ProjectDraft>();
  const draftRef = useRef<ProjectDraft | undefined>(undefined);
  const [globalLexicon, setGlobalLexicon] = useState<LexiconEntryAuthoring[]>([]);
  const [ignoredDiagnostics, setIgnoredDiagnostics] = useState<IgnoredDiagnosticCollection>([]);
  const [configuration, setConfiguration] = useState<{ speakers: AuthoringSpeakerRow[]; pauses: AuthoringPauseRow[]; sections: Array<{ title: string; sourceLine: number; speechSegmentCount: number }> }>({ speakers: [], pauses: [], sections: [] });
  const [analysis, setAnalysis] = useState<ScriptAnalysisResult>();
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState("Choose a project or create one to begin.");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [pauseInputs, setPauseInputs] = useState<Record<string, string>>({});
  const invalidPauseRef = useRef<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [cleanupUndo, setCleanupUndo] = useState<string>();
  const [lexiconDraft, setLexiconDraft] = useState<LexiconEntryAuthoring>(emptyLexiconDraft);
  const [editingLexicon, setEditingLexicon] = useState<{ scope: "global" | "project"; id: string }>();
  const [lexiconSearch, setLexiconSearch] = useState("");
  const [lexiconScope, setLexiconScope] = useState<"all" | "global" | "project">("all");
  const [lexiconType, setLexiconType] = useState<"all" | LexiconEntryAuthoring["entryType"]>("all");
  const [sample, setSample] = useState("");
  const [sampleSpeaker, setSampleSpeaker] = useState("");
  const [copySource, setCopySource] = useState<Record<string, string>>({});
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const analysisRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveNowRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));

  draftRef.current = draft;
  const isDirty = saveState === "unsaved" || saveState === "saving" || saveState === "invalid" || saveState === "failed";

  const reloadProjects = useCallback(async () => setProjects(await client.projects.list()), [client]);

  const clearAutosave = useCallback(() => {
    if (autosaveTimerRef.current === undefined) return;
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
  }, []);

  const scheduleAutosave = useCallback(() => {
    // Draft mutations own the timer; save and analysis state transitions must never re-arm it.
    clearAutosave();
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = undefined;
      void saveNowRef.current();
    }, 800);
  }, [clearAutosave]);

  useEffect(() => {
    let active = true;
    void Promise.all([client.projects.list(), client.globalLexicon.list(), client.preferences.getIgnoredDiagnostics()])
      .then(([nextProjects, nextGlobal, nextIgnored]) => {
        if (!active) return;
        setProjects(nextProjects);
        setGlobalLexicon(authoringLexicon(nextGlobal));
        setIgnoredDiagnostics(nextIgnored);
        setBusy(false);
      })
      .catch((error: unknown) => { if (active) { setErrors([message(error)]); setBusy(false); } });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (!projectId) {
      clearAutosave();
      setProject(undefined);
      setDraft(undefined);
      draftRef.current = undefined;
      setAnalysis(undefined);
      setConfiguration({ speakers: [], pauses: [], sections: [] });
      return;
    }
    let active = true;
    setBusy(true);
    void client.projects.get(projectId).then((loaded) => {
      if (!active) return;
      clearAutosave();
      const loadedDraft = draftFromProject(loaded);
      setProject(loaded);
      setDraft(loadedDraft);
      draftRef.current = loadedDraft;
      revisionRef.current = 0;
      savedRevisionRef.current = 0;
      invalidPauseRef.current = {};
      setPauseInputs(Object.fromEntries(loaded.pausePresets.map((item) => [item.pauseId, `${String(item.durationMs)} ms`])));
      setSaveState("saved");
      setNotice(`Opened ${loaded.name}.`);
      setErrors([]);
      setBusy(false);
    }).catch((error: unknown) => { if (active) { setErrors([message(error)]); setBusy(false); } });
    return () => { active = false; };
  }, [clearAutosave, client, projectId]);

  const updateDraft = useCallback((updater: (current: ProjectDraft) => ProjectDraft, autosave = true) => {
    const current = draftRef.current;
    if (!current) return;
    const next = updater(current);
    if (sameDraft(current, next)) return;
    draftRef.current = next;
    setDraft(next);
    if (autosave) {
      revisionRef.current += 1;
      if (Object.keys(invalidPauseRef.current).length > 0) {
        clearAutosave();
        setSaveState("invalid");
      } else {
        setSaveState("unsaved");
        scheduleAutosave();
      }
    }
  }, [clearAutosave, scheduleAutosave]);

  const performSave = useCallback(async (): Promise<boolean> => {
    const current = draftRef.current;
    const currentProject = project;
    if (!current || !currentProject) return false;
    if (Object.keys(invalidPauseRef.current).length > 0) { setSaveState("invalid"); return false; }
    const parsed = ProjectReplaceInputSchema.safeParse(current);
    if (!parsed.success) {
      setSaveState("invalid");
      setErrors(parsed.error.issues.map((issue) => `${issue.path.join(".") || "$"}: ${issue.message}`));
      return false;
    }
    const targetRevision = revisionRef.current;
    if (targetRevision <= savedRevisionRef.current) { setSaveState("saved"); return true; }
    setSaveState("saving");
    try {
      const saved = await client.projects.replace(currentProject.id, parsed.data);
      savedRevisionRef.current = targetRevision;
      setProject(saved);
      if (revisionRef.current === targetRevision) {
        const savedDraft = draftFromProject(saved);
        setDraft(savedDraft);
        draftRef.current = savedDraft;
        setSaveState("saved");
        setNotice("All changes saved.");
        setProjects(await client.projects.list());
      } else {
        setSaveState("unsaved");
      }
      return true;
    } catch (error) {
      setSaveState("failed");
      setErrors([message(error)]);
      return false;
    }
  }, [client, project]);

  const saveNow = useCallback(() => {
    clearAutosave();
    const run = () => performSave();
    saveQueueRef.current = saveQueueRef.current.then(run, run);
    return saveQueueRef.current;
  }, [clearAutosave, performSave]);

  saveNowRef.current = saveNow;

  useEffect(() => () => clearAutosave(), [clearAutosave]);

  useEffect(() => {
    if (!draft) return;
    const revision = ++analysisRevisionRef.current;
    const persistReconciliation = revisionRef.current > savedRevisionRef.current;
    setAnalysisState("parsing");
    const timer = window.setTimeout(() => {
      const entries = materializeLexicon([...globalLexicon, ...draft.lexiconEntries], "g05-analysis");
      void analyzer.analyze({
        source: draft.scriptSource,
        entries,
        paragraphPause: draft.paragraphPause,
        ...(ignoredDiagnostics.length > 0 ? { ignoredDiagnostics } : {})
      }).then((result) => {
        if (revision !== analysisRevisionRef.current) return;
        const currentDraft = draftRef.current;
        if (!currentDraft) return;
        const reconciled = reconcileDiscoveredConfiguration({ parseResult: result.parseResult, speakerMappings: currentDraft.speakerMappings, pausePresets: currentDraft.pausePresets });
        setAnalysis(result);
        setConfiguration(reconciled);
        setAnalysisState("ready");
        setAnalysisError("");
        setPauseInputs((current) => {
          const next = { ...current };
          for (const pause of reconciled.pauses) if (next[pause.pauseId] === undefined) next[pause.pauseId] = pause.durationMs === null ? "" : `${String(pause.durationMs)} ms`;
          return next;
        });
        const nextSpeakers = reconciled.speakers.map(({ discovered: _discovered, occurrenceCount: _occurrenceCount, ...item }) => item);
        const nextPauses = reconciled.pauses.flatMap(({ durationMs, discovered: _discovered, occurrenceCount: _occurrenceCount, ...item }) => durationMs === null ? [] : [{ ...item, durationMs }]);
        if (!same(currentDraft.speakerMappings, nextSpeakers) || !same(currentDraft.pausePresets, nextPauses)) {
          updateDraft((current) => ({ ...current, speakerMappings: nextSpeakers, pausePresets: nextPauses }), persistReconciliation);
        }
      }).catch((error: unknown) => {
        if (revision === analysisRevisionRef.current) { setAnalysisState("failed"); setAnalysisError(message(error)); }
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [analyzer, draft?.scriptSource, draft?.paragraphPause, draft?.lexiconEntries, globalLexicon, ignoredDiagnostics, updateDraft]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (isDirty) event.preventDefault(); };
    const linkGuard = (event: MouseEvent) => {
      if (!isDirty || !(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      if (!window.confirm("Discard unsaved project changes?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", linkGuard, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", linkGuard, true); };
  }, [isDirty]);

  const dryRun: AuthoringDryRunResult | undefined = useMemo(() => analysis
    ? buildAuthoringDryRun({ parseResult: analysis.parseResult, pacingResult: analysis.pacingResult, transformResult: analysis.transformResult, speakers: configuration.speakers, pauses: configuration.pauses })
    : undefined, [analysis, configuration]);

  const deferredScriptSource = useDeferredValue(draft?.scriptSource ?? "");
  const lineNumbers = useMemo(() => deferredScriptSource.split(/\r?\n/u).map((_line, index) => index + 1).join("\n") || "1", [deferredScriptSource]);
  const cleanedFencedSource = useMemo(() => draft ? stripSingleSurroundingCodeFence(draft.scriptSource) : undefined, [draft?.scriptSource]);

  const sampleResult = useMemo(() => {
    if (!sample.trim()) return undefined;
    const parsed = parseScript({ source: sample, ...(sampleSpeaker ? { defaultSpeakerId: sampleSpeaker } : {}) });
    return transformScript({ parsedScript: parsed, entries: materializeLexicon([...globalLexicon, ...(draft?.lexiconEntries ?? [])], "g05-sample") });
  }, [sample, sampleSpeaker, globalLexicon, draft?.lexiconEntries]);

  const createProject = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await client.projects.create({ name: newName, description: newDescription });
      await reloadProjects();
      setNewName(""); setNewDescription("");
      void navigate(`/projects/${created.id}`);
    } catch (error) { setErrors([message(error)]); } finally { setBusy(false); }
  };

  const chooseProject = (id: string) => {
    if (id === projectId) return;
    if (isDirty && !window.confirm("Discard unsaved project changes?")) return;
    void navigate(`/projects/${id}`);
  };

  const duplicateProject = async () => {
    if (!project || !draft) return;
    if (!await saveNow()) return;
    const name = window.prompt("Name the duplicate project", `${draft.name} copy`)?.trim();
    if (!name) return;
    try {
      const duplicated = await client.projects.duplicate(project.id, { name });
      await reloadProjects();
      void navigate(`/projects/${duplicated.id}`);
    } catch (error) { setErrors([message(error)]); }
  };

  const deleteProject = async () => {
    if (!project || !window.confirm(`Delete ${project.name}? This cannot be undone.`)) return;
    await client.projects.delete(project.id);
    await reloadProjects();
    void navigate("/projects");
  };

  const updatePause = (row: AuthoringPauseRow, value: string) => {
    setPauseInputs((current) => ({ ...current, [row.pauseId]: value }));
    const parsed = parsePauseDuration(value);
    if (!parsed.ok) {
      invalidPauseRef.current = { ...invalidPauseRef.current, [row.pauseId]: parsed.message };
      revisionRef.current += 1;
      clearAutosave();
      setSaveState("invalid");
      return;
    }
    const remaining = { ...invalidPauseRef.current };
    delete remaining[row.pauseId];
    invalidPauseRef.current = remaining;
    updateDraft((current) => {
      const preset = { pauseId: row.pauseId, durationMs: parsed.durationMs, description: row.description };
      const exists = current.pausePresets.some(({ pauseId }) => pauseId === row.pauseId);
      return {
        ...current,
        pausePresets: exists ? current.pausePresets.map((item) => item.pauseId === row.pauseId ? preset : item) : [...current.pausePresets, preset],
        paragraphPause: current.paragraphPause.pauseId === row.pauseId ? { ...current.paragraphPause, durationMs: parsed.durationMs } : current.paragraphPause
      };
    });
  };

  const focusLine = (line: number) => {
    if (!draft || !editorRef.current) return;
    const start = draft.scriptSource.split(/\r?\n/u).slice(0, line - 1).reduce((length, item) => length + item.length + 1, 0);
    editorRef.current.focus();
    editorRef.current.setSelectionRange(start, start);
  };

  const findNext = () => {
    const editor = editorRef.current;
    if (!editor || !draft || !search) return;
    const haystack = caseSensitive ? draft.scriptSource : draft.scriptSource.toLocaleLowerCase();
    const needle = caseSensitive ? search : search.toLocaleLowerCase();
    let index = haystack.indexOf(needle, editor.selectionEnd);
    if (index < 0) index = haystack.indexOf(needle);
    if (index >= 0) { editor.focus(); editor.setSelectionRange(index, index + search.length); }
  };

  const replaceNext = () => {
    const editor = editorRef.current;
    if (!editor || !draft || !search) return;
    const selected = draft.scriptSource.slice(editor.selectionStart, editor.selectionEnd);
    const matches = caseSensitive ? selected === search : selected.toLocaleLowerCase() === search.toLocaleLowerCase();
    if (!matches) { findNext(); return; }
    const start = editor.selectionStart;
    updateDraft((current) => ({ ...current, scriptSource: `${current.scriptSource.slice(0, start)}${replacement}${current.scriptSource.slice(editor.selectionEnd)}` }));
    window.setTimeout(() => { editor.focus(); editor.setSelectionRange(start, start + replacement.length); }, 0);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const source = await readUtf8TextFile(file);
      updateDraft((current) => ({ ...current, scriptSource: source }));
    }
    catch (error) { setErrors([message(error)]); }
  };

  const saveLexicon = async () => {
    const candidate: LexiconEntryAuthoring = { ...lexiconDraft, ...(editingLexicon ? { id: editingLexicon.id } : {}) };
    if (!candidate.displayText.trim() || !candidate.spokenText.trim()) { setErrors(["Display text and spoken text are required."]); return; }
    if (candidate.scope === "global") {
      const next = editingLexicon?.scope === "global"
        ? globalLexicon.map((entry) => entry.id === editingLexicon.id ? candidate : entry)
        : [...globalLexicon, candidate];
      try { setGlobalLexicon(authoringLexicon(await client.globalLexicon.replace(next))); }
      catch (error) { setErrors([message(error)]); return; }
    } else {
      updateDraft((current) => ({ ...current, lexiconEntries: editingLexicon?.scope === "project"
        ? current.lexiconEntries.map((entry) => entry.id === editingLexicon.id ? candidate : entry)
        : [...current.lexiconEntries, candidate] }));
    }
    setLexiconDraft(emptyLexiconDraft); setEditingLexicon(undefined);
  };

  const removeLexicon = async (scope: "global" | "project", id: string | undefined) => {
    if (!id) return;
    if (scope === "global") setGlobalLexicon(authoringLexicon(await client.globalLexicon.replace(globalLexicon.filter((entry) => entry.id !== id))));
    else updateDraft((current) => ({ ...current, lexiconEntries: current.lexiconEntries.filter((entry) => entry.id !== id) }));
  };

  const allLexicon = [...globalLexicon, ...(draft?.lexiconEntries ?? [])];
  const filteredLexicon = allLexicon.filter((entry) =>
    (lexiconScope === "all" || entry.scope === lexiconScope)
    && (lexiconType === "all" || entry.entryType === lexiconType)
    && (!lexiconSearch || `${entry.displayText} ${entry.senseId ?? ""} ${entry.spokenText}`.toLocaleLowerCase().includes(lexiconSearch.toLocaleLowerCase())));

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p className={styles.kicker}>G05 · Deterministic authoring</p><h2>Projects</h2><p>Shape the script, map every discovered cue, then read the narration score before audio exists.</p></div>
        <div className={styles.status} data-state={saveState}><span>{analysisState === "parsing" ? "Parsing" : analysisState === "failed" ? "Parser failed" : dryRun?.status === "ready" ? "Ready to render" : dryRun?.status === "readyWithWarnings" ? "Ready with warnings" : "Blocked by errors"}</span><strong>{saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "invalid" ? "Invalid" : saveState === "failed" ? "Save failed" : "Unsaved"}</strong></div>
      </header>
      {errors.length > 0 ? <div className={styles.alert} role="alert"><strong>Review these items</strong><ul>{errors.map((item) => <li key={item}>{item}</li>)}</ul><button type="button" onClick={() => setErrors([])}>Dismiss</button></div> : null}
      <p className={styles.notice} aria-live="polite">{notice}</p>

      <div className={styles.workspace}>
        <aside className={styles.projectRail} aria-label="Project list">
          <h3>Your projects</h3>
          <label>Project name<input value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
          <label>Description<input value={newDescription} onChange={(event) => setNewDescription(event.target.value)} /></label>
          <button type="button" disabled={busy || !newName.trim()} onClick={() => void createProject()}>Create project</button>
          <div className={styles.projectList}>{projects.length === 0 ? <p>No projects yet. Create the first study guide.</p> : projects.map((item) => <button type="button" className={item.id === projectId ? styles.activeProject : ""} key={item.id} onClick={() => chooseProject(item.id)}><strong>{item.name}</strong><span>{new Date(item.updatedAt).toLocaleString()}</span></button>)}</div>
        </aside>

        {!draft || !project ? <section className={styles.empty}><h3>Start with a project</h3><p>Create a project or choose one from the rail. Speaches can remain offline throughout this workflow.</p></section> : <>
          <main className={styles.editorColumn}>
            <section className={styles.projectIdentity}>
              <label>Project name<input value={draft.name} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Description<input value={draft.description} onChange={(event) => updateDraft((current) => ({ ...current, description: event.target.value }))} /></label>
              <div className={styles.actionRow}><button type="button" onClick={() => void saveNow()} disabled={saveState === "saving"}>Save now</button><button type="button" className={styles.secondary} onClick={() => void duplicateProject()}>Duplicate</button><button type="button" className={styles.danger} onClick={() => void deleteProject()}>Delete</button></div>
            </section>

            <section className={styles.scriptPanel} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void importFile(event.dataTransfer.files[0]); }}>
              <div className={styles.sectionHeading}><div><span>Source</span><h3>Script editor</h3></div><label className={styles.fileButton}>Upload .txt<input type="file" accept=".txt,text/plain" onChange={(event) => void importFile(event.target.files?.[0])} /></label></div>
              <div className={styles.searchBar}><input aria-label="Find text" placeholder="Find literal text" value={search} onChange={(event) => setSearch(event.target.value)} /><input aria-label="Replacement text" placeholder="Replace with" value={replacement} onChange={(event) => setReplacement(event.target.value)} /><label><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />Case sensitive</label><button type="button" onClick={findNext}>Find next</button><button type="button" onClick={replaceNext}>Replace next</button><button type="button" onClick={() => updateDraft((current) => ({ ...current, scriptSource: replaceLiteral(current.scriptSource, search, replacement, caseSensitive) }))}>Replace all</button></div>
              <div className={styles.sourceEditor}><pre aria-hidden="true">{lineNumbers}</pre><textarea ref={editorRef} aria-label="Script source" spellCheck={false} value={draft.scriptSource} onChange={(event) => updateDraft((current) => ({ ...current, scriptSource: event.target.value }))} /></div>
              <div className={styles.sourceActions}><span>{draft.scriptSource.length.toLocaleString()} characters · drop a UTF-8 .txt file anywhere in this panel</span>{cleanedFencedSource !== undefined ? <button type="button" className={styles.secondary} onClick={() => { setCleanupUndo(draft.scriptSource); updateDraft((current) => ({ ...current, scriptSource: cleanedFencedSource })); }}>Remove surrounding code fence</button> : null}{cleanupUndo !== undefined ? <button type="button" className={styles.secondary} onClick={() => { updateDraft((current) => ({ ...current, scriptSource: cleanupUndo })); setCleanupUndo(undefined); }}>Restore fenced source</button> : null}</div>
            </section>
          </main>

          <aside className={styles.configRail} aria-label="Discovered configuration">
            <section><div className={styles.sectionHeading}><div><span>Discovered</span><h3>Speakers</h3></div><b>{configuration.speakers.filter(({ discovered }) => discovered).length}</b></div>{configuration.speakers.map((row) => <article className={!row.discovered ? styles.unused : ""} key={row.speakerId}><header><code>{row.speakerId}</code><span>{row.occurrenceCount} uses{!row.discovered ? " · unused" : ""}</span></header><div className={styles.sourceLinks}>{analysis?.parseResult.discoveries.speakers.find(({ id }) => id === row.speakerId)?.occurrences.map(({ range }, index) => <button type="button" className={styles.sourceLink} key={`${row.speakerId}:${String(index)}`} onClick={() => focusLine(range.start.line)}>Line {range.start.line}</button>)}</div><label>Display name<input value={row.displayName} onChange={(event) => updateDraft((current) => ({ ...current, speakerMappings: current.speakerMappings.map((item) => item.speakerId === row.speakerId ? { ...item, displayName: event.target.value } : item) }))} /></label><label>Raw voice ID<input value={row.voiceId ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, speakerMappings: current.speakerMappings.map((item) => item.speakerId === row.speakerId ? { ...item, voiceId: event.target.value || null } : item) }))} /></label><div className={styles.inlineFields}><label>Speed<input type="number" step="0.05" min="0.01" max="4" value={row.speed} onChange={(event) => updateDraft((current) => ({ ...current, speakerMappings: current.speakerMappings.map((item) => item.speakerId === row.speakerId ? { ...item, speed: Number(event.target.value) } : item) }))} /></label><label>Gain dB<input type="number" min="-60" max="24" value={row.gainDb} onChange={(event) => updateDraft((current) => ({ ...current, speakerMappings: current.speakerMappings.map((item) => item.speakerId === row.speakerId ? { ...item, gainDb: Number(event.target.value) } : item) }))} /></label></div><div className={styles.copyRow}><select aria-label={`Copy settings for ${row.speakerId}`} value={copySource[row.speakerId] ?? ""} onChange={(event) => setCopySource((current) => ({ ...current, [row.speakerId]: event.target.value }))}><option value="">Copy another speaker…</option>{configuration.speakers.filter((item) => item.speakerId !== row.speakerId).map((item) => <option key={item.speakerId} value={item.speakerId}>{item.speakerId}</option>)}</select><button type="button" className={styles.secondary} onClick={() => { const source = draft.speakerMappings.find((item) => item.speakerId === copySource[row.speakerId]); if (source) updateDraft((current) => ({ ...current, speakerMappings: current.speakerMappings.map((item) => item.speakerId === row.speakerId ? { ...source, speakerId: row.speakerId, displayName: item.displayName } : item) })); }}>Copy</button></div></article>)}</section>
            <section><div className={styles.sectionHeading}><div><span>Timing</span><h3>Pauses</h3></div><b>{configuration.pauses.filter(({ discovered }) => discovered).length}</b></div><label className={styles.check}><input type="checkbox" checked={draft.paragraphPause.enabled} onChange={(event) => updateDraft((current) => ({ ...current, paragraphPause: { ...current.paragraphPause, enabled: event.target.checked } }))} />Pause at paragraph breaks</label>{configuration.pauses.map((row) => <article className={!row.discovered ? styles.unused : ""} key={row.pauseId}><header><code>{row.pauseId}</code><span>{row.occurrenceCount} uses{!row.discovered ? " · unused" : ""}</span></header><div className={styles.sourceLinks}>{analysis?.parseResult.discoveries.pauses.find(({ id }) => id === row.pauseId)?.occurrences.map(({ range }, index) => <button type="button" className={styles.sourceLink} key={`${row.pauseId}:${String(index)}`} onClick={() => focusLine(range.start.line)}>Line {range.start.line}</button>)}</div><label>Duration<input aria-invalid={invalidPauseRef.current[row.pauseId] !== undefined} value={pauseInputs[row.pauseId] ?? ""} onChange={(event) => updatePause(row, event.target.value)} /></label>{invalidPauseRef.current[row.pauseId] ? <p className={styles.fieldError}>{invalidPauseRef.current[row.pauseId]}</p> : null}<label>Description<input value={row.description} onChange={(event) => updateDraft((current) => ({ ...current, pausePresets: current.pausePresets.map((item) => item.pauseId === row.pauseId ? { ...item, description: event.target.value } : item) }))} /></label></article>)}</section>
            <section><div className={styles.sectionHeading}><div><span>Outline</span><h3>Sections</h3></div><b>{configuration.sections.length}</b></div>{configuration.sections.length === 0 ? <p>No sections discovered.</p> : configuration.sections.map((section) => <button type="button" className={styles.sectionLink} key={`${section.sourceLine}:${section.title}`} onClick={() => focusLine(section.sourceLine)}><strong>{section.title}</strong><span>Line {section.sourceLine} · {section.speechSegmentCount} speech segments</span></button>)}</section>
          </aside>
        </>}
      </div>

      {draft && project ? <>
        <section className={styles.lexiconPanel}>
          <div className={styles.sectionHeading}><div><span>Pronunciation</span><h3>Persisted lexicon workbench</h3></div><b>{allLexicon.length} entries</b></div>
          <div className={styles.lexiconFilters}><input aria-label="Search lexicon" placeholder="Search terms and replacements" value={lexiconSearch} onChange={(event) => setLexiconSearch(event.target.value)} /><select aria-label="Lexicon scope filter" value={lexiconScope} onChange={(event) => setLexiconScope(event.target.value as typeof lexiconScope)}><option value="all">All scopes</option><option value="global">Global</option><option value="project">Project</option></select><select aria-label="Lexicon type filter" value={lexiconType} onChange={(event) => setLexiconType(event.target.value as typeof lexiconType)}><option value="all">All types</option><option value="exactTerm">Exact terms</option><option value="exactPhrase">Exact phrases</option><option value="namedSense">Named senses</option></select></div>
          <div className={styles.lexiconGrid}><form onSubmit={(event) => { event.preventDefault(); void saveLexicon(); }}><label>Scope<select value={lexiconDraft.scope} onChange={(event) => setLexiconDraft((current) => ({ ...current, scope: event.target.value as "global" | "project" }))}><option value="project">Project</option><option value="global">Global</option></select></label><label>Type<select value={lexiconDraft.entryType} onChange={(event) => setLexiconDraft((current) => ({ ...current, entryType: event.target.value as LexiconEntryAuthoring["entryType"] }))}><option value="exactTerm">Exact term</option><option value="exactPhrase">Exact phrase</option><option value="namedSense">Named sense</option></select></label><label>Display text<input value={lexiconDraft.displayText} onChange={(event) => setLexiconDraft((current) => ({ ...current, displayText: event.target.value }))} /></label>{lexiconDraft.entryType === "namedSense" ? <label>Sense ID<input value={lexiconDraft.senseId ?? ""} onChange={(event) => setLexiconDraft((current) => ({ ...current, senseId: event.target.value }))} /></label> : null}<label>Spoken text<input value={lexiconDraft.spokenText} onChange={(event) => setLexiconDraft((current) => ({ ...current, spokenText: event.target.value }))} /></label><label>Notes<input value={lexiconDraft.notes ?? ""} onChange={(event) => setLexiconDraft((current) => ({ ...current, notes: event.target.value }))} /></label><div className={styles.checks}><label><input type="checkbox" checked={lexiconDraft.caseSensitive ?? true} onChange={(event) => setLexiconDraft((current) => ({ ...current, caseSensitive: event.target.checked }))} />Case sensitive</label><label><input type="checkbox" checked={lexiconDraft.wholeWord ?? true} onChange={(event) => setLexiconDraft((current) => ({ ...current, wholeWord: event.target.checked }))} />Whole word</label><label><input type="checkbox" checked={lexiconDraft.enabled ?? true} onChange={(event) => setLexiconDraft((current) => ({ ...current, enabled: event.target.checked }))} />Enabled</label></div><div className={styles.actionRow}><button type="submit">{editingLexicon ? "Save entry" : "Add entry"}</button>{editingLexicon ? <button type="button" className={styles.secondary} onClick={() => { setEditingLexicon(undefined); setLexiconDraft(emptyLexiconDraft); }}>Cancel</button> : null}</div></form><div className={styles.lexiconEntries}>{filteredLexicon.length === 0 ? <p>No matching lexicon entries.</p> : filteredLexicon.map((entry, index) => { const matches = analysis?.transformResult.matches.filter(({ entryId }) => entryId === entry.id) ?? []; return <article key={entry.id ?? `${entry.scope}-${String(index)}`}><div><strong>{entry.displayText}{entry.senseId ? ` + ${entry.senseId}` : ""}</strong><span>→ {entry.spokenText}</span></div><code>{entry.scope} · {entry.entryType} · {entry.enabled === false ? "disabled" : "enabled"} · {matches.length} matches</code><div className={styles.sourceLinks}>{matches.map((match) => <button type="button" className={styles.sourceLink} key={`${match.entryId}:${String(match.sourceStartOffset)}`} onClick={() => focusLine(match.range.start.line)}>Line {match.range.start.line}:{match.range.start.column}</button>)}</div><div className={styles.actionRow}><button type="button" className={styles.secondary} onClick={() => { setEditingLexicon({ scope: entry.scope, id: entry.id ?? "" }); setLexiconDraft({ ...entry, caseSensitive: entry.caseSensitive ?? true, wholeWord: entry.wholeWord ?? true, priority: entry.priority ?? 0, enabled: entry.enabled ?? true, notes: entry.notes ?? "" }); }}>Edit</button><button type="button" className={styles.secondary} onClick={() => { const next = { ...entry, enabled: !(entry.enabled ?? true) }; if (entry.scope === "global") void client.globalLexicon.replace(globalLexicon.map((item) => item.id === entry.id ? next : item)).then((saved) => setGlobalLexicon(authoringLexicon(saved))); else updateDraft((current) => ({ ...current, lexiconEntries: current.lexiconEntries.map((item) => item.id === entry.id ? next : item) })); }}>{entry.enabled === false ? "Enable" : "Disable"}</button><button type="button" className={styles.danger} onClick={() => void removeLexicon(entry.scope, entry.id)}>Delete</button></div></article>; })}</div></div>
          <div className={styles.sample}><label>Pronunciation test<textarea value={sample} onChange={(event) => setSample(event.target.value)} placeholder="Enter a word, phrase, or sentence." /></label><label>Speaker<select value={sampleSpeaker} onChange={(event) => setSampleSpeaker(event.target.value)}><option value="">System narrator</option>{configuration.speakers.map((row) => <option key={row.speakerId} value={row.speakerId}>{row.displayName} — {row.voiceId || "unmapped"}</option>)}</select></label><div><span>Original</span><p>{sample || "—"}</p><span>Readable</span><p>{sampleResult?.readableTranscript || "—"}</p><span>TTS text</span><p>{sampleResult?.ttsTranscript || "—"}</p></div></div>
        </section>

        <section className={styles.validationPanel}>
          <div className={styles.sectionHeading}><div><span>Offline validation</span><h3>Narration score</h3></div><b>{dryRun?.rows.length ?? 0} ordered rows</b></div>
          {analysisError ? <p className={styles.fieldError}>{analysisError}</p> : null}
          <div className={styles.validationSummary} data-state={dryRun?.status ?? "blocked"}><strong>{analysisState === "parsing" ? "Parsing…" : dryRun?.status === "ready" ? "Ready to render" : dryRun?.status === "readyWithWarnings" ? "Ready with warnings" : "Blocked by errors"}</strong><span>Live model and voice support remains pending until G06. This dry run makes no TTS request.</span></div>
          {dryRun && dryRun.issues.length > 0 ? <ul className={styles.issues}>{dryRun.issues.map((issue, index) => <li data-severity={issue.severity} key={`${issue.code}:${issue.target?.id ?? String(index)}`}><button type="button" onClick={() => issue.line && focusLine(issue.line)}>{issue.code}</button><span>{issue.message}</span></li>)}</ul> : null}
          <div className={styles.score} aria-label="Dry run ordered segment table">{dryRun?.rows.map((row) => <button type="button" className={styles.scoreRow} data-type={row.type} data-valid={row.validationStatus} key={row.rowNumber} onClick={() => focusLine(row.sourceRange.start.line)}><b>{String(row.rowNumber).padStart(2, "0")}</b><span className={styles.scoreType}>{row.type === "pause" ? `${row.origin} pause` : row.type}</span>{row.type === "section" ? <><strong>{row.title}</strong><small>Line {row.sourceRange.start.line}</small></> : row.type === "pause" ? <><strong>{row.pauseId}</strong><small>{row.durationMs === null ? "Missing duration" : `${String(row.durationMs)} ms`}</small></> : <><span className={styles.speakerChip} aria-label={`Speaker ${row.speakerId}. ${row.voiceId ? `Voice ID ${row.voiceId}` : "Voice ID not configured"}`} title={row.voiceId ? `Voice ID: ${row.voiceId}` : "Voice ID not configured"}><span className={styles.speakerLabel} aria-hidden="true">speaker</span><span className={styles.speakerName} aria-hidden="true">{row.speakerId}</span></span><span>{row.originalText}</span><span>{row.readableText}</span><span>{row.ttsText}</span></>}</button>)}</div>
        </section>
      </> : null}
    </div>
  );
}
