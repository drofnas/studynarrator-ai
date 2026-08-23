import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  buildAuthoringDryRun,
  estimateCacheBytes,
  estimateMp3Bytes,
  estimatePeakDiskBytes,
  estimatePlanDurationMs,
  reconcileDiscoveredConfiguration,
  type AuthoringDryRunResult,
  type EstimablePlan,
  type AuthoringPauseRow,
  type AuthoringSpeakerRow,
  type IgnoredDiagnostic,
  type LexiconEntryAuthoring,
} from "@studynarrator/core";
import {
  ProjectReplaceInputSchema,
  DEFAULT_SYSTEM_TIMING,
  RENDER_DISK_HARD_RESERVE_PERCENT,
  RENDER_DISK_SOFT_RESERVE_PERCENT,
  renderDiskSpaceBlockMessage,
  renderDiskSpaceUsableBytes,
  renderDiskSpaceWarningMessage,
  type IgnoredDiagnosticCollection,
  type PersistenceClient,
  type SpeechCatalogDiscoveryInput,
  type ProjectDetail,
  type ProjectPreviewClient,
  type RenderEstimateContextResult,
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
import { useConnections } from "@/features/connections/ConnectionProvider.js";
import { presentVoices } from "@/features/connections/voicePresentation.js";
import type { LexiconEditorValue } from "@/features/lexicon/LexiconEditor.js";
import { useAudioAudition } from "@/shared/audio/useAudioAudition.js";
import type { ScriptSourceEditorHandle } from "@/features/projects/ScriptSourceEditor.js";
import type { RenderProgressClient } from "@/services/renders/renderClient.js";

export interface ProjectsPageProps {
  client: PersistenceClient;
  analyzer: ScriptAnalyzer;
  previewClient: ProjectPreviewClient;
  renderClient?: RenderProgressClient;
}

type SaveState = "saved" | "unsaved" | "saving" | "invalid" | "failed";
type AnalysisState = "idle" | "parsing" | "ready" | "failed";
type VoiceCatalogState = "idle" | "loading" | "ready" | "failed";
type VoiceSelectionState =
  VoiceCatalogState | "modelUnavailable" | "noSupportedVoices";
type EstimateContextState =
  | { status: "loading" }
  | { status: "ready"; value: RenderEstimateContextResult }
  | { status: "unavailable" };
type SegmentAudition = {
  key: number;
  phase: "processing" | "playing";
} | null;
type ProjectTab = "script" | "settings" | "details" | "render";

const RENDER_DISK_SPACE_CHECK_STORAGE_KEY =
  "studynarrator.render.disk-space-check.v1";

function storedDiskSpaceCheckEnabled(): boolean {
  try {
    return (
      window.localStorage.getItem(RENDER_DISK_SPACE_CHECK_STORAGE_KEY) !==
      "false"
    );
  } catch {
    return true;
  }
}

export function storeDiskSpaceCheckEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(
      RENDER_DISK_SPACE_CHECK_STORAGE_KEY,
      String(enabled),
    );
  } catch {
    // The in-memory preference still applies when browser storage is blocked.
  }
}

