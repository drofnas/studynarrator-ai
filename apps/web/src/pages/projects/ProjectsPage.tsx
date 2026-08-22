import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  buildAuthoringDryRun,
  reconcileDiscoveredConfiguration,
  type AuthoringDryRunResult,
  type AuthoringPauseRow,
  type AuthoringSpeakerRow,
  type IgnoredDiagnostic,
  type LexiconEntryAuthoring,
} from "@studynarrator/core";
import {
  ProjectReplaceInputSchema,
  DEFAULT_SYSTEM_TIMING,
  type IgnoredDiagnosticCollection,
  type PersistenceClient,
  type ProjectDetail,
  type ProjectPreviewClient,
  type RenderJob,
  type RenderWaveform,
  type ProjectSummary,
  type SystemTimingConfiguration,
  type VoiceCatalog,
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
  resolveProjectSpeakerVoiceId,
  supportedProjectVoices,
  stripSingleSurroundingCodeFence,
  type ProjectDraft,
} from "@/features/projects/projectAuthoring.js";
import styles from "./ProjectsPage.module.css";
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { VoiceSelect } from "@/features/connections/VoiceSelect.js";
import { presentVoices } from "@/features/connections/voicePresentation.js";
import {
  LexiconEditor,
  type LexiconEditorValue,
} from "@/features/lexicon/LexiconEditor.js";
import { AuditionIcon } from "@/shared/audio/AuditionIcon.js";
import { SharedAudioPlayer } from "@/shared/audio/SharedAudioPlayer.js";
import { useAudioAudition } from "@/shared/audio/useAudioAudition.js";
import { StickyTabBar } from "@/shared/ui/StickyTabBar.js";
import {
  ScriptSourceEditor,
  type ScriptSourceEditorHandle,
} from "@/features/projects/ScriptSourceEditor.js";
import type { RenderProgressClient } from "@/services/renders/renderClient.js";

type SaveState = "saved" | "unsaved" | "saving" | "invalid" | "failed";
type AnalysisState = "idle" | "parsing" | "ready" | "failed";
type VoiceCatalogState = "idle" | "loading" | "ready" | "failed";
type VoiceSelectionState =
  VoiceCatalogState | "modelUnavailable" | "noSupportedVoices";
type ProjectTab = "script" | "settings" | "details" | "render";

