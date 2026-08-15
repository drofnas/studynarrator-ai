import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  buildAuthoringDryRun,
  reconcileDiscoveredConfiguration,
  type AuthoringDryRunResult,
  type AuthoringPauseRow,
  type AuthoringSpeakerRow,
  type IgnoredDiagnostic,
  type LexiconEntryAuthoring
} from "@studynarrator/core";
import {
  ProjectReplaceInputSchema,
  DEFAULT_SYSTEM_TIMING,
  type IgnoredDiagnosticCollection,
  type PersistenceClient,
  type ProjectDetail,
  type ProjectPreviewClient,
  type ProjectPreviewResult,
  type RenderPlan,
  type RenderPlanClient,
  type RenderPlanSummary,
  type RenderClient,
  type RenderJob,
  type ProjectSummary,
  type SystemTimingConfiguration,
  type VoiceCatalog
} from "@studynarrator/shared-types";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import type { ScriptAnalysisResult } from "@/workers/parser/parserWorkerProtocol.js";
import {
  authoringLexicon,
  draftFromProject,
  GLOBAL_VOICE_CATALOG_DEFAULT_VOICE_ID,
  GLOBAL_VOICE_CATALOG_MODEL_ID,
  materializeLexicon,
  paragraphPauseForAnalysis,
  readUtf8TextFile,
  replaceLiteral,
  resolveProjectSpeakerVoiceId,
  supportedProjectVoices,
  stripSingleSurroundingCodeFence,
  type ProjectDraft
} from "@/features/projects/projectAuthoring.js";
import styles from "./ProjectsPage.module.css";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { VoiceSelect } from "@/features/connections/VoiceSelect.js";
import { presentVoices } from "@/features/connections/voicePresentation.js";
import { LexiconEditor, type LexiconEditorValue } from "@/features/lexicon/LexiconEditor.js";
import { PreviewResultCard } from "@/features/preview/PreviewResultCard.js";
import { RenderHistory } from "@/features/renders/RenderHistory.js";

type SaveState = "saved" | "unsaved" | "saving" | "invalid" | "failed";
type AnalysisState = "idle" | "parsing" | "ready" | "failed";
type VoiceCatalogState = "idle" | "loading" | "ready" | "failed";
type VoiceSelectionState = VoiceCatalogState | "modelUnavailable" | "noSupportedVoices";
type ProjectTab = "script" | "settings" | "details" | "render";

const projectTabs: Array<{ id: ProjectTab; label: string }> = [
  { id: "script", label: "Script Editor" },
  { id: "settings", label: "Settings" },
  { id: "details", label: "Details" },
  { id: "render", label: "Render" }
];

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function sameDraft(left: ProjectDraft, right: ProjectDraft): boolean {
  return left.name === right.name
    && left.description === right.description
    && left.scriptSource === right.scriptSource
    && left.speakerMappings === right.speakerMappings
    && left.lexiconEntries === right.lexiconEntries;
}
function message(error: unknown): string { return error instanceof Error ? error.message : "The operation failed."; }
function diagnosticKey(item: IgnoredDiagnostic): string { return `${item.code}\u0000${item.pattern}`; }

