import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  type ProjectReplaceInput,
  type RenderEstimateContextResult,
  type RenderJob,
  type RenderStartOptions,
  type RenderWaveform,
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
import { queryKeys } from "@/app/queryKeys.js";
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
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({
    queryKey: queryKeys.persistence.projects(),
    queryFn: () => client.projects.list(),
    retry: false,
  });
  const projectQuery = useQuery({
    queryKey: queryKeys.persistence.project(projectId ?? ""),
    queryFn: async () => {
      if (!projectId) throw new Error("A project ID is required.");
      return await client.projects.get(projectId);
    },
    enabled: Boolean(projectId),
    retry: false,
  });
  const globalLexiconQuery = useQuery({
    queryKey: queryKeys.persistence.globalLexicon(),
    queryFn: () => client.globalLexicon.list(),
    retry: false,
  });
  const ignoredDiagnosticsQuery = useQuery({
    queryKey: queryKeys.persistence.ignoredDiagnostics(),
    queryFn: () => client.preferences.getIgnoredDiagnostics(),
    retry: false,
  });
  const timingQuery = useQuery({
    queryKey: queryKeys.persistence.timing(),
    queryFn: () => client.settings.getPacing(),
    retry: false,
  });
  const projects = projectsQuery.data ?? [];
  const globalLexicon = useMemo(
    () =>
      authoringLexicon([
        ...(globalLexiconQuery.data?.builtIns ?? []),
        ...(globalLexiconQuery.data?.custom ?? []),
      ]),
    [globalLexiconQuery.data],
  );
  const timing = timingQuery.data ?? DEFAULT_SYSTEM_TIMING;
  const ignoredDiagnostics = ignoredDiagnosticsQuery.data ?? [];
  const [project, setProject] = useState<ProjectDetail>();
  const [draft, setDraft] = useState<ProjectDraft>();
  const draftRef = useRef<ProjectDraft | undefined>(undefined);
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
  const [completedRenderCandidate, setCompletedRenderCandidate] =
    useState<RenderJob>();
  const [completedRenderJob, setCompletedRenderJob] = useState<RenderJob>();
  const [renderStarting, setRenderStarting] = useState(false);
  const [diskSpaceCheckEnabled, setDiskSpaceCheckEnabled] = useState(
    storedDiskSpaceCheckEnabled,
  );
  const [renderWaveform, setRenderWaveform] = useState<RenderWaveform>();
  const [renderError, setRenderError] = useState("");
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
  const loadedProjectIdRef = useRef<string | undefined>(undefined);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const ignoredDiagnosticsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ignoredDiagnosticsOperationRef = useRef(0);
  const ignoredDiagnosticsPendingRef = useRef(0);
  const ignoredDiagnosticsPersistedRef = useRef<IgnoredDiagnosticCollection>(
    [],
  );
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveNowRef = useRef<() => Promise<boolean>>(() =>
    Promise.resolve(false),
  );

  const createProjectMutation = useMutation({
    mutationFn: async (
      input: Parameters<PersistenceClient["projects"]["create"]>[0],
    ) => await client.projects.create(input),
    onSuccess: (created) => {
      queryClient.setQueryData(
        queryKeys.persistence.project(created.id),
        created,
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.persistence.projects(),
      });
    },
    retry: false,
  });
  const replaceProjectMutation = useMutation({
    mutationFn: async ({
      projectId: targetProjectId,
      input,
    }: {
      projectId: string;
      input: ProjectReplaceInput;
    }) => await client.projects.replace(targetProjectId, input),
    onMutate: async ({ projectId: targetProjectId, input }) => {
      const queryKey = queryKeys.persistence.project(targetProjectId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ProjectDetail>(queryKey);
      if (previous)
        queryClient.setQueryData<ProjectDetail>(queryKey, {
          ...previous,
          name: input.name,
          description: input.description,
          scriptSource: input.scriptSource,
          speakerMappings: input.speakerMappings,
        });
      return { queryKey, previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous)
        queryClient.setQueryData(context.queryKey, context.previous);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.persistence.project(saved.id), saved);
    },
    onSettled: async (_data, _error, { projectId: targetProjectId }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.persistence.projects(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.persistence.project(targetProjectId),
        }),
      ]);
    },
    retry: false,
  });
  const duplicateProjectMutation = useMutation({
    mutationFn: async ({
      projectId: targetProjectId,
      name,
    }: {
      projectId: string;
      name: string;
    }) => await client.projects.duplicate(targetProjectId, { name }),
    onSuccess: (duplicated) => {
      queryClient.setQueryData(
        queryKeys.persistence.project(duplicated.id),
        duplicated,
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.persistence.projects(),
      });
    },
    retry: false,
  });
  const deleteProjectMutation = useMutation({
    mutationFn: async (targetProjectId: string) =>
      await client.projects.delete(targetProjectId),
    onMutate: async (targetProjectId) => {
      const queryKey = queryKeys.persistence.projects();
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<typeof projects>(queryKey);
      queryClient.setQueryData(
        queryKey,
        (current: typeof projects | undefined) =>
          current?.filter(({ id }) => id !== targetProjectId),
      );
      return { previous };
    },
    onError: (_error, _targetProjectId, context) => {
      if (context?.previous)
        queryClient.setQueryData(
          queryKeys.persistence.projects(),
          context.previous,
        );
    },
    onSuccess: (_data, targetProjectId) => {
      queryClient.removeQueries({
        queryKey: queryKeys.persistence.project(targetProjectId),
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.persistence.projects(),
      });
    },
    retry: false,
  });
  const ignoredDiagnosticsMutation = useMutation({
    mutationFn: async (next: IgnoredDiagnosticCollection) =>
      await client.preferences.replaceIgnoredDiagnostics(next),
    retry: false,
  });
  const pinMutation = useMutation({
    mutationFn: async ({
      renderId,
      pinned,
    }: {
      renderId: string;
      pinned: boolean;
      projectId: string;
    }) => {
      if (!renderClient) throw new Error("Render controls are unavailable.");
      return await renderClient.setPinned(renderId, pinned);
    },
    onMutate: ({ renderId, pinned }) => {
      const previousSelected = selectedRenderJob;
      const previousCompletedCandidate = completedRenderCandidate;
      const previousCompleted = completedRenderJob;
      setSelectedRenderJob((current) =>
        current?.id === renderId ? { ...current, pinned } : current,
      );
      setCompletedRenderCandidate((current) =>
        current?.id === renderId ? { ...current, pinned } : current,
      );
      setCompletedRenderJob((current) =>
        current?.id === renderId ? { ...current, pinned } : current,
      );
      return {
        previousSelected,
        previousCompletedCandidate,
        previousCompleted,
      };
    },
    onError: (_error, _variables, context) => {
      setSelectedRenderJob(context?.previousSelected);
      setCompletedRenderCandidate(context?.previousCompletedCandidate);
      setCompletedRenderJob(context?.previousCompleted);
    },
    onSuccess: (updated) => {
      setCompletedRenderCandidate(updated);
      setCompletedRenderJob(updated);
      setSelectedRenderJob((current) =>
        current?.id === updated.id ? updated : current,
      );
    },
    onSettled: async (
      _data,
      _error,
      { renderId, projectId: targetProjectId },
    ) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.renders.detail(renderId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.renders.project(targetProjectId),
        }),
      ]);
    },
    retry: false,
  });
  const startRenderMutation = useMutation({
    mutationFn: async ({
      projectId: targetProjectId,
      options,
    }: {
      projectId: string;
      options: RenderStartOptions;
    }) => {
      if (!renderClient) throw new Error("Render controls are unavailable.");
      return await renderClient.startProject(targetProjectId, options);
    },
    onSuccess: (job) => {
      queryClient.setQueryData(queryKeys.renders.detail(job.id), job);
    },
    onSettled: async (_data, _error, { projectId: targetProjectId }) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.renders.project(targetProjectId),
      });
    },
    retry: false,
  });

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
    setSelectedRenderJob(undefined);
    setCompletedRenderCandidate(undefined);
    setCompletedRenderJob(undefined);
    setRenderWaveform(undefined);
  }, [projectId]);

  useEffect(() => {
    if (
      ignoredDiagnosticsQuery.isSuccess &&
      ignoredDiagnosticsPendingRef.current === 0
    )
      ignoredDiagnosticsPersistedRef.current = ignoredDiagnostics;
  }, [ignoredDiagnostics, ignoredDiagnosticsQuery.isSuccess]);

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
          : speechModel
            ? speechModel.voices.length === 0
              ? "noSupportedVoices"
              : "ready"
            : "modelUnavailable"
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

  const sharedPersistenceDataReady =
    projectsQuery.isSuccess &&
    globalLexiconQuery.isSuccess &&
    ignoredDiagnosticsQuery.isSuccess &&
    timingQuery.isSuccess;
  const queryError = [
    projectsQuery,
    projectQuery,
    globalLexiconQuery,
    ignoredDiagnosticsQuery,
    timingQuery,
  ].find((query) => query.isError)?.error;
  const busy =
    createProjectMutation.isPending ||
    projectsQuery.isPending ||
    globalLexiconQuery.isPending ||
    ignoredDiagnosticsQuery.isPending ||
    timingQuery.isPending ||
    (Boolean(projectId) && projectQuery.isPending);

  useEffect(() => {
    if (queryError) setErrors([message(queryError)]);
  }, [queryError]);

  useEffect(() => {
    if (projectId) return;
    loadedProjectIdRef.current = undefined;
    clearAutosave();
    setProject(undefined);
    setDraft(undefined);
    draftRef.current = undefined;
    setAnalysis(undefined);
    setConfiguration({ speakers: [], pauses: [], sections: [] });
    setSelectedRenderJob(undefined);
    setCompletedRenderCandidate(undefined);
    setCompletedRenderJob(undefined);
    setRenderStarting(false);
    setRenderWaveform(undefined);
  }, [clearAutosave, projectId]);

  useEffect(() => {
    if (
      !projectId ||
      !sharedPersistenceDataReady ||
      !projectQuery.data ||
      projectQuery.data.id !== projectId ||
      loadedProjectIdRef.current === projectId
    )
      return;
    loadedProjectIdRef.current = projectId;
    clearAutosave();
    const loadedDraft = draftFromProject(projectQuery.data);
    setProject(projectQuery.data);
    setDraft(loadedDraft);
    draftRef.current = loadedDraft;
    revisionRef.current = 0;
    savedRevisionRef.current = 0;
    setSaveState("saved");
    setNotice(`Opened ${projectQuery.data.name}.`);
    setErrors([]);
  }, [clearAutosave, projectId, projectQuery.data, sharedPersistenceDataReady]);

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
        setCompletedRenderCandidate(
          jobs.find(({ state }) => state === "complete"),
        );
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
    setRenderError("");
    try {
      await pinMutation.mutateAsync({
        renderId: completedRenderJob.id,
        pinned: !completedRenderJob.pinned,
        projectId: completedRenderJob.projectId,
      });
    } catch (error) {
      setRenderError(message(error));
    }
  };

  useEffect(() => {
    if (!renderClient || !activeRenderId) return;
    let active = true;
    const applyJob = (job: RenderJob) => {
      if (!active) return;
      setSelectedRenderJob(job);
      if (job.state === "complete") setCompletedRenderCandidate(job);
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
    if (!renderClient || !completedRenderCandidate) {
      setCompletedRenderJob(undefined);
      return;
    }
    let active = true;
    setCompletedRenderJob(undefined);
    void renderClient
      .listArtifacts(completedRenderCandidate.id)
      .then((artifacts) => {
        if (active && artifacts.some(({ type }) => type === "mp3"))
          setCompletedRenderJob(completedRenderCandidate);
      })
      .catch((error: unknown) => {
        if (active) setRenderError(message(error));
      });
    return () => {
      active = false;
    };
  }, [completedRenderCandidate, renderClient]);

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
      const saved = await replaceProjectMutation.mutateAsync({
        projectId: currentProject.id,
        input: parsed.data,
      });
      savedRevisionRef.current = targetRevision;
      setProject(saved);
      if (revisionRef.current === targetRevision) {
        const savedDraft = draftFromProject(saved);
        setDraft(savedDraft);
        draftRef.current = savedDraft;
        setSaveState("saved");
      } else {
        setSaveState("unsaved");
      }
      return true;
    } catch (error) {
      setSaveState("failed");
      setErrors([message(error)]);
      return false;
    }
  }, [project, replaceProjectMutation]);

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
    try {
      const created = await createProjectMutation.mutateAsync({
        name: newName,
        description: newDescription,
      });
      setNewName("");
      setNewDescription("");
      setNewProjectOpen(false);
      void navigate(`/projects/${created.id}`);
    } catch (error) {
      setErrors([message(error)]);
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
      const duplicated = await duplicateProjectMutation.mutateAsync({
        projectId: project.id,
        name,
      });
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
    try {
      await deleteProjectMutation.mutateAsync(project.id);
      void navigate("/projects");
    } catch (error) {
      setErrors([message(error)]);
    }
  };

  const selectTab = (tab: ProjectTab, focus = false) => {
    if (tab === activeTab) {
      if (focus) window.setTimeout(() => tabRefs.current[tab]?.focus(), 0);
      return;
    }
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
    const queryKey = queryKeys.persistence.ignoredDiagnostics();
    const operation = ++ignoredDiagnosticsOperationRef.current;
    ignoredDiagnosticsPendingRef.current += 1;
    void queryClient.cancelQueries({ queryKey }, { revert: false });
    queryClient.setQueryData(queryKey, next);

    const run = async () => {
      try {
        const saved = await ignoredDiagnosticsMutation.mutateAsync(next);
        ignoredDiagnosticsPersistedRef.current = saved;
        if (operation !== ignoredDiagnosticsOperationRef.current) return;
        queryClient.setQueryData(queryKey, saved);
        setNotice(successMessage);
      } catch (error) {
        if (operation !== ignoredDiagnosticsOperationRef.current) return;
        queryClient.setQueryData(
          queryKey,
          ignoredDiagnosticsPersistedRef.current,
        );
        setErrors([message(error)]);
      } finally {
        if (operation === ignoredDiagnosticsOperationRef.current)
          await queryClient.invalidateQueries({ queryKey });
        ignoredDiagnosticsPendingRef.current -= 1;
      }
    };
    const task = ignoredDiagnosticsQueueRef.current.then(run, run);
    ignoredDiagnosticsQueueRef.current = task.catch(() => undefined);
    await task;
  };

  const ignoreDiagnostic = async (item: IgnoredDiagnostic) => {
    const key = diagnosticKey(item);
    const current =
      queryClient.getQueryData<IgnoredDiagnosticCollection>(
        queryKeys.persistence.ignoredDiagnostics(),
      ) ?? ignoredDiagnostics;
    const next = current.some((candidate) => diagnosticKey(candidate) === key)
      ? current
      : [...current, item];
    await replaceIgnoredDiagnostics(
      next,
      "Diagnostic pattern ignored for every project.",
    );
  };

  const restoreDiagnostic = async (item: IgnoredDiagnostic) => {
    const key = diagnosticKey(item);
    const current =
      queryClient.getQueryData<IgnoredDiagnosticCollection>(
        queryKeys.persistence.ignoredDiagnostics(),
      ) ?? ignoredDiagnostics;
    await replaceIgnoredDiagnostics(
      current.filter((candidate) => diagnosticKey(candidate) !== key),
      "Diagnostic pattern restored.",
    );
  };

  const runPreview = async (nodeOrdinal: number) => {
    if (
      segmentAudition?.key === nodeOrdinal &&
      segmentAudition.phase === "playing"
    ) {
      stopSegmentAudition();
      return;
    }
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
      const job = await startRenderMutation.mutateAsync({
        projectId: renderProjectId,
        options: { diskSpaceCheckEnabled },
      });
      if (!isCurrentRenderStart()) return;
      renderStartRevisionRef.current += 1;
      setSelectedRenderJob(job);
      if (job.state === "complete") setCompletedRenderCandidate(job);
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
    pinBusy: pinMutation.isPending,
    toggleCompletedRenderPin,
  };
}

export type ProjectPageController = ReturnType<
  typeof useProjectsPageController
>;