const projectTabs: Array<{ id: ProjectTab; label: string }> = [
  { id: "script", label: "Script Editor" },
  { id: "settings", label: "Settings" },
  { id: "details", label: "Details" },
  { id: "render", label: "Render" },
];

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function sameDraft(left: ProjectDraft, right: ProjectDraft): boolean {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.scriptSource === right.scriptSource &&
    left.speakerMappings === right.speakerMappings &&
    left.lexiconEntries === right.lexiconEntries
  );
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "The operation failed.";
}
function diagnosticKey(item: IgnoredDiagnostic): string {
  return `${item.code}\u0000${item.pattern}`;
}
function formatAudioDuration(durationMs: number | null): string {
  if (durationMs === null) return "-";
  const totalSeconds = Math.floor(durationMs / 1_000);
  return `${String(Math.floor(totalSeconds / 60))}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
function countWords(source: string): number {
  const trimmed = source.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}
function ScriptStatistics({
  source,
  label,
}: {
  source: string;
  label: string;
}) {
  return (
    <div className={styles.sourceMetrics} role="group" aria-label={label}>
      <span>{countWords(source).toLocaleString()} words</span>
      <span>{source.length.toLocaleString()} characters</span>
    </div>
  );
}

const terminalRenderStates = new Set<RenderJob["state"]>([
  "complete",
  "failed",
  "canceled",
]);
const renderPhaseLabels: Record<RenderJob["state"], string> = {
  queued: "Queued…",
  validating: "Validating render…",
  synthesizing: "Synthesizing audio…",
  assembling: "Assembling audio…",
  normalizing: "Normalizing audio…",
  encoding: "Encoding MP3…",
  writing_artifacts: "Writing render files…",
  complete: "Render complete",
  failed: "Render failed",
  canceled: "Render canceled",
};

function renderProgressLabel(job: RenderJob): string {
  if (job.state !== "synthesizing" || job.progress.totalChunks === 0)
    return renderPhaseLabels[job.state];
  const current = Math.min(
    job.progress.totalChunks,
    job.progress.completedChunks + 1,
  );
  return `Processing chunk ${String(current)} of ${String(job.progress.totalChunks)}`;
}

export function ProjectsPage({
  client,
  analyzer,
  previewClient,
  renderClient,
}: {
  client: PersistenceClient;
  analyzer: ScriptAnalyzer;
  previewClient: ProjectPreviewClient;
  renderClient?: RenderProgressClient;
}) {
  const connections = useConnections();
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: ProjectTab =
    requestedTab === "settings" ||
    requestedTab === "details" ||
    requestedTab === "render"
      ? requestedTab
      : "script";
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectDetail>();
  const [draft, setDraft] = useState<ProjectDraft>();
  const draftRef = useRef<ProjectDraft | undefined>(undefined);
  const [globalLexicon, setGlobalLexicon] = useState<LexiconEntryAuthoring[]>(
    [],
  );
  const [timing, setTiming] = useState<SystemTimingConfiguration>(
    DEFAULT_SYSTEM_TIMING,
  );
  const [ignoredDiagnostics, setIgnoredDiagnostics] =
    useState<IgnoredDiagnosticCollection>([]);
  const [configuration, setConfiguration] = useState<{
    speakers: AuthoringSpeakerRow[];
    pauses: AuthoringPauseRow[];
    sections: Array<{
      title: string;
      sourceLine: number;
      speechSegmentCount: number;
    }>;
  }>({ speakers: [], pauses: [], sections: [] });
  const [analysis, setAnalysis] = useState<ScriptAnalysisResult>();
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState(
    "Choose a project or create one to begin.",
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [cleanupUndo, setCleanupUndo] = useState<string>();
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog | null>(null);
  const [voiceCatalogState, setVoiceCatalogState] =
    useState<VoiceCatalogState>("idle");
  const {
    audition: segmentAudition,
    play: playSegmentAudition,
    stop: stopSegmentAudition,
  } = useAudioAudition<number>();
  const [previewError, setPreviewError] = useState("");
  const [selectedRenderJob, setSelectedRenderJob] = useState<RenderJob>();
  const [completedRenderJob, setCompletedRenderJob] = useState<RenderJob>();
  const [renderStarting, setRenderStarting] = useState(false);
  const [renderWaveform, setRenderWaveform] = useState<RenderWaveform>();
  const [renderError, setRenderError] = useState("");
  const editorRef = useRef<ScriptSourceEditorHandle>(null);
  const pendingFocusLineRef = useRef<number | undefined>(undefined);
  const tabRefs = useRef<Record<ProjectTab, HTMLButtonElement | null>>({
    script: null,
    settings: null,
    details: null,
    render: null,
  });
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const analysisRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveNowRef = useRef<() => Promise<boolean>>(() =>
    Promise.resolve(false),
  );

  draftRef.current = draft;
  const isDirty =
    saveState === "unsaved" ||
    saveState === "saving" ||
    saveState === "invalid" ||
    saveState === "failed";
  const selectedConnection = connections.connection;
  const effectiveModelId = selectedConnection?.defaultModelId ?? null;
  const voiceCatalogModelId = effectiveModelId ?? GLOBAL_VOICE_CATALOG_MODEL_ID;
  const voiceDefaultId =
    selectedConnection?.defaultVoiceId ?? GLOBAL_VOICE_CATALOG_DEFAULT_VOICE_ID;
  const speechCatalogState = connections.catalog;
  const renderActive =
    renderStarting ||
    Boolean(
      selectedRenderJob && !terminalRenderStates.has(selectedRenderJob.state),
    );

  useEffect(() => {
    if (!selectedConnection?.baseUrl || speechCatalogState.status !== "idle")
      return;
    void connections
      .discover({
        baseUrl: selectedConnection.baseUrl,
        timeoutSeconds: selectedConnection.timeoutSeconds,
        retryCount: selectedConnection.retryCount,
      })
      .catch(() => undefined);
  }, [connections, selectedConnection, speechCatalogState.status]);

  useEffect(() => {
    let active = true;
    setVoiceCatalog(null);
    setVoiceCatalogState("loading");
    void connections
      .getCatalog(voiceCatalogModelId)
      .then((catalog) => {
        if (active) {
          setVoiceCatalog(catalog);
          setVoiceCatalogState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setVoiceCatalog(null);
          setVoiceCatalogState("failed");
        }
      });
    return () => {
      active = false;
    };
  }, [connections, voiceCatalogModelId]);

  const speechModel =
    speechCatalogState?.status === "ready"
      ? speechCatalogState.catalog.models.find(
          ({ modelId }) => modelId === effectiveModelId,
        )
      : undefined;
  const voiceSelectionState: VoiceSelectionState =
    selectedConnection?.configured
      ? speechCatalogState?.status === "failed" ||
        voiceCatalogState === "failed"
        ? "failed"
        : speechCatalogState?.status !== "ready" ||
            voiceCatalogState !== "ready"
          ? "loading"
          : !speechModel
            ? "modelUnavailable"
            : speechModel.voices.length === 0
              ? "noSupportedVoices"
              : "ready"
      : voiceCatalogState;
  const enabledVoices = useMemo(() => {
    if (!voiceCatalog || voiceCatalogState !== "ready") return [];
    if (!selectedConnection?.configured)
      return voiceCatalog.entries.filter(({ enabled }) => enabled);
    if (voiceSelectionState !== "ready" || !speechModel) return [];
    return supportedProjectVoices(voiceCatalog.entries, speechModel.voices);
  }, [
    selectedConnection?.configured,
    speechModel,
    voiceCatalog,
    voiceCatalogState,
    voiceSelectionState,
  ]);
  const presentedEnabledVoices = useMemo(() => {
    const selectableIds = new Set(enabledVoices.map(({ voiceId }) => voiceId));
    return presentVoices(
      speechModel?.voices.filter(({ voiceId }) => selectableIds.has(voiceId)) ??
        [],
      enabledVoices,
    );
  }, [enabledVoices, speechModel]);

  const reloadProjects = useCallback(
    async () => setProjects(await client.projects.list()),
    [client],
  );

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
    void Promise.all([
      client.projects.list(),
      client.globalLexicon.list(),
      client.preferences.getIgnoredDiagnostics(),
      client.settings.getPacing(),
    ])
      .then(([nextProjects, nextGlobal, nextIgnored, nextTiming]) => {
        if (!active) return;
        setProjects(nextProjects);
        setGlobalLexicon(authoringLexicon(nextGlobal));
        setIgnoredDiagnostics(nextIgnored);
        setTiming(nextTiming);
        setBusy(false);
      })
      .catch((error: unknown) => {
        if (active) {
          setErrors([message(error)]);
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (!projectId) {
      clearAutosave();
      setProject(undefined);
      setDraft(undefined);
      draftRef.current = undefined;
      setAnalysis(undefined);
      setConfiguration({ speakers: [], pauses: [], sections: [] });
      setSelectedRenderJob(undefined);
      setCompletedRenderJob(undefined);
      setRenderStarting(false);
      setRenderWaveform(undefined);
      return;
    }
    let active = true;
    setBusy(true);
    void client.projects
      .get(projectId)
      .then((loaded) => {
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
      })
      .catch((error: unknown) => {
        if (active) {
          setErrors([message(error)]);
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [clearAutosave, client, projectId]);

  useEffect(() => {
    if (!projectId || !renderClient) return;
    let active = true;
    setRenderError("");
    void renderClient
      .list(projectId)
      .then((jobs) => {
        if (!active) return;
        setSelectedRenderJob(jobs[0]);
        setCompletedRenderJob(jobs.find(({ state }) => state === "complete"));
      })
      .catch((error: unknown) => {
        if (active) setRenderError(message(error));
      });
    return () => {
      active = false;
    };
  }, [projectId, renderClient]);

  const activeRenderId =
    selectedRenderJob &&
    selectedRenderJob.projectId === projectId &&
    !terminalRenderStates.has(selectedRenderJob.state)
      ? selectedRenderJob.id
      : undefined;

  useEffect(() => {
    if (!renderClient || !activeRenderId) return;
    let active = true;
    const applyJob = (job: RenderJob) => {
      if (!active) return;
      setSelectedRenderJob(job);
      if (job.state === "complete") setCompletedRenderJob(job);
    };

    if (renderClient.subscribe) {
      let reconciled = false;
      const unsubscribe = renderClient.subscribe(
        activeRenderId,
        applyJob,
        () => {
          if (!active || reconciled) return;
          reconciled = true;
          void renderClient
            .get(activeRenderId)
            .then(applyJob)
            .catch((error: unknown) => {
              if (active) setRenderError(message(error));
            });
        },
      );
      return () => {
        active = false;
        unsubscribe();
      };
    }

    let timer: number | undefined;
    const stopPolling = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    timer = window.setInterval(() => {
      void renderClient
        .get(activeRenderId)
        .then((job) => {
          applyJob(job);
          if (terminalRenderStates.has(job.state)) stopPolling();
        })
        .catch((error: unknown) => {
          if (active) setRenderError(message(error));
        });
    }, 500);
    return () => {
      active = false;
      stopPolling();
    };
  }, [activeRenderId, renderClient]);

  useEffect(() => {
    if (!renderClient || !completedRenderJob) {
      setRenderWaveform(undefined);
      return;
    }
    let active = true;
    setRenderWaveform(undefined);
    void renderClient
      .getWaveform(completedRenderJob.id)
      .then((waveform) => {
        if (active) setRenderWaveform(waveform);
      })
      .catch((error: unknown) => {
        if (active) setRenderError(message(error));
      });
    return () => {
      active = false;
    };
  }, [completedRenderJob, renderClient]);

  const updateDraft = useCallback(
    (updater: (current: ProjectDraft) => ProjectDraft, autosave = true) => {
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
    },
    [clearAutosave, scheduleAutosave],
  );

  const updateSpeaker = useCallback(
    (
      speakerId: string,
      patch: Partial<
        Pick<
          AuthoringSpeakerRow,
          "displayName" | "voiceId" | "speed" | "gainDb"
        >
      >,
    ) => {
      setConfiguration((current) => ({
        ...current,
        speakers: current.speakers.map((item) =>
          item.speakerId === speakerId ? { ...item, ...patch } : item,
        ),
      }));
      updateDraft((current) => ({
        ...current,
        speakerMappings: current.speakerMappings.map((item) =>
          item.speakerId === speakerId ? { ...item, ...patch } : item,
        ),
      }));
    },
    [updateDraft],
  );

  useEffect(() => {
    if (
      voiceSelectionState !== "ready" ||
      enabledVoices.length === 0 ||
      configuration.speakers.length === 0
    )
      return;
    const replacements = new Map(
      configuration.speakers.map((speaker) => [
        speaker.speakerId,
        resolveProjectSpeakerVoiceId(
          speaker.voiceId,
          voiceDefaultId,
          enabledVoices,
        ),
      ]),
    );
    if (
      !configuration.speakers.some(
        (speaker) => replacements.get(speaker.speakerId) !== speaker.voiceId,
      )
    )
      return;
    setConfiguration((current) => ({
      ...current,
      speakers: current.speakers.map((speaker) => ({
        ...speaker,
        voiceId: replacements.get(speaker.speakerId) ?? speaker.voiceId,
      })),
    }));
    updateDraft((current) => ({
      ...current,
      speakerMappings: current.speakerMappings.map((speaker) => ({
        ...speaker,
        voiceId: replacements.get(speaker.speakerId) ?? speaker.voiceId,
      })),
    }));
  }, [
    configuration.speakers,
    enabledVoices,
    updateDraft,
    voiceDefaultId,
    voiceSelectionState,
  ]);

  const performSave = useCallback(async (): Promise<boolean> => {
    const current = draftRef.current;
    const currentProject = project;
    if (!current || !currentProject) return false;
    const parsed = ProjectReplaceInputSchema.safeParse(current);
    if (!parsed.success) {
      setSaveState("invalid");
      setErrors(
        parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "$"}: ${issue.message}`,
        ),
      );
      return false;
    }
    const targetRevision = revisionRef.current;
    if (targetRevision <= savedRevisionRef.current) {
      setSaveState("saved");
      return true;
    }
    setSaveState("saving");
    try {
      const saved = await client.projects.replace(
        currentProject.id,
        parsed.data,
      );
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
    stopSegmentAudition();
    setPreviewError("");
  }, [project?.id, stopSegmentAudition]);

  useEffect(() => {
    if (!draft) return;
    const revision = ++analysisRevisionRef.current;
    const persistReconciliation =
      revisionRef.current > savedRevisionRef.current;
    setAnalysisState("parsing");
    const timer = window.setTimeout(() => {
      const entries = materializeLexicon(
        [...globalLexicon, ...draft.lexiconEntries],
        "analysis",
      );
      void analyzer
        .analyze({
          source: draft.scriptSource,
          entries,
          paragraphPause: paragraphPauseForAnalysis(timing),
          ...(ignoredDiagnostics.length > 0 ? { ignoredDiagnostics } : {}),
        })
        .then((result) => {
          if (revision !== analysisRevisionRef.current) return;
          const currentDraft = draftRef.current;
          if (!currentDraft) return;
          const reconciled = reconcileDiscoveredConfiguration({
            parseResult: result.parseResult,
            speakerMappings: currentDraft.speakerMappings,
            pausePresets: timing.pausePresets,
          });
          setAnalysis(result);
          setConfiguration(reconciled);
          setAnalysisState("ready");
          setAnalysisError("");
          const nextSpeakers = reconciled.speakers.map(
            ({
              discovered: _discovered,
              occurrenceCount: _occurrenceCount,
              ...item
            }) => item,
          );
          if (!same(currentDraft.speakerMappings, nextSpeakers)) {
            updateDraft(
              (current) => ({ ...current, speakerMappings: nextSpeakers }),
              persistReconciliation,
            );
          }
        })
        .catch((error: unknown) => {
          if (revision === analysisRevisionRef.current) {
            setAnalysisState("failed");
            setAnalysisError(message(error));
          }
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    analyzer,
    draft?.scriptSource,
    draft?.lexiconEntries,
    globalLexicon,
    ignoredDiagnostics,
    timing,
    updateDraft,
  ]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty) event.preventDefault();
    };
    const linkGuard = (event: MouseEvent) => {
      if (
        !isDirty ||
        !(event.target instanceof Element) ||
        !event.target.closest("a[href]")
      )
        return;
      if (!window.confirm("Discard unsaved project changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", linkGuard, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", linkGuard, true);
    };
  }, [isDirty]);

  const dryRun: AuthoringDryRunResult | undefined = useMemo(
    () =>
      analysis
        ? buildAuthoringDryRun({
            parseResult: analysis.parseResult,
            pacingResult: analysis.pacingResult,
            transformResult: analysis.transformResult,
            speakers: configuration.speakers,
            pauses: configuration.pauses,
          })
        : undefined,
    [analysis, configuration],
  );

  const cleanedFencedSource = useMemo(
    () =>
      draft ? stripSingleSurroundingCodeFence(draft.scriptSource) : undefined,
    [draft?.scriptSource],
  );

  const createProject = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await client.projects.create({
        name: newName,
        description: newDescription,
      });
      await reloadProjects();
      setNewName("");
      setNewDescription("");
      setNewProjectOpen(false);
      void navigate(`/projects/${created.id}`);
    } catch (error) {
      setErrors([message(error)]);
    } finally {
      setBusy(false);
    }
  };

  const duplicateProject = async () => {
    if (!project || !draft) return;
    if (!(await saveNow())) return;
    const name = window
      .prompt("Name the duplicate project", `${draft.name} copy`)
      ?.trim();
    if (!name) return;
    try {
      const duplicated = await client.projects.duplicate(project.id, { name });
      await reloadProjects();
      void navigate(`/projects/${duplicated.id}`);
    } catch (error) {
      setErrors([message(error)]);
    }
  };

  const deleteProject = async () => {
    if (
      !project ||
      !window.confirm(`Delete ${project.name}? This cannot be undone.`)
    )
      return;
    await client.projects.delete(project.id);
    await reloadProjects();
    void navigate("/projects");
  };

  const selectTab = (tab: ProjectTab, focus = false) => {
    setSearchParams(tab === "script" ? {} : { tab });
    if (focus) window.setTimeout(() => tabRefs.current[tab]?.focus(), 0);
  };

  const moveTabFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: ProjectTab,
  ) => {
    const index = projectTabs.findIndex(({ id }) => id === tab);
    const destination =
      event.key === "ArrowRight"
        ? projectTabs[(index + 1) % projectTabs.length]?.id
        : event.key === "ArrowLeft"
          ? projectTabs[(index - 1 + projectTabs.length) % projectTabs.length]
              ?.id
          : event.key === "Home"
            ? projectTabs[0]?.id
            : event.key === "End"
              ? projectTabs.at(-1)?.id
              : undefined;
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
      const start = draft.scriptSource
        .split(/\r?\n/u)
        .slice(0, line - 1)
        .reduce((length, item) => length + item.length + 1, 0);
      editor.focus();
      editor.setSelection(start, start, { scrollIntoView: true });
    }, 0);
  }, [activeTab, draft]);

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
        notes: "" as const,
      })),
    }));
    return true;
  };

  const replaceIgnoredDiagnostics = async (
    next: IgnoredDiagnosticCollection,
    successMessage: string,
  ) => {
    try {
      setIgnoredDiagnostics(
        await client.preferences.replaceIgnoredDiagnostics(next),
      );
      setNotice(successMessage);
    } catch (error) {
      setErrors([message(error)]);
    }
  };

  const ignoreDiagnostic = async (item: IgnoredDiagnostic) => {
    const key = diagnosticKey(item);
    const next = ignoredDiagnostics.some(
      (candidate) => diagnosticKey(candidate) === key,
    )
      ? ignoredDiagnostics
      : [...ignoredDiagnostics, item];
    await replaceIgnoredDiagnostics(
      next,
      "Diagnostic pattern ignored for every project.",
    );
  };

  const restoreDiagnostic = async (item: IgnoredDiagnostic) => {
    const key = diagnosticKey(item);
    await replaceIgnoredDiagnostics(
      ignoredDiagnostics.filter(
        (candidate) => diagnosticKey(candidate) !== key,
      ),
      "Diagnostic pattern restored.",
    );
  };

  const runPreview = async (nodeOrdinal: number) => {
    if (!project || !(await saveNow())) {
      setPreviewError("Save valid project changes before previewing.");
      return;
    }
    setPreviewError("");
    try {
      await playSegmentAudition(
        nodeOrdinal,
        async (signal) =>
          (
            await previewClient.preview(
              project.id,
              { mode: "segment", nodeOrdinal },
              signal,
            )
          ).audio,
      );
    } catch (error) {
      setPreviewError(message(error));
    }
  };

  const startRender = async () => {
    if (!renderClient || !project) return;
    setRenderStarting(true);
    setRenderError("");
    try {
      if (isDirty && !(await saveNow()))
        throw new Error("Save valid project changes before rendering.");
      const job = await renderClient.startProject(project.id);
      setSelectedRenderJob(job);
      if (job.state === "complete") setCompletedRenderJob(job);
      setNotice("Rendering started.");
    } catch (error) {
      setRenderError(message(error));
    } finally {
      setRenderStarting(false);
    }
  };

  const projectLexicon = draft?.lexiconEntries ?? [];
  const activeDiagnostics: IgnoredDiagnostic[] = analysis
    ? [
        ...analysis.parseResult.errors,
        ...analysis.parseResult.warnings,
        ...analysis.transformResult.errors,
        ...analysis.transformResult.warnings,
      ].map((item) => ({ code: item.code, pattern: item.ignorePattern }))
    : [];
  const activeDiagnosticsByKey = new Map(
    activeDiagnostics.map((item) => [diagnosticKey(item), item]),
  );

  if (!projectId)
    return (
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.kicker}>Project index</p>
            <h2>Projects</h2>
            <p>Open a narration workspace or start a new study guide.</p>
          </div>
          <button
            type="button"
            aria-expanded={newProjectOpen}
            aria-controls="new-project-form"
            onClick={() => setNewProjectOpen((open) => !open)}
          >
            {newProjectOpen ? "Close form" : "New project"}
          </button>
        </header>
        {errors.length > 0 ? (
          <div className={styles.alert} role="alert">
            <strong>Review these items</strong>
            <ul>
              {errors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button type="button" onClick={() => setErrors([])}>
              Dismiss
            </button>
          </div>
        ) : null}
        {newProjectOpen ? (
          <form
            id="new-project-form"
            className={styles.newProjectForm}
            onSubmit={(event) => {
              event.preventDefault();
              void createProject();
            }}
          >
            <div>
              <p className={styles.kicker}>New workspace</p>
              <h3>Create project</h3>
            </div>
            <label>
              Project name
              <input
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <label>
              Description
              <input
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
              />
            </label>
            <div className={styles.actionRow}>
              <button type="submit" disabled={busy || !newName.trim()}>
                Create project
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setNewProjectOpen(false);
                  setNewName("");
                  setNewDescription("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        <section
          className={styles.projectIndex}
          aria-labelledby="project-index-heading"
        >
          <div className={styles.sectionHeading}>
            <div>
              <span>Authoring ledger</span>
              <h3 id="project-index-heading">All projects</h3>
            </div>
            <b>{projects.length}</b>
          </div>
          <div className={styles.projectTableScroll} tabIndex={0}>
            <table className={styles.projectTable}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Description</th>
                  <th scope="col">Script Lines</th>
                  <th scope="col">Audio Length</th>
                </tr>
              </thead>
              <tbody>
                {busy ? (
                  <tr>
                    <td colSpan={4}>Loading projects…</td>
                  </tr>
                ) : projects.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      No projects yet. Create the first study guide.
                    </td>
                  </tr>
                ) : (
                  projects.map((item) => (
                    <tr className={styles.projectRow} key={item.id}>
                      <th scope="row">
                        <Link
                          className={styles.projectLink}
                          to={`/projects/${item.id}`}
                        >
                          {item.name}
                        </Link>
                      </th>
                      <td>{item.description || "-"}</td>
                      <td>{item.scriptLineCount?.toLocaleString() ?? "-"}</td>
                      <td>{formatAudioDuration(item.audioDurationMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to="/projects">
        ← Back to Projects
      </Link>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.kicker}>Project workspace</p>
          <h2>Project details</h2>
          <p>
            Shape the script, assign voices, inspect the narration score, then
            render and listen.
          </p>
        </div>
      </header>
      {errors.length > 0 ? (
        <div className={styles.alert} role="alert">
          <strong>Review these items</strong>
          <ul>
            {errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setErrors([])}>
            Dismiss
          </button>
        </div>
      ) : null}
      <p className={styles.notice} aria-live="polite">
        {notice}
      </p>

      {draft && project ? (
        <>
          <section
            className={styles.projectIdentity}
            aria-label="Project details"
          >
            <label>
              Project name
              <input
                value={draft.name}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Description
              <input
                value={draft.description}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <div className={styles.projectActions}>
              <div className={styles.actionRow}>
                <button type="button" onClick={() => void saveNow()}>
                  Save now
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void duplicateProject()}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => void deleteProject()}
                >
                  Delete
                </button>
              </div>
            </div>
          </section>
          <StickyTabBar label="Project workspace">
            {projectTabs.map(({ id, label }) => (
              <button
                ref={(element) => {
                  tabRefs.current[id] = element;
                }}
                type="button"
                role="tab"
                id={`project-tab-${id}`}
                aria-controls={`project-panel-${id}`}
                aria-selected={activeTab === id}
                tabIndex={activeTab === id ? 0 : -1}
                key={id}
                onClick={() => selectTab(id)}
                onKeyDown={(event) => moveTabFocus(event, id)}
              >
                {label}
              </button>
            ))}
          </StickyTabBar>
        </>
      ) : null}

      <div
        className={styles.tabPanel}
        role={draft && project ? "tabpanel" : undefined}
        id={draft && project ? `project-panel-${activeTab}` : undefined}
        aria-labelledby={
          draft && project ? `project-tab-${activeTab}` : undefined
        }
      >
        <div className={styles.workspace}>
          {!draft || !project ? (
            <section className={styles.empty}>
              <h3>{busy ? "Loading project" : "Project unavailable"}</h3>
              <p>
                {busy
                  ? "Opening the saved project workspace…"
                  : "Return to the project index and choose another project."}
              </p>
            </section>
          ) : (
            <>
              {activeTab === "script" ? (
                <main className={styles.editorColumn}>
                  {activeTab === "script" ? (
                    <section className={styles.scriptPanel}>
                      <div className={styles.sectionHeading}>
                        <div>
                          <span>Source</span>
                          <h3>Script editor</h3>
                        </div>
                        <ScriptStatistics
                          source={draft.scriptSource}
                          label="Script statistics above editor"
                        />
                      </div>
                      <div
                        className={styles.panelScrollBody}
                        role="region"
                        aria-label="Script editor content"
                        tabIndex={0}
                      >
                        <ScriptSourceEditor
                          ref={editorRef}
                          value={draft.scriptSource}
                          onChange={(scriptSource) =>
                            updateDraft((current) => ({
                              ...current,
                              scriptSource,
                            }))
                          }
                        />
                        <div className={styles.sourceActions}>
                          <ScriptStatistics
                            source={draft.scriptSource}
                            label="Script statistics below editor"
                          />
                          {cleanedFencedSource !== undefined ? (
                            <button
                              type="button"
                              className={styles.secondary}
                              onClick={() => {
                                setCleanupUndo(draft.scriptSource);
                                updateDraft((current) => ({
                                  ...current,
                                  scriptSource: cleanedFencedSource,
                                }));
                              }}
                            >
                              Remove surrounding code fence
                            </button>
                          ) : null}
                          {cleanupUndo !== undefined ? (
                            <button
                              type="button"
                              className={styles.secondary}
                              onClick={() => {
                                updateDraft((current) => ({
                                  ...current,
                                  scriptSource: cleanupUndo,
                                }));
                                setCleanupUndo(undefined);
                              }}
                            >
                              Restore fenced source
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  ) : null}
                </main>
              ) : null}

              {activeTab === "settings" ? (
                <aside
                  className={styles.configRail}
                  aria-label="Project configuration"
                >
                  <section>
                    <div className={styles.sectionHeading}>
                      <div>
                        <span>Discovered</span>
                        <h3>Speakers</h3>
                      </div>
                      <b>
                        {
                          configuration.speakers.filter(
                            ({ discovered }) => discovered,
                          ).length
                        }
                      </b>
                    </div>
                    <div
                      className={styles.speakerTableScroll}
                      role="region"
                      aria-label="Project speakers"
                      tabIndex={0}
                    >
                      <table className={styles.speakerTable}>
                        <thead>
                          <tr>
                            <th scope="col">Name</th>
                            <th scope="col">Voice</th>
                            <th scope="col">Speed</th>
                            <th scope="col">Gain dB</th>
                          </tr>
                        </thead>
                        <tbody>
                          {configuration.speakers.length === 0 ? (
                            <tr>
                              <td colSpan={4}>No speakers discovered.</td>
                            </tr>
                          ) : (
                            configuration.speakers.map((row) => (
                              <tr
                                className={!row.discovered ? styles.unused : ""}
                                key={row.speakerId}
                              >
                                <td>
                                  <input
                                    aria-label={`Name for speaker ${row.speakerId}`}
                                    value={row.displayName}
                                    onChange={(event) =>
                                      updateSpeaker(row.speakerId, {
                                        displayName: event.target.value,
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <VoiceSelect
                                    aria-label={`Voice for speaker ${row.speakerId}`}
                                    disabled={enabledVoices.length === 0}
                                    value={
                                      enabledVoices.some(
                                        ({ voiceId }) =>
                                          voiceId === row.voiceId,
                                      )
                                        ? (row.voiceId ?? "")
                                        : ""
                                    }
                                    voices={presentedEnabledVoices}
                                    emptyOption={
                                      enabledVoices.length === 0
                                        ? voiceSelectionState === "loading"
                                          ? "Loading supported voices…"
                                          : "No supported voices"
                                        : undefined
                                    }
                                    onChange={(voiceId) =>
                                      updateSpeaker(row.speakerId, { voiceId })
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    aria-label={`Speed for speaker ${row.speakerId}`}
                                    type="number"
                                    step="0.05"
                                    min="0.01"
                                    max="4"
                                    value={row.speed}
                                    onChange={(event) =>
                                      updateSpeaker(row.speakerId, {
                                        speed: Number(event.target.value),
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    aria-label={`Gain dB for speaker ${row.speakerId}`}
                                    type="number"
                                    min="-60"
                                    max="24"
                                    value={row.gainDb}
                                    onChange={(event) =>
                                      updateSpeaker(row.speakerId, {
                                        gainDb: Number(event.target.value),
                                      })
                                    }
                                  />
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    {enabledVoices.length === 0 ? (
                      <p className={styles.voiceFieldMessage}>
                        {!selectedConnection?.configured &&
                        voiceSelectionState === "ready"
                          ? "The global voice catalog has no enabled voices."
                          : voiceSelectionState === "failed"
                            ? speechCatalogState?.status === "failed"
                              ? speechCatalogState.error
                              : "The global voice catalog could not be loaded."
                            : voiceSelectionState === "modelUnavailable"
                              ? "The selected model was not reported by Speaches."
                              : voiceSelectionState === "noSupportedVoices"
                                ? "Speaches reported no voices for the selected model."
                                : voiceSelectionState === "ready"
                                  ? "The supported voices are disabled in Settings."
                                  : "Loading the selected model's supported voices."}{" "}
                        {selectedConnection?.baseUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              void connections
                                .discover({
                                  baseUrl: selectedConnection.baseUrl!,
                                  timeoutSeconds:
                                    selectedConnection.timeoutSeconds,
                                  retryCount: selectedConnection.retryCount,
                                })
                                .catch(() => undefined)
                            }
                          >
                            Retry supported voices
                          </button>
                        ) : null}{" "}
                        <button
                          type="button"
                          onClick={() => void navigate("/settings/voices")}
                        >
                          Open Settings
                        </button>
                      </p>
                    ) : null}
                  </section>
                </aside>
              ) : null}
            </>
          )}
        </div>

        {draft && project ? (
          <>
            {activeTab === "settings" ? (
              <section
                className={styles.lexiconPanel}
                aria-labelledby="project-lexicon-heading"
              >
                <div className={styles.sectionHeading}>
                  <div>
                    <span>Project pronunciation</span>
                    <h3 id="project-lexicon-heading">Project lexicon</h3>
                  </div>
                  <b>{projectLexicon.length} entries</b>
                </div>
                <p className={styles.lexiconNote}>
                  Script Text matches complete words regardless of
                  capitalization. These pronunciations apply only to this
                  project.{" "}
                  <Link to="/settings/lexicon">
                    Manage global lexicon in application Settings.
                  </Link>
                </p>
                <LexiconEditor
                  value={projectLexicon.map(
                    ({ id, displayText, spokenText, enabled }) => ({
                      ...(id ? { id } : {}),
                      displayText,
                      spokenText,
                      enabled: enabled ?? true,
                    }),
                  )}
                  onChange={changeProjectLexicon}
                  searchLabel="Search project lexicon"
                  emptyMessage="No matching project lexicon entries."
                  hideSearchWhenEmpty
                />
              </section>
            ) : null}

            {previewError && activeTab === "details" ? (
              <p className={styles.previewError} role="alert">
                {previewError} Your project and preview selection are unchanged.
              </p>
            ) : null}

            {activeTab === "render" ? (
              <section
                className={styles.renderPlansPanel}
                aria-labelledby="render-listen-heading"
              >
                <div className={styles.sectionHeading}>
                  <div>
                    <span>Project audio</span>
                    <h3 id="render-listen-heading">Render and listen</h3>
                  </div>
                  {renderClient ? (
                    <button
                      type="button"
                      disabled={
                        !dryRun || dryRun.status === "blocked" || renderActive
                      }
                      onClick={() => void startRender()}
                    >
                      {renderActive
                        ? "Rendering…"
                        : selectedRenderJob?.state === "failed"
                          ? "Try again"
                          : "Render"}
                    </button>
                  ) : null}
                </div>
                <p>
                  Create your audio, then listen or download it here. The first
                  render may take longer while voice segments are generated;
                  later edits are faster when unchanged segments can be reused.
                </p>
                {renderError ? (
                  <p className={styles.fieldError} role="alert">
                    {renderError}
                  </p>
                ) : null}
                {renderActive ? (
                  <div className={styles.renderProgress} aria-live="polite">
                    <div>
                      <strong>
                        {renderStarting &&
                        (!selectedRenderJob ||
                          terminalRenderStates.has(selectedRenderJob.state))
                          ? "Preparing render…"
                          : selectedRenderJob
                            ? renderProgressLabel(selectedRenderJob)
                            : "Preparing render…"}
                      </strong>
                      {selectedRenderJob &&
                      !terminalRenderStates.has(selectedRenderJob.state) &&
                      selectedRenderJob.progress.totalChunks > 0 ? (
                        <span>
                          {selectedRenderJob.progress.completedChunks.toLocaleString()}{" "}
                          of{" "}
                          {selectedRenderJob.progress.totalChunks.toLocaleString()}{" "}
                          chunks complete
                        </span>
                      ) : null}
                    </div>
                    {selectedRenderJob &&
                    !terminalRenderStates.has(selectedRenderJob.state) &&
                    selectedRenderJob.progress.totalChunks > 0 ? (
                      <progress
                        aria-label="Render chunk progress"
                        max={selectedRenderJob.progress.totalChunks}
                        value={selectedRenderJob.progress.completedChunks}
                      >
                        {Math.floor(
                          (selectedRenderJob.progress.completedChunks /
                            selectedRenderJob.progress.totalChunks) *
                            100,
                        )}
                        %
                      </progress>
                    ) : (
                      <progress aria-label="Render chunk progress">
                        Preparing render
                      </progress>
                    )}
                  </div>
                ) : null}
                {selectedRenderJob?.error ? (
                  <p className={styles.fieldError} role="alert">
                    {selectedRenderJob.error.message}
                  </p>
                ) : null}
                {renderClient && completedRenderJob ? (
                  <div className={styles.renderResult}>
                    <SharedAudioPlayer
                      label="Completed project render"
                      src={renderClient.renderAudioSource(
                        completedRenderJob.id,
                      )}
                      disabled={renderActive}
                      {...(renderWaveform ? { waveform: renderWaveform } : {})}
                    />
                    <div className={styles.renderDownloads}>
                      <button
                        type="button"
                        className={styles.textLinkButton}
                        disabled={renderActive}
                        onClick={() =>
                          void renderClient
                            .exportDetails(completedRenderJob.id)
                            .catch((error: unknown) =>
                              setRenderError(message(error)),
                            )
                        }
                      >
                        Download Details
                      </button>
                      <button
                        type="button"
                        disabled={renderActive}
                        onClick={() =>
                          void renderClient
                            .exportAudio(completedRenderJob.id)
                            .catch((error: unknown) =>
                              setRenderError(message(error)),
                            )
                        }
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "details" ? (
              <section className={styles.validationPanel}>
                <div className={styles.sectionHeading}>
                  <div>
                    <span>Offline validation</span>
                    <h3>Narration score</h3>
                  </div>
                  <b>{dryRun?.rows.length ?? 0} ordered rows</b>
                </div>
                <div
                  className={`${styles.panelScrollBody} ${styles.detailsBody}`}
                  role="region"
                  aria-label="Narration score content"
                  tabIndex={0}
                >
                  {analysisError ? (
                    <p className={styles.fieldError}>{analysisError}</p>
                  ) : null}
                  <div
                    className={styles.validationSummary}
                    data-state={dryRun?.status ?? "blocked"}
                  >
                    <strong>
                      {analysisState === "parsing"
                        ? "Parsing…"
                        : dryRun?.status === "ready"
                          ? "Ready to render"
                          : dryRun?.status === "readyWithWarnings"
                            ? "Ready with warnings"
                            : "Blocked by errors"}
                    </strong>
                    <span>
                      Connection availability is shown separately. This
                      deterministic dry run still makes no TTS request.
                    </span>
                  </div>
                  {dryRun && dryRun.issues.length > 0 ? (
                    <ul className={styles.issues}>
                      {dryRun.issues.map((issue, index) => {
                        const diagnostic = issue.target
                          ? activeDiagnosticsByKey.get(
                              diagnosticKey({
                                code: issue.code,
                                pattern: issue.target.id,
                              }),
                            )
                          : undefined;
                        return (
                          <li
                            data-severity={issue.severity}
                            key={`${issue.code}:${issue.target?.id ?? String(index)}`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                issue.line && focusLine(issue.line)
                              }
                            >
                              {issue.code}
                            </button>
                            <span>{issue.message}</span>
                            {diagnostic ? (
                              <button
                                type="button"
                                className={styles.secondary}
                                onClick={() =>
                                  void ignoreDiagnostic(diagnostic)
                                }
                              >
                                Ignore this pattern
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {ignoredDiagnostics.length > 0 ? (
                    <section aria-label="Ignored diagnostic patterns">
                      <h4>Ignored diagnostic patterns</h4>
                      <p>
                        These exact diagnostic patterns are suppressed across
                        projects.
                      </p>
                      <ul className={styles.issues}>
                        {ignoredDiagnostics.map((item) => (
                          <li key={diagnosticKey(item)}>
                            <code>{item.code}</code>
                            <span>{item.pattern}</span>
                            <button
                              type="button"
                              className={styles.secondary}
                              onClick={() => void restoreDiagnostic(item)}
                            >
                              Restore this pattern
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  <div
                    className={styles.score}
                    aria-label="Dry run ordered segment table"
                  >
                    <div className={styles.scoreHeader}>
                      <span>#</span>
                      <span>Type</span>
                      <span>Speaker / cue</span>
                      <span>Original</span>
                      <span>Readable</span>
                      <span>TTS text</span>
                      <span>Audio</span>
                    </div>
                    {dryRun?.rows.map((row) => (
                      <div
                        className={styles.scoreRow}
                        data-type={row.type}
                        data-valid={row.validationStatus}
                        key={row.rowNumber}
                      >
                        <button
                          type="button"
                          className={styles.rowFocus}
                          aria-label={`Focus source line ${String(row.sourceRange.start.line)}`}
                          onClick={() => focusLine(row.sourceRange.start.line)}
                        >
                          {String(row.rowNumber).padStart(2, "0")}
                        </button>
                        <span className={styles.scoreType}>
                          {row.type === "pause"
                            ? `${row.origin} pause`
                            : row.type}
                        </span>
                        {row.type === "section" ? (
                          <>
                            <strong>{row.title}</strong>
                            <small>Line {row.sourceRange.start.line}</small>
                          </>
                        ) : row.type === "pause" ? (
                          <>
                            <strong>{row.pauseId}</strong>
                            <small>
                              {row.durationMs === null
                                ? "Missing duration"
                                : `${String(row.durationMs)} ms`}
                            </small>
                          </>
                        ) : (
                          <>
                            <span
                              className={styles.speakerChip}
                              aria-label={`Speaker ${row.speakerId}. ${row.voiceId ? `Voice ID ${row.voiceId}` : "Voice ID not configured"}`}
                              title={
                                row.voiceId
                                  ? `Voice ID: ${row.voiceId}`
                                  : "Voice ID not configured"
                              }
                            >
                              <span
                                className={styles.speakerLabel}
                                aria-hidden="true"
                              >
                                speaker
                              </span>
                              <span
                                className={styles.speakerName}
                                aria-hidden="true"
                              >
                                {row.speakerId}
                              </span>
                            </span>
                            <span>{row.originalText}</span>
                            <span>{row.readableText}</span>
                            <span>{row.ttsText}</span>
                            {row.validationStatus === "valid" ? (
                              (() => {
                                const phase =
                                  segmentAudition?.key === row.nodeOrdinal
                                    ? segmentAudition.phase
                                    : "normal";
                                const action =
                                  phase === "processing"
                                    ? "Preparing"
                                    : phase === "playing"
                                      ? "Playing"
                                      : "Play";
                                return (
                                  <button
                                    type="button"
                                    className={styles.previewButton}
                                    data-state={phase}
                                    aria-label={`${action} narration row ${String(row.rowNumber)}`}
                                    onClick={() =>
                                      void runPreview(row.nodeOrdinal)
                                    }
                                  >
                                    <AuditionIcon phase={phase} />
                                  </button>
                                );
                              })()
                            ) : (
                              <span className={styles.previewUnavailable}>
                                Unavailable
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