export function ProjectsPage({ client, analyzer, previewClient, renderPlanClient, renderClient }: {
  client: PersistenceClient;
  analyzer: ScriptAnalyzer;
  previewClient: ProjectPreviewClient;
  renderPlanClient: RenderPlanClient;
  renderClient?: RenderClient;
}) {
  const connections = useConnections();
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: ProjectTab = requestedTab === "settings" || requestedTab === "details" || requestedTab === "render" ? requestedTab : "script";
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectDetail>();
  const [draft, setDraft] = useState<ProjectDraft>();
  const draftRef = useRef<ProjectDraft | undefined>(undefined);
  const [globalLexicon, setGlobalLexicon] = useState<LexiconEntryAuthoring[]>([]);
  const [timing, setTiming] = useState<SystemTimingConfiguration>(DEFAULT_SYSTEM_TIMING);
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
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [cleanupUndo, setCleanupUndo] = useState<string>();
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog | null>(null);
  const [voiceCatalogState, setVoiceCatalogState] = useState<VoiceCatalogState>("idle");
  const [previewResult, setPreviewResult] = useState<ProjectPreviewResult>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [renderPlanSummaries, setRenderPlanSummaries] = useState<RenderPlanSummary[]>([]);
  const [selectedRenderPlan, setSelectedRenderPlan] = useState<RenderPlan>();
  const [renderPlanBusy, setRenderPlanBusy] = useState(false);
  const [renderPlanError, setRenderPlanError] = useState("");
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const [selectedRenderJob, setSelectedRenderJob] = useState<RenderJob>();
  const [renderError, setRenderError] = useState("");
  const previewControllerRef = useRef<AbortController | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const pendingFocusLineRef = useRef<number | undefined>(undefined);
  const tabRefs = useRef<Record<ProjectTab, HTMLButtonElement | null>>({ script: null, settings: null, details: null, render: null });
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const analysisRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveNowRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));

  draftRef.current = draft;
  const isDirty = saveState === "unsaved" || saveState === "saving" || saveState === "invalid" || saveState === "failed";
  const selectedConnection = connections.connection;
  const effectiveModelId = selectedConnection?.defaultModelId ?? null;
  const voiceCatalogModelId = effectiveModelId ?? GLOBAL_VOICE_CATALOG_MODEL_ID;
  const voiceDefaultId = selectedConnection?.defaultVoiceId ?? GLOBAL_VOICE_CATALOG_DEFAULT_VOICE_ID;
  const speechCatalogState = connections.catalog;

  useEffect(() => {
    if (!selectedConnection?.baseUrl || speechCatalogState.status !== "idle") return;
    void connections.discover({ baseUrl: selectedConnection.baseUrl, timeoutSeconds: selectedConnection.timeoutSeconds, retryCount: selectedConnection.retryCount }).catch(() => undefined);
  }, [connections, selectedConnection, speechCatalogState.status]);

  useEffect(() => {
    let active = true;
    setVoiceCatalog(null);
    setVoiceCatalogState("loading");
    void connections.getCatalog(voiceCatalogModelId).then((catalog) => {
      if (active) { setVoiceCatalog(catalog); setVoiceCatalogState("ready"); }
    }).catch(() => {
      if (active) { setVoiceCatalog(null); setVoiceCatalogState("failed"); }
    });
    return () => { active = false; };
  }, [connections, voiceCatalogModelId]);

  const speechModel = speechCatalogState?.status === "ready"
    ? speechCatalogState.catalog.models.find(({ modelId }) => modelId === effectiveModelId)
    : undefined;
  const voiceSelectionState: VoiceSelectionState = selectedConnection?.configured
    ? speechCatalogState?.status === "failed" || voiceCatalogState === "failed" ? "failed"
      : speechCatalogState?.status !== "ready" || voiceCatalogState !== "ready" ? "loading"
        : !speechModel ? "modelUnavailable"
          : speechModel.voices.length === 0 ? "noSupportedVoices"
            : "ready"
    : voiceCatalogState;
  const enabledVoices = useMemo(() => {
    if (!voiceCatalog || voiceCatalogState !== "ready") return [];
    if (!selectedConnection?.configured) return voiceCatalog.entries.filter(({ enabled }) => enabled);
    if (voiceSelectionState !== "ready" || !speechModel) return [];
    return supportedProjectVoices(voiceCatalog.entries, speechModel.voices);
  }, [selectedConnection?.configured, speechModel, voiceCatalog, voiceCatalogState, voiceSelectionState]);
  const presentedEnabledVoices = useMemo(() => {
    const selectableIds = new Set(enabledVoices.map(({ voiceId }) => voiceId));
    return presentVoices(speechModel?.voices.filter(({ voiceId }) => selectableIds.has(voiceId)) ?? [], enabledVoices);
  }, [enabledVoices, speechModel]);

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
    void Promise.all([client.projects.list(), client.globalLexicon.list(), client.preferences.getIgnoredDiagnostics(), client.settings.getPacing()])
      .then(([nextProjects, nextGlobal, nextIgnored, nextTiming]) => {
        if (!active) return;
        setProjects(nextProjects);
        setGlobalLexicon(authoringLexicon(nextGlobal));
        setIgnoredDiagnostics(nextIgnored);
        setTiming(nextTiming);
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
      setRenderPlanSummaries([]);
      setSelectedRenderPlan(undefined);
      setRenderJobs([]);
      setSelectedRenderJob(undefined);
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
      setSaveState("saved");
      setNotice(`Opened ${loaded.name}.`);
      setErrors([]);
      setBusy(false);
    }).catch((error: unknown) => { if (active) { setErrors([message(error)]); setBusy(false); } });
    return () => { active = false; };
  }, [clearAutosave, client, projectId]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setRenderPlanError("");
    setSelectedRenderPlan(undefined);
    void renderPlanClient.list(projectId).then((summaries) => {
      if (active) setRenderPlanSummaries(summaries);
    }).catch((error: unknown) => {
      if (active) setRenderPlanError(message(error));
    });
    return () => { active = false; };
  }, [projectId, renderPlanClient]);

  useEffect(() => {
    if (!projectId || !renderClient) return;
    let active = true;
    setRenderError("");
    void renderClient.list(projectId).then((jobs) => {
      if (!active) return;
      setRenderJobs(jobs);
      setSelectedRenderJob(jobs.find(({ state }) => !["complete", "failed", "canceled"].includes(state)) ?? jobs[0]);
    }).catch((error: unknown) => { if (active) setRenderError(message(error)); });
    return () => { active = false; };
  }, [projectId, renderClient]);

  useEffect(() => {
    if (!renderClient || !selectedRenderJob || ["complete", "failed", "canceled"].includes(selectedRenderJob.state)) return;
    let active = true;
    const timer = window.setInterval(() => {
      void renderClient.get(selectedRenderJob.id).then((job) => {
        if (!active) return;
        setSelectedRenderJob(job);
        setRenderJobs((current) => current.map((item) => item.id === job.id ? job : item));
      }).catch((error: unknown) => { if (active) setRenderError(message(error)); });
    }, 500);
    return () => { active = false; window.clearInterval(timer); };
  }, [renderClient, selectedRenderJob]);

  const updateDraft = useCallback((updater: (current: ProjectDraft) => ProjectDraft, autosave = true) => {
    const current = draftRef.current;
    if (!current) return;
    const next = updater(current);
    if (sameDraft(current, next)) return;
    draftRef.current = next;
    setDraft(next);
    if (autosave) {
      revisionRef.current += 1;
      setSaveState("unsaved");
      scheduleAutosave();
    }
  }, [clearAutosave, scheduleAutosave]);

  const updateSpeaker = useCallback((speakerId: string, patch: Partial<Pick<AuthoringSpeakerRow, "displayName" | "voiceId" | "speed" | "gainDb">>) => {
    setConfiguration((current) => ({
      ...current,
      speakers: current.speakers.map((item) => item.speakerId === speakerId ? { ...item, ...patch } : item)
    }));
    updateDraft((current) => ({
      ...current,
      speakerMappings: current.speakerMappings.map((item) => item.speakerId === speakerId ? { ...item, ...patch } : item)
    }));
  }, [updateDraft]);

  useEffect(() => {
    if (voiceSelectionState !== "ready" || enabledVoices.length === 0 || configuration.speakers.length === 0) return;
    const replacements = new Map(configuration.speakers.map((speaker) => [
      speaker.speakerId,
      resolveProjectSpeakerVoiceId(speaker.voiceId, voiceDefaultId, enabledVoices)
    ]));
    if (!configuration.speakers.some((speaker) => replacements.get(speaker.speakerId) !== speaker.voiceId)) return;
    setConfiguration((current) => ({
      ...current,
      speakers: current.speakers.map((speaker) => ({ ...speaker, voiceId: replacements.get(speaker.speakerId) ?? speaker.voiceId }))
    }));
    updateDraft((current) => ({
      ...current,
      speakerMappings: current.speakerMappings.map((speaker) => ({ ...speaker, voiceId: replacements.get(speaker.speakerId) ?? speaker.voiceId }))
    }));
  }, [configuration.speakers, enabledVoices, updateDraft, voiceDefaultId, voiceSelectionState]);

  const performSave = useCallback(async (): Promise<boolean> => {
    const current = draftRef.current;
    const currentProject = project;
    if (!current || !currentProject) return false;
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
    previewControllerRef.current?.abort();
    setPreviewResult(undefined);
    setPreviewError("");
  }, [project?.id]);

  useEffect(() => () => previewControllerRef.current?.abort(), []);

  useEffect(() => {
    if (!draft) return;
    const revision = ++analysisRevisionRef.current;
    const persistReconciliation = revisionRef.current > savedRevisionRef.current;
    setAnalysisState("parsing");
    const timer = window.setTimeout(() => {
      const entries = materializeLexicon([...globalLexicon, ...draft.lexiconEntries], "analysis");
      void analyzer.analyze({
        source: draft.scriptSource,
        entries,
        paragraphPause: paragraphPauseForAnalysis(timing),
        ...(ignoredDiagnostics.length > 0 ? { ignoredDiagnostics } : {})
      }).then((result) => {
        if (revision !== analysisRevisionRef.current) return;
        const currentDraft = draftRef.current;
        if (!currentDraft) return;
        const reconciled = reconcileDiscoveredConfiguration({ parseResult: result.parseResult, speakerMappings: currentDraft.speakerMappings, pausePresets: timing.pausePresets });
        setAnalysis(result);
        setConfiguration(reconciled);
        setAnalysisState("ready");
        setAnalysisError("");
        const nextSpeakers = reconciled.speakers.map(({ discovered: _discovered, occurrenceCount: _occurrenceCount, ...item }) => item);
        if (!same(currentDraft.speakerMappings, nextSpeakers)) {
          updateDraft((current) => ({ ...current, speakerMappings: nextSpeakers }), persistReconciliation);
        }
      }).catch((error: unknown) => {
        if (revision === analysisRevisionRef.current) { setAnalysisState("failed"); setAnalysisError(message(error)); }
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [analyzer, draft?.scriptSource, draft?.lexiconEntries, globalLexicon, ignoredDiagnostics, timing, updateDraft]);

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

  const createProject = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await client.projects.create({ name: newName, description: newDescription });
      await reloadProjects();
      setNewName(""); setNewDescription("");
      setNewProjectOpen(false);
      void navigate(`/projects/${created.id}`);
    } catch (error) { setErrors([message(error)]); } finally { setBusy(false); }
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

  const selectTab = (tab: ProjectTab, focus = false) => {
    setSearchParams(tab === "script" ? {} : { tab });
    if (focus) window.setTimeout(() => tabRefs.current[tab]?.focus(), 0);
  };

  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, tab: ProjectTab) => {
    const index = projectTabs.findIndex(({ id }) => id === tab);
    const destination = event.key === "ArrowRight" ? projectTabs[(index + 1) % projectTabs.length]?.id
      : event.key === "ArrowLeft" ? projectTabs[(index - 1 + projectTabs.length) % projectTabs.length]?.id
        : event.key === "Home" ? projectTabs[0]?.id
          : event.key === "End" ? projectTabs.at(-1)?.id : undefined;
    if (!destination) return;
    event.preventDefault();
    selectTab(destination, true);
  };

  const focusLine = (line: number) => {
    if (!draft) return;
    pendingFocusLineRef.current = line;
    selectTab("script");
  };

  useEffect(() => {
    const line = pendingFocusLineRef.current;
    if (activeTab !== "script" || line === undefined || !draft) return;
    pendingFocusLineRef.current = undefined;
    window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const start = draft.scriptSource.split(/\r?\n/u).slice(0, line - 1).reduce((length, item) => length + item.length + 1, 0);
      editor.focus();
      editor.setSelectionRange(start, start);
    }, 0);
  }, [activeTab, draft]);

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

  const changeProjectLexicon = (value: LexiconEditorValue[]) => {
    updateDraft((current) => ({
      ...current,
      lexiconEntries: value.map((entry) => ({
        ...(entry.id ? { id: entry.id } : {}),
        scope: "project" as const,
        entryType: "exactTerm" as const,
        displayText: entry.displayText,
        spokenText: entry.spokenText,
        caseSensitive: false as const,
        wholeWord: true as const,
        priority: 0 as const,
        enabled: entry.enabled,
        notes: "" as const
      }))
    }));
    return true;
  };

  const replaceIgnoredDiagnostics = async (next: IgnoredDiagnosticCollection, successMessage: string) => {
    try {
      setIgnoredDiagnostics(await client.preferences.replaceIgnoredDiagnostics(next));
      setNotice(successMessage);
    } catch (error) {
      setErrors([message(error)]);
    }
  };

  const ignoreDiagnostic = async (item: IgnoredDiagnostic) => {
    const key = diagnosticKey(item);
    const next = ignoredDiagnostics.some((candidate) => diagnosticKey(candidate) === key)
      ? ignoredDiagnostics
      : [...ignoredDiagnostics, item];
    await replaceIgnoredDiagnostics(next, "Diagnostic pattern ignored for every project.");
  };

  const restoreDiagnostic = async (item: IgnoredDiagnostic) => {
    const key = diagnosticKey(item);
    await replaceIgnoredDiagnostics(
      ignoredDiagnostics.filter((candidate) => diagnosticKey(candidate) !== key),
      "Diagnostic pattern restored."
    );
  };

  const runPreview = async (input: Parameters<ProjectPreviewClient["preview"]>[1]) => {
    if (!project || !await saveNow()) {
      setPreviewError("Save valid project changes before previewing.");
      return;
    }
    previewControllerRef.current?.abort();
    const controller = new AbortController();
    previewControllerRef.current = controller;
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const result = await previewClient.preview(project.id, input, controller.signal);
      if (!controller.signal.aborted) setPreviewResult(result);
    } catch (error) {
      if (!controller.signal.aborted) setPreviewError(message(error));
    } finally {
      if (previewControllerRef.current === controller) { previewControllerRef.current = null; setPreviewBusy(false); }
    }
  };

  const openRenderPlan = async (planId: string) => {
    setRenderPlanBusy(true);
    setRenderPlanError("");
    try {
      setSelectedRenderPlan(await renderPlanClient.get(planId));
    } catch (error) {
      setRenderPlanError(message(error));
    } finally {
      setRenderPlanBusy(false);
    }
  };

  const freezeRenderPlan = async () => {
    if (!project) return;
    setRenderPlanBusy(true);
    setRenderPlanError("");
    try {
      if (!await saveNow()) throw new Error("Save valid project changes before freezing a render plan.");
      const plan = await renderPlanClient.create(project.id);
      setSelectedRenderPlan(plan);
      setRenderPlanSummaries(await renderPlanClient.list(project.id));
      setNotice(`Frozen render plan ${plan.id}. No speech was synthesized.`);
    } catch (error) {
      setRenderPlanError(message(error));
    } finally {
      setRenderPlanBusy(false);
    }
  };

  const startRender = async () => {
    if (!renderClient || !selectedRenderPlan) return;
    setRenderError("");
    try {
      const job = await renderClient.start(selectedRenderPlan.id);
      setSelectedRenderJob(job);
      setRenderJobs((current) => [job, ...current.filter(({ id }) => id !== job.id)]);
      setNotice(`Render ${job.id} entered the queue.`);
    } catch (error) { setRenderError(message(error)); }
  };

  const cancelRender = async () => {
    if (!renderClient || !selectedRenderJob) return;
    try {
      const job = await renderClient.cancel(selectedRenderJob.id);
      setSelectedRenderJob(job);
      setRenderJobs((current) => current.map((item) => item.id === job.id ? job : item));
    }
    catch (error) { setRenderError(message(error)); }
  };

  const retryRender = async () => {
    if (!renderClient || !selectedRenderJob) return;
    try {
      const job = await renderClient.retry(selectedRenderJob.id);
      setSelectedRenderJob(job);
      setRenderJobs((current) => [job, ...current]);
    } catch (error) { setRenderError(message(error)); }
  };

  const rerenderFrozenPlan = async (source: RenderJob) => {
    if (!renderClient) return;
    setRenderError("");
    try {
      const job = await renderClient.start(source.planId);
      setSelectedRenderJob(job);
      setRenderJobs((current) => [job, ...current.filter(({ id }) => id !== job.id)]);
      setNotice(`Started a full rerender from frozen plan ${source.planId}.`);
    } catch (error) { setRenderError(message(error)); }
  };

  const projectLexicon = draft?.lexiconEntries ?? [];
  const activeDiagnostics: IgnoredDiagnostic[] = analysis ? [
    ...analysis.parseResult.errors,
    ...analysis.parseResult.warnings,
    ...analysis.transformResult.errors,
    ...analysis.transformResult.warnings
  ].map((item) => ({ code: item.code, pattern: item.ignorePattern })) : [];
  const activeDiagnosticsByKey = new Map(activeDiagnostics.map((item) => [diagnosticKey(item), item]));

  if (!projectId) return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p className={styles.kicker}>Project index</p><h2>Projects</h2><p>Open a narration workspace or start a new study guide.</p></div>
        <button type="button" aria-expanded={newProjectOpen} aria-controls="new-project-form" onClick={() => setNewProjectOpen((open) => !open)}>{newProjectOpen ? "Close form" : "New project"}</button>
      </header>
      {errors.length > 0 ? <div className={styles.alert} role="alert"><strong>Review these items</strong><ul>{errors.map((item) => <li key={item}>{item}</li>)}</ul><button type="button" onClick={() => setErrors([])}>Dismiss</button></div> : null}
      {newProjectOpen ? <form id="new-project-form" className={styles.newProjectForm} onSubmit={(event) => { event.preventDefault(); void createProject(); }}>
        <div><p className={styles.kicker}>New workspace</p><h3>Create project</h3></div>
        <label>Project name<input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
        <label>Description<input value={newDescription} onChange={(event) => setNewDescription(event.target.value)} /></label>
        <div className={styles.actionRow}><button type="submit" disabled={busy || !newName.trim()}>Create project</button><button type="button" className={styles.secondary} onClick={() => { setNewProjectOpen(false); setNewName(""); setNewDescription(""); }}>Cancel</button></div>
      </form> : null}
      <section className={styles.projectIndex} aria-labelledby="project-index-heading">
        <div className={styles.sectionHeading}><div><span>Authoring ledger</span><h3 id="project-index-heading">All projects</h3></div><b>{projects.length}</b></div>
        <div className={styles.projectTableScroll} tabIndex={0}>
          <table className={styles.projectTable}>
            <thead><tr><th scope="col">Name</th><th scope="col">Description</th><th scope="col">Created</th><th scope="col">Last updated</th><th scope="col"><span className={styles.visuallyHidden}>Open</span></th></tr></thead>
            <tbody>{busy ? <tr><td colSpan={5}>Loading projects…</td></tr> : projects.length === 0 ? <tr><td colSpan={5}>No projects yet. Create the first study guide.</td></tr> : projects.map((item) => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.description || "No description"}</td><td><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></td><td><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time></td><td><Link to={`/projects/${item.id}`}>Open</Link></td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to="/projects">← Back to Projects</Link>
      <header className={styles.pageHeader}>
        <div><p className={styles.kicker}>Project workspace</p><h2>Project details</h2><p>Shape the script, assign voices, inspect the narration score, then render a frozen plan.</p></div>
      </header>
      {errors.length > 0 ? <div className={styles.alert} role="alert"><strong>Review these items</strong><ul>{errors.map((item) => <li key={item}>{item}</li>)}</ul><button type="button" onClick={() => setErrors([])}>Dismiss</button></div> : null}
      <p className={styles.notice} aria-live="polite">{notice}</p>

      {draft && project ? <>
        <section className={styles.projectIdentity} aria-label="Project details">
          <label>Project name<input value={draft.name} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Description<input value={draft.description} onChange={(event) => updateDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          <div className={styles.projectActions}><div className={styles.actionRow}><button type="button" onClick={() => void saveNow()} disabled={saveState === "saving"}>Save now</button><button type="button" className={styles.secondary} onClick={() => void duplicateProject()}>Duplicate</button><button type="button" className={styles.danger} onClick={() => void deleteProject()}>Delete</button></div><span className={styles.saveState} data-state={saveState} aria-live="polite">{saveState === "saved" ? "" : saveState === "saving" ? "Saving…" : saveState === "invalid" ? "Invalid changes" : saveState === "failed" ? "Save failed" : "Unsaved changes"}</span></div>
        </section>
        <div className={styles.tabList} role="tablist" aria-label="Project workspace">
          {projectTabs.map(({ id, label }) => <button ref={(element) => { tabRefs.current[id] = element; }} type="button" role="tab" id={`project-tab-${id}`} aria-controls={`project-panel-${id}`} aria-selected={activeTab === id} tabIndex={activeTab === id ? 0 : -1} key={id} onClick={() => selectTab(id)} onKeyDown={(event) => moveTabFocus(event, id)}>{label}</button>)}
        </div>
      </> : null}

      <div className={styles.tabPanel} role={draft && project ? "tabpanel" : undefined} id={draft && project ? `project-panel-${activeTab}` : undefined} aria-labelledby={draft && project ? `project-tab-${activeTab}` : undefined}>
      <div className={styles.workspace}>
        {!draft || !project ? <section className={styles.empty}><h3>{busy ? "Loading project" : "Project unavailable"}</h3><p>{busy ? "Opening the saved project workspace…" : "Return to the project index and choose another project."}</p></section> : <>
          {activeTab === "script" ? <main className={styles.editorColumn}>
            {activeTab === "script" ? <section className={styles.scriptPanel} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void importFile(event.dataTransfer.files[0]); }}>
              <div className={styles.sectionHeading}><div><span>Source</span><h3>Script editor</h3></div><label className={styles.fileButton}>Upload .txt<input type="file" accept=".txt,text/plain" onChange={(event) => void importFile(event.target.files?.[0])} /></label></div>
              <div className={styles.panelScrollBody} role="region" aria-label="Script editor content" tabIndex={0}>
                <div className={styles.searchBar}><input aria-label="Find text" placeholder="Find literal text" value={search} onChange={(event) => setSearch(event.target.value)} /><input aria-label="Replacement text" placeholder="Replace with" value={replacement} onChange={(event) => setReplacement(event.target.value)} /><label><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />Case sensitive</label><button type="button" onClick={findNext}>Find next</button><button type="button" onClick={replaceNext}>Replace next</button><button type="button" onClick={() => updateDraft((current) => ({ ...current, scriptSource: replaceLiteral(current.scriptSource, search, replacement, caseSensitive) }))}>Replace all</button></div>
                <div className={styles.sourceEditor}><pre aria-hidden="true">{lineNumbers}</pre><textarea ref={editorRef} aria-label="Script source" spellCheck={false} value={draft.scriptSource} onChange={(event) => updateDraft((current) => ({ ...current, scriptSource: event.target.value }))} /></div>
                <div className={styles.sourceActions}><span>{draft.scriptSource.length.toLocaleString()} characters · drop a UTF-8 .txt file anywhere in this panel</span>{cleanedFencedSource !== undefined ? <button type="button" className={styles.secondary} onClick={() => { setCleanupUndo(draft.scriptSource); updateDraft((current) => ({ ...current, scriptSource: cleanedFencedSource })); }}>Remove surrounding code fence</button> : null}{cleanupUndo !== undefined ? <button type="button" className={styles.secondary} onClick={() => { updateDraft((current) => ({ ...current, scriptSource: cleanupUndo })); setCleanupUndo(undefined); }}>Restore fenced source</button> : null}</div>
              </div>
            </section> : null}
          </main> : null}

          {activeTab === "settings" || activeTab === "details" ? <aside className={styles.configRail} aria-label={activeTab === "settings" ? "Project configuration" : "Project outline"}>
            {activeTab === "settings" ? <section>
              <div className={styles.sectionHeading}><div><span>Discovered</span><h3>Speakers</h3></div><b>{configuration.speakers.filter(({ discovered }) => discovered).length}</b></div>
              <div className={styles.speakerTableScroll} role="region" aria-label="Project speakers" tabIndex={0}><table className={styles.speakerTable}>
                <thead><tr><th scope="col">Name</th><th scope="col">Voice</th><th scope="col">Speed</th><th scope="col">Gain dB</th></tr></thead>
                <tbody>{configuration.speakers.length === 0 ? <tr><td colSpan={4}>No speakers discovered.</td></tr> : configuration.speakers.map((row) => <tr className={!row.discovered ? styles.unused : ""} key={row.speakerId}>
                  <td><input aria-label={`Name for speaker ${row.speakerId}`} value={row.displayName} onChange={(event) => updateSpeaker(row.speakerId, { displayName: event.target.value })} /></td>
                  <td><VoiceSelect aria-label={`Voice for speaker ${row.speakerId}`} disabled={enabledVoices.length === 0} value={enabledVoices.some(({ voiceId }) => voiceId === row.voiceId) ? row.voiceId ?? "" : ""} voices={presentedEnabledVoices} emptyOption={enabledVoices.length === 0 ? voiceSelectionState === "loading" ? "Loading supported voices…" : "No supported voices" : undefined} onChange={(voiceId) => updateSpeaker(row.speakerId, { voiceId })} /></td>
                  <td><input aria-label={`Speed for speaker ${row.speakerId}`} type="number" step="0.05" min="0.01" max="4" value={row.speed} onChange={(event) => updateSpeaker(row.speakerId, { speed: Number(event.target.value) })} /></td>
                  <td><input aria-label={`Gain dB for speaker ${row.speakerId}`} type="number" min="-60" max="24" value={row.gainDb} onChange={(event) => updateSpeaker(row.speakerId, { gainDb: Number(event.target.value) })} /></td>
                </tr>)}</tbody>
              </table></div>
              {enabledVoices.length === 0 ? <p className={styles.voiceFieldMessage}>{!selectedConnection?.configured && voiceSelectionState === "ready" ? "The global voice catalog has no enabled voices." : voiceSelectionState === "failed" ? speechCatalogState?.status === "failed" ? speechCatalogState.error : "The global voice catalog could not be loaded." : voiceSelectionState === "modelUnavailable" ? "The selected model was not reported by Speaches." : voiceSelectionState === "noSupportedVoices" ? "Speaches reported no voices for the selected model." : voiceSelectionState === "ready" ? "The supported voices are disabled in Settings." : "Loading the selected model's supported voices."} {selectedConnection?.baseUrl ? <button type="button" onClick={() => void connections.discover({ baseUrl: selectedConnection.baseUrl!, timeoutSeconds: selectedConnection.timeoutSeconds, retryCount: selectedConnection.retryCount }).catch(() => undefined)}>Retry supported voices</button> : null} <button type="button" onClick={() => void navigate("/settings")}>Open Settings</button></p> : null}
            </section> : null}
            {activeTab === "details" ? <section><div className={styles.sectionHeading}><div><span>Outline</span><h3>Sections</h3></div><b>{configuration.sections.length}</b></div>{configuration.sections.length === 0 ? <p>No sections discovered.</p> : configuration.sections.map((section) => <button type="button" className={styles.sectionLink} key={`${section.sourceLine}:${section.title}`} onClick={() => focusLine(section.sourceLine)}><strong>{section.title}</strong><span>Line {section.sourceLine} · {section.speechSegmentCount} speech segments</span></button>)}</section> : null}
          </aside> : null}
        </>}
      </div>

      {draft && project ? <>
        {activeTab === "settings" ? <section className={styles.lexiconPanel} aria-labelledby="project-lexicon-heading">
          <div className={styles.sectionHeading}><div><span>Project pronunciation</span><h3 id="project-lexicon-heading">Project lexicon</h3></div><b>{projectLexicon.length} entries</b></div>
          <p className={styles.lexiconNote}>Script Text matches complete words regardless of capitalization. These pronunciations apply only to this project. <Link to="/settings#global-lexicon">Manage global lexicon in application Settings.</Link></p>
          <LexiconEditor value={projectLexicon.map(({ id, displayText, spokenText, enabled }) => ({ ...(id ? { id } : {}), displayText, spokenText, enabled: enabled ?? true }))} onChange={changeProjectLexicon} searchLabel="Search project lexicon" emptyMessage="No matching project lexicon entries." hideSearchWhenEmpty />
        </section> : null}

        {previewError && activeTab === "details" ? <p className={styles.previewError} role="alert">{previewError} Your project and preview selection are unchanged.</p> : null}
        {previewResult?.mode === "segment" && activeTab === "details" ? <PreviewResultCard result={previewResult} /> : null}

        {activeTab === "render" ? <section className={styles.renderPlansPanel} aria-labelledby="render-plans-heading">
          <div className={styles.sectionHeading}>
            <div><span>Immutable handoff</span><h3 id="render-plans-heading">Frozen render plans</h3></div>
            <button type="button" disabled={renderPlanBusy || !dryRun || dryRun.status === "blocked"} onClick={() => void freezeRenderPlan()}>{renderPlanBusy ? "Freezing…" : "Freeze render plan"}</button>
          </div>
          <p>Capture the saved project, pronunciation rules, connection/model identity, ordered entries, cache predictions, and exact silence without contacting Speaches.</p>
          {renderPlanError ? <p className={styles.fieldError} role="alert">{renderPlanError}</p> : null}
          <div className={styles.renderPlanWorkspace}>
            <div className={styles.renderPlanList} aria-label="Saved render plans">
              {renderPlanSummaries.length === 0 ? <p>No frozen plans yet.</p> : renderPlanSummaries.map((summary) => <button type="button" aria-pressed={selectedRenderPlan?.id === summary.id} key={summary.id} onClick={() => void openRenderPlan(summary.id)}>
                <strong>{new Date(summary.createdAt).toLocaleString()}</strong>
                <span>{summary.scriptHash === project.scriptHash && summary.createdAt >= project.updatedAt ? "Matches current project" : "Frozen from earlier project"}</span>
                <small>{summary.summary.speechCount} speech · {summary.summary.pauseCount} pauses · {summary.summary.cacheHits} predicted hits</small>
              </button>)}
            </div>
            <div className={styles.renderPlanDetail} aria-live="polite">
              {!selectedRenderPlan ? <p>Select a saved plan to inspect its immutable entries.</p> : <>
                <header><div><strong>{selectedRenderPlan.scriptHash === project.scriptHash && selectedRenderPlan.createdAt >= project.updatedAt ? "Matches current project" : "Frozen from earlier project"}</strong><span>{new Date(selectedRenderPlan.createdAt).toLocaleString()}</span></div><code>{selectedRenderPlan.id}</code></header>
                <div className={styles.renderPlanTable} role="table" aria-label="Frozen render plan ordered entries" tabIndex={0}>
                  <div className={styles.renderPlanRow} role="row"><b>#</b><b>Type / origin</b><b>Duration</b><b>Voice</b><b>Transformed text</b><b>Cache</b></div>
                  {selectedRenderPlan.entries.map((entry) => <div className={styles.renderPlanRow} role="row" key={entry.ordinal}>
                    <span>{entry.ordinal}</span>
                    <strong>{entry.type === "pause" ? `${entry.pauseKind} · ${entry.reason}` : entry.type}</strong>
                    <span>{entry.type === "pause" ? `${entry.durationMs} ms` : "—"}</span>
                    <code>{entry.type === "speech" ? entry.voiceId : "—"}</code>
                    <span>{entry.type === "speech" ? entry.ttsText : entry.type === "section" ? entry.title : entry.pauseId ?? "direct duration"}</span>
                    <span data-state={entry.type === "speech" ? entry.chunks[0]?.cacheStatus : undefined}>{entry.type === "speech" ? entry.chunks[0]?.cacheStatus : "—"}</span>
                  </div>)}
                </div>
                {renderClient ? <div className={styles.actionRow}><button type="button" onClick={() => void startRender()}>Render this frozen plan</button></div> : null}
              </>}
            </div>
          </div>
          {renderClient ? <section aria-labelledby="render-execution-heading">
            <div className={styles.sectionHeading}><div><span>Durable worker</span><h4 id="render-execution-heading">Render execution</h4></div><b>{renderJobs.length}</b></div>
            {renderError ? <p className={styles.fieldError} role="alert">{renderError}</p> : null}
            <RenderHistory
              jobs={renderJobs}
              expandedJob={selectedRenderJob}
              client={renderClient}
              onExpand={setSelectedRenderJob}
              onCancel={cancelRender}
              onRetry={retryRender}
              onRerender={rerenderFrozenPlan}
              onSourceLine={focusLine}
              onNotice={setNotice}
              onError={setRenderError}
              voiceCatalog={voiceCatalog}
            />
          </section> : null}
        </section> : null}

        {activeTab === "details" ? <section className={styles.validationPanel}>
          <div className={styles.sectionHeading}><div><span>Offline validation</span><h3>Narration score</h3></div><b>{dryRun?.rows.length ?? 0} ordered rows</b></div>
          <div className={styles.panelScrollBody} role="region" aria-label="Narration score content" tabIndex={0}>
            {analysisError ? <p className={styles.fieldError}>{analysisError}</p> : null}
            <div className={styles.validationSummary} data-state={dryRun?.status ?? "blocked"}><strong>{analysisState === "parsing" ? "Parsing…" : dryRun?.status === "ready" ? "Ready to render" : dryRun?.status === "readyWithWarnings" ? "Ready with warnings" : "Blocked by errors"}</strong><span>Connection availability is shown separately. This deterministic dry run still makes no TTS request.</span></div>
            {dryRun && dryRun.issues.length > 0 ? <ul className={styles.issues}>{dryRun.issues.map((issue, index) => {
              const diagnostic = issue.target ? activeDiagnosticsByKey.get(diagnosticKey({ code: issue.code, pattern: issue.target.id })) : undefined;
              return <li data-severity={issue.severity} key={`${issue.code}:${issue.target?.id ?? String(index)}`}><button type="button" onClick={() => issue.line && focusLine(issue.line)}>{issue.code}</button><span>{issue.message}</span>{diagnostic ? <button type="button" className={styles.secondary} onClick={() => void ignoreDiagnostic(diagnostic)}>Ignore this pattern</button> : null}</li>;
            })}</ul> : null}
            {ignoredDiagnostics.length > 0 ? <section aria-label="Ignored diagnostic patterns"><h4>Ignored diagnostic patterns</h4><p>These exact diagnostic patterns are suppressed across projects.</p><ul className={styles.issues}>{ignoredDiagnostics.map((item) => <li key={diagnosticKey(item)}><code>{item.code}</code><span>{item.pattern}</span><button type="button" className={styles.secondary} onClick={() => void restoreDiagnostic(item)}>Restore this pattern</button></li>)}</ul></section> : null}
            <div className={styles.score} aria-label="Dry run ordered segment table">
              <div className={styles.scoreHeader}><span>#</span><span>Type</span><span>Speaker / cue</span><span>Original</span><span>Readable</span><span>TTS text</span><span>Audio</span></div>
              {dryRun?.rows.map((row) => <div className={styles.scoreRow} data-type={row.type} data-valid={row.validationStatus} key={row.rowNumber}>
                <button type="button" className={styles.rowFocus} aria-label={`Focus source line ${String(row.sourceRange.start.line)}`} onClick={() => focusLine(row.sourceRange.start.line)}>{String(row.rowNumber).padStart(2, "0")}</button>
                <span className={styles.scoreType}>{row.type === "pause" ? `${row.origin} pause` : row.type}</span>
                {row.type === "section" ? <><strong>{row.title}</strong><small>Line {row.sourceRange.start.line}</small></> : row.type === "pause" ? <><strong>{row.pauseId}</strong><small>{row.durationMs === null ? "Missing duration" : `${String(row.durationMs)} ms`}</small></> : <><span className={styles.speakerChip} aria-label={`Speaker ${row.speakerId}. ${row.voiceId ? `Voice ID ${row.voiceId}` : "Voice ID not configured"}`} title={row.voiceId ? `Voice ID: ${row.voiceId}` : "Voice ID not configured"}><span className={styles.speakerLabel} aria-hidden="true">speaker</span><span className={styles.speakerName} aria-hidden="true">{row.speakerId}</span></span><span>{row.originalText}</span><span>{row.readableText}</span><span>{row.ttsText}</span>{row.validationStatus === "valid" ? <button type="button" className={styles.previewButton} disabled={previewBusy} onClick={() => void runPreview({ mode: "segment", nodeOrdinal: row.nodeOrdinal })}>{previewBusy ? "Working…" : "Preview"}</button> : <span className={styles.previewUnavailable}>Unavailable</span>}</>}
              </div>)}
            </div>
          </div>
        </section> : null}
      </> : null}
      </div>
    </div>
  );
}