export const projectTabs: Array<{ id: ProjectTab; label: string }> = [
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
export function message(error: unknown): string {
  return error instanceof Error ? error.message : "The operation failed.";
}
export function diagnosticKey(item: IgnoredDiagnostic): string {
  return `${item.code}\u0000${item.pattern}`;
}
export function formatAudioDuration(durationMs: number | null): string {
  if (durationMs === null) return "-";
  const totalSeconds = Math.floor(durationMs / 1_000);
  return `${String(Math.floor(totalSeconds / 60))}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
export function countWords(source: string): number {
  const trimmed = source.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}
export const terminalRenderStates = new Set<RenderJob["state"]>([
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

export function renderProgressLabel(job: RenderJob): string {
  if (job.state !== "synthesizing" || job.progress.totalChunks === 0)
    return renderPhaseLabels[job.state];
  const current = Math.min(
    job.progress.totalChunks,
    job.progress.completedChunks + 1,
  );
  return `Processing chunk ${String(current)} of ${String(job.progress.totalChunks)}`;
}

export function useProjectsPageController({
  client,
  analyzer,
  previewClient,
  renderClient,
}: ProjectsPageProps) {
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
  const [diskSpaceCheckEnabled, setDiskSpaceCheckEnabled] = useState(
    storedDiskSpaceCheckEnabled,
  );
  const [renderWaveform, setRenderWaveform] = useState<RenderWaveform>();
  const [renderError, setRenderError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [estimateContextState, setEstimateContextState] =
    useState<EstimateContextState>(
      renderClient ? { status: "loading" } : { status: "unavailable" },
    );
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
  const renderStartRevisionRef = useRef(0);
  const renderStartOperationRef = useRef(0);
  const currentRouteProjectIdRef = useRef(projectId);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveNowRef = useRef<() => Promise<boolean>>(() =>
    Promise.resolve(false),
  );

  draftRef.current = draft;
  currentRouteProjectIdRef.current = projectId;
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
    renderStartOperationRef.current += 1;
    setRenderStarting(false);
  }, [projectId]);

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
    const renderStartRevision = renderStartRevisionRef.current;
    setRenderError("");
    void renderClient
      .list(projectId)
      .then((jobs) => {
        if (!active || renderStartRevisionRef.current !== renderStartRevision)
          return;
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

  const toggleCompletedRenderPin = async () => {
    if (!renderClient || !completedRenderJob) return;
    setPinBusy(true);
    setRenderError("");
    try {
      const updated = await renderClient.setPinned(
        completedRenderJob.id,
        !completedRenderJob.pinned,
      );
      setCompletedRenderJob(updated);
      setSelectedRenderJob((current) =>
        current?.id === updated.id ? updated : current,
      );
    } catch (error) {
      setRenderError(message(error));
    } finally {
      setPinBusy(false);
    }
  };

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
      let streamedUpdateRevision = 0;
      const applyStreamedJob = (job: RenderJob) => {
        streamedUpdateRevision += 1;
        applyJob(job);
      };
      const unsubscribe = renderClient.subscribe(
        activeRenderId,
        applyStreamedJob,
        () => {
          if (!active || reconciled) return;
          reconciled = true;
          const reconciliationRevision = streamedUpdateRevision;
          void renderClient
            .get(activeRenderId)
            .then((job) => {
              if (streamedUpdateRevision === reconciliationRevision)
                applyJob(job);
            })
            .catch((error: unknown) => {
              if (active && streamedUpdateRevision === reconciliationRevision)
                setRenderError(message(error));
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
  const estimablePlan = useMemo<EstimablePlan | undefined>(() => {
    if (!dryRun) return undefined;
    const speedBySpeaker = new Map(
      configuration.speakers.map(({ speakerId, speed }) => [speakerId, speed]),
    );
    const entries: EstimablePlan["entries"][number][] = [];
    for (const row of dryRun.rows) {
      if (row.type === "section") {
        entries.push({ type: "section" });
        continue;
      }
      if (row.type === "pause") {
        if (row.durationMs === null) return undefined;
        entries.push({ type: "pause", durationMs: row.durationMs });
        continue;
      }
      const speed = speedBySpeaker.get(row.speakerId);
      if (row.voiceId === null || speed === undefined) return undefined;
      entries.push({
        type: "speech",
        voiceId: row.voiceId,
        speed,
        chunks: [{ text: row.ttsText }],
      });
    }
    return { entries };
  }, [configuration.speakers, dryRun]);
  const estimateVoiceIds = useMemo(
    () =>
      estimablePlan
        ? [
            ...new Set(
              estimablePlan.entries
                .filter((entry) => entry.type === "speech")
                .map(({ voiceId }) => voiceId),
            ),
          ].sort()
        : [],
    [estimablePlan],
  );
  const estimateVoiceIdsKey = JSON.stringify(estimateVoiceIds);

  useEffect(() => {
    let active = true;
    if (!renderClient || !projectId) {
      setEstimateContextState({ status: "unavailable" });
      return;
    }
    setEstimateContextState({ status: "loading" });
    void renderClient
      .getEstimateContext({
        modelId: effectiveModelId,
        voiceIds: estimateVoiceIds,
      })
      .then((value) => {
        if (active) setEstimateContextState({ status: "ready", value });
      })
      .catch(() => {
        if (active) setEstimateContextState({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [effectiveModelId, estimateVoiceIdsKey, projectId, renderClient]);

  const renderEstimates = useMemo(() => {
    if (!estimablePlan) return undefined;
    const calibratedByVoice = Object.create(null) as Record<string, number>;
    if (estimateContextState.status === "ready")
      for (const calibration of estimateContextState.value.calibrations)
        if (
          calibration.modelId === effectiveModelId &&
          estimateVoiceIds.includes(calibration.voiceId)
        )
          calibratedByVoice[calibration.voiceId] =
            calibration.millisecondsPerNormalizedCharacter;
    const calibration = {
      millisecondsPerNormalizedCharacterByVoice: calibratedByVoice,
    };
    const speechPlan: EstimablePlan = {
      entries: estimablePlan.entries.filter((entry) => entry.type === "speech"),
    };
    const speechDurationMs = estimatePlanDurationMs(speechPlan, calibration);
    const durationMs = estimatePlanDurationMs(estimablePlan, calibration);
    const mp3Bytes = estimateMp3Bytes(durationMs, 192);
    const cacheBytes = estimateCacheBytes(speechDurationMs, 24_000, 2, 1);
    return {
      durationMs,
      mp3Bytes,
      cacheBytes,
      peakDiskBytes: estimatePeakDiskBytes({
        speechCacheBytes: cacheBytes,
        totalDurationMs: durationMs,
        bitrateKbps: 192,
        sampleRate: 24_000,
        bytesPerSample: 2,
        channels: 1,
      }),
      allVoicesCalibrated:
        effectiveModelId !== null &&
        estimateVoiceIds.length > 0 &&
        estimateVoiceIds.every((voiceId) =>
          Object.hasOwn(calibratedByVoice, voiceId),
        ),
    };
  }, [effectiveModelId, estimablePlan, estimateContextState, estimateVoiceIds]);

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
    const renderProjectId = project.id;
    const renderStartOperation = ++renderStartOperationRef.current;
    const isCurrentRenderStart = () =>
      renderStartOperationRef.current === renderStartOperation &&
      currentRouteProjectIdRef.current === renderProjectId;
    setRenderStarting(true);
    setRenderError("");
    let startNotice = "Rendering started.";
    try {
      if (isDirty && !(await saveNow()))
        throw new Error("Save valid project changes before rendering.");
      if (
        diskSpaceCheckEnabled &&
        renderEstimates &&
        estimateContextState.status === "ready"
      ) {
        const freeSpaceBytes = estimateContextState.value.freeSpaceBytes;
        const hardUsableBytes = renderDiskSpaceUsableBytes(
          freeSpaceBytes,
          RENDER_DISK_HARD_RESERVE_PERCENT,
        );
        if (renderEstimates.peakDiskBytes > hardUsableBytes)
          throw new Error(
            renderDiskSpaceBlockMessage(
              renderEstimates.peakDiskBytes,
              freeSpaceBytes,
              hardUsableBytes,
            ),
          );
        const softUsableBytes = renderDiskSpaceUsableBytes(
          freeSpaceBytes,
          RENDER_DISK_SOFT_RESERVE_PERCENT,
        );
        if (renderEstimates.peakDiskBytes > softUsableBytes)
          startNotice = renderDiskSpaceWarningMessage(
            renderEstimates.peakDiskBytes,
            freeSpaceBytes,
            softUsableBytes,
          );
      }
      const job = await renderClient.startProject(renderProjectId, {
        diskSpaceCheckEnabled,
      });
      if (!isCurrentRenderStart()) return;
      renderStartRevisionRef.current += 1;
      setSelectedRenderJob(job);
      if (job.state === "complete") setCompletedRenderJob(job);
      setNotice(startNotice);
    } catch (error) {
      if (isCurrentRenderStart()) setRenderError(message(error));
    } finally {
      if (isCurrentRenderStart()) setRenderStarting(false);
    }
  };

  const projectLexicon = draft?.lexiconEntries ?? [];
  const discover = useCallback(
    async (input: SpeechCatalogDiscoveryInput) =>
      await connections.discover(input),
    [connections],
  );
  const displayedSegmentAudition: SegmentAudition = segmentAudition;
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

  return {
    projectId,
    activeTab,
    projects,
    project,
    draft,
    configuration,
    analysisState,
    analysisError,
    errors,
    setErrors,
    busy,
    notice,
    newName,
    setNewName,
    newDescription,
    setNewDescription,
    newProjectOpen,
    setNewProjectOpen,
    createProject,
    updateDraft,
    saveNow,
    duplicateProject,
    deleteProject,
    tabRefs,
    selectTab,
    moveTabFocus,
    renderEstimates,
    estimateContextState,
    editorRef,
    cleanedFencedSource,
    cleanupUndo,
    setCleanupUndo,
    updateSpeaker,
    enabledVoices,
    presentedEnabledVoices,
    voiceSelectionState,
    selectedConnection,
    speechCatalogState,
    discover,
    navigate,
    projectLexicon,
    changeProjectLexicon,
    previewError,
    dryRun,
    activeDiagnosticsByKey,
    focusLine,
    ignoreDiagnostic,
    ignoredDiagnostics,
    restoreDiagnostic,
    segmentAudition: displayedSegmentAudition,
    runPreview,
    renderClient,
    renderActive,
    startRender,
    diskSpaceCheckEnabled,
    setDiskSpaceCheckEnabled,
    renderError,
    setRenderError,
    renderStarting,
    selectedRenderJob,
    completedRenderJob,
    renderWaveform,
    pinBusy,
    toggleCompletedRenderPin,
  };
}

export type ProjectPageController = ReturnType<
  typeof useProjectsPageController
>;
