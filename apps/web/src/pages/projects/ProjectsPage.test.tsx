// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/domGeometry.js";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseScript,
  resolveParagraphPauses,
  transformScript,
} from "@studynarrator/core";
import { DEFAULT_SYSTEM_TIMING } from "@studynarrator/shared-types";
import type {
  IgnoredDiagnosticCollection,
  PersistenceClient,
  ProjectDetail,
  ProjectPreviewResult,
  ProjectReplaceInput,
  ProjectPreviewClient,
  ProjectSummary,
  RenderClient,
  RenderEstimateContextInput,
  RenderEstimateContextResult,
  RenderJob,
  RenderPlan,
  SpeechBackendConnection,
  SpeechCatalog,
  VoiceCatalog,
} from "@studynarrator/shared-types";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import type { ScriptAnalysisInput } from "@/workers/parser/parserWorkerProtocol.js";
import { queryKeys } from "@/app/queryKeys.js";
import { GLOBAL_VOICE_CATALOG_MODEL_ID } from "@/features/projects/projectAuthoring.js";
import type { RenderProgressClient } from "@/services/renders/renderClient.js";
import { ProjectsPage } from "./ProjectsPage.js";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";

const project: ProjectDetail = {
  contractVersion: 1,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Authoring study",
  description: "Offline fixture",
  scriptSource: "[speaker_teacher] SQL.\n[pause_short]\nContinue.",
  scriptHash: "a".repeat(64),
  speakerMappings: [
    {
      speakerId: "teacher",
      displayName: "Teacher",
      voiceId: "voice_teacher",
      speed: 1,
      gainDb: 0,
      roleDescription: "",
      sampleText: "",
    },
  ],
  lexiconEntries: [
    {
      id: "project-sql",
      scope: "project",
      entryType: "exactTerm",
      displayText: "SQL",
      spokenText: "sequel",
      caseSensitive: false,
      wholeWord: true,
      priority: 0,
      enabled: true,
      notes: "",
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    },
  ],
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z",
};

const globalCatalog: VoiceCatalog = {
  schemaVersion: 1,
  modelId: GLOBAL_VOICE_CATALOG_MODEL_ID,
  entries: [
    {
      voiceId: "af_heart",
      label: "Heart — American English — af_heart",
      enabled: true,
      favorite: false,
      language: "American English",
      locale: "en-US",
      accent: "American",
      category: null,
      style: null,
      sampleText: null,
    },
    {
      voiceId: "af_sky",
      label: "Sky — American English — af_sky",
      enabled: true,
      favorite: false,
      language: "American English",
      locale: "en-US",
      accent: "American",
      category: null,
      style: null,
      sampleText: null,
    },
  ],
};

const estimateConnection: SpeechBackendConnection = {
  backendId: "speaches",
  baseUrl: "http://127.0.0.1:8000",
  suppliedUrlForm: "root",
  configured: true,
  defaultModelId: "model",
  defaultVoiceId: "voice_teacher",
  timeoutSeconds: 120,
  retryCount: 0,
  responseFormat: "wav",
  lastTestedAt: null,
  lastSuccessfulTestAt: null,
  lastTestSummary: null,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const estimateCatalog: VoiceCatalog = {
  schemaVersion: 1,
  modelId: "model",
  entries: ["voice_teacher", "voice_other"].map((voiceId) => ({
    voiceId,
    label: voiceId === "voice_teacher" ? "Teacher Voice" : "Other Voice",
    enabled: true,
    favorite: false,
    language: null,
    locale: null,
    accent: null,
    category: null,
    style: null,
    sampleText: null,
  })),
};
const estimateSpeechCatalog: SpeechCatalog = {
  schemaVersion: 1,
  models: [
    {
      modelId: "model",
      voices: estimateCatalog.entries.map(({ voiceId, label }) => ({
        voiceId,
        name: label,
        language: null,
        gender: null,
      })),
    },
  ],
};

function projectPreviewResult(
  mode: "segment" | "pronunciation" = "segment",
): ProjectPreviewResult {
  const timestamp = "2026-08-12T12:00:00.000Z";
  return {
    schemaVersion: 1,
    id: "00000000-0000-4000-8000-000000000002",
    createdAt: timestamp,
    projectId: project.id,
    mode,
    nodeOrdinal: mode === "segment" ? 1 : null,
    sourceRange:
      mode === "segment"
        ? { start: { line: 1, column: 1 }, end: { line: 1, column: 23 } }
        : null,
    modelId: "model",
    speakerId: "teacher",
    voiceId: "voice_teacher",
    voiceLabel: "Teacher Voice",
    speed: 1,
    originalText: "SQL.",
    readableText: "SQL.",
    transformedText: "sequel.",
    cache: {
      key: "a".repeat(64),
      status: "miss",
      byteLength: 3,
      createdAt: timestamp,
      lastUsedAt: timestamp,
    },
    audio: { mimeType: "audio/wav", base64: "AQID", byteLength: 3 },
  };
}

function frozenPlan(
  id: string,
  scriptHash: string,
  createdAt: string,
): RenderPlan {
  return {
    schemaVersion: 1,
    id,
    projectId: project.id,
    createdAt,
    snapshotHash: "b".repeat(64),
    planHash: id.endsWith("2") ? "c".repeat(64) : "d".repeat(64),
    scriptHash,
    entries: [
      {
        type: "section",
        ordinal: 1,
        nodeOrdinal: 1,
        title: "Opening",
        sectionTitle: "Opening",
        sourceRange: null,
      },
      {
        type: "speech",
        ordinal: 2,
        nodeOrdinal: 2,
        sectionTitle: "Opening",
        sourceRange: null,
        speakerId: "teacher",
        voiceId: "voice_teacher",
        speed: 1,
        gainDb: 0,
        originalText: "SQL.",
        readableText: "SQL.",
        ttsText: "sequel.",
        chunks: [
          {
            ordinal: 1,
            text: "sequel.",
            cacheKey: "e".repeat(64),
            cacheStatus: "miss",
          },
        ],
      },
      {
        type: "pause",
        ordinal: 3,
        sectionTitle: "Opening",
        sourceRange: null,
        pauseKind: "automatic",
        reason: "paragraph",
        pauseId: "pause_medium",
        durationMs: 750,
        silence: null,
      },
    ],
    summary: {
      sectionCount: 1,
      speechCount: 1,
      pauseCount: 1,
      cacheHits: 0,
      cacheMisses: 1,
      silenceDurationMs: 750,
    },
  };
}

function renderJobFixture(
  id: string,
  state: RenderJob["state"],
  completedChunks = state === "complete" ? 4 : 1,
): RenderJob {
  const terminal = ["complete", "failed", "canceled"].includes(state);
  return {
    contractVersion: 1,
    id,
    projectId: project.id,
    planId: "00000000-0000-4000-8000-000000000090",
    retryOfRenderId: null,
    pinned: false,
    state,
    progress: {
      phase: state,
      sectionTitle: "Opening",
      sectionOrdinal: 1,
      sectionCount: 1,
      entryOrdinal: 1,
      speechOrdinal: 1,
      speechCount: 1,
      chunkOrdinal: terminal ? null : 1,
      completedChunks,
      totalChunks: 4,
      cacheHits: 0,
      cacheMisses: 4,
      ttsRequests: completedChunks,
      speakerId: terminal ? null : "teacher",
      voiceId: terminal ? null : "voice_teacher",
      excerpt: terminal ? null : "Study this.",
      elapsedMs: completedChunks * 500,
    },
    error:
      state === "failed"
        ? {
            code: "RENDER_SYNTHESIS_FAILED",
            message: "Speech generation failed.",
            retryable: true,
            phase: "synthesizing",
            entryOrdinal: 1,
            chunkOrdinal: 1,
            sourceRange: null,
            speakerId: "teacher",
            voiceId: "voice_teacher",
          }
        : null,
    createdAt: "2026-08-12T14:00:00.000Z",
    startedAt: "2026-08-12T14:00:00.100Z",
    finishedAt: terminal ? "2026-08-12T14:00:02.000Z" : null,
  };
}

function renderClientFixture(
  jobs: RenderJob[],
  get: RenderClient["get"],
  subscribe?: NonNullable<RenderProgressClient["subscribe"]>,
): RenderProgressClient {
  const fallbackJob =
    jobs[0] ??
    renderJobFixture("00000000-0000-4000-8000-000000000091", "complete");
  return {
    startProject: vi.fn(async () => fallbackJob),
    getEstimateContext: vi.fn(async () => ({
      freeSpaceBytes: 1_073_741_824,
      calibrations: [],
    })),
    list: vi.fn(async () => jobs),
    get,
    cancel: vi.fn(async () => fallbackJob),
    retry: vi.fn(async () => fallbackJob),
    setPinned: vi.fn(async () => fallbackJob),
    listArtifacts: vi.fn(async () => []),
    exportArtifact: vi.fn(),
    exportAudio: vi.fn(),
    exportDetails: vi.fn(),
    listSegments: vi.fn(async () => []),
    getWaveform: vi.fn(async () => ({
      status: "unavailable" as const,
      renderId: fallbackJob.id,
      reason: "audioMissing" as const,
    })),
    renderAudioSource: vi.fn((renderId: string) => `/renders/${renderId}.mp3`),
    segmentAudioSource: vi.fn(),
    exportSegment: vi.fn(),
    ...(subscribe ? { subscribe } : {}),
  };
}

function fixture(
  sourceProject = project,
  summaryOverrides: Partial<
    Pick<ProjectSummary, "scriptLineCount" | "audioDurationMs">
  > = {},
) {
  let stored = structuredClone(sourceProject);
  let ignoredDiagnostics: Array<{ code: string; pattern: string }> = [];
  const replace = vi.fn(async (_id: string, input: ProjectReplaceInput) => {
    stored = {
      ...stored,
      ...input,
      scriptHash: "b".repeat(64),
      updatedAt: "2026-08-12T13:00:00.000Z",
      lexiconEntries: stored.lexiconEntries,
    };
    return structuredClone(stored);
  });
  const duplicate = vi.fn(async () => structuredClone(stored));
  const create = vi.fn(
    async (input: { name: string; description?: string }) => {
      stored = {
        ...stored,
        id: "00000000-0000-4000-8000-000000000099",
        name: input.name,
        description: input.description ?? "",
      };
      return structuredClone(stored);
    },
  );
  const replaceIgnoredDiagnostics = vi.fn(
    async (input: IgnoredDiagnosticCollection) => {
      ignoredDiagnostics = structuredClone(input);
      return structuredClone(input);
    },
  );
  const replaceGlobalLexicon = vi.fn(async () => []);
  const listProjects = vi.fn(async () => [
    {
      id: stored.id,
      name: stored.name,
      description: stored.description,
      scriptHash: stored.scriptHash,
      scriptLineCount:
        stored.scriptSource === ""
          ? null
          : stored.scriptSource.split("\n").length,
      audioDurationMs: null,
      ...summaryOverrides,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    },
  ]);
  const client: PersistenceClient = {
    status: vi.fn(),
    projects: {
      list: listProjects,
      create,
      get: vi.fn(async () => structuredClone(stored)),
      replace,
      duplicate,
      delete: vi.fn(async () => undefined),
    },
    settings: {
      getPacing: vi.fn(async () => DEFAULT_SYSTEM_TIMING),
      updatePacing: vi.fn(),
    },
    retention: {} as PersistenceClient["retention"],
    preferences: {
      getIgnoredDiagnostics: vi.fn(async () =>
        structuredClone(ignoredDiagnostics),
      ),
      replaceIgnoredDiagnostics,
    },
    globalLexicon: {
      list: vi.fn(async () => []),
      replace: replaceGlobalLexicon,
    },
  };
  const analyze = vi.fn(async (input: ScriptAnalysisInput) => {
    const { entries, paragraphPause, ...parseInput } = input;
    const parseResult = parseScript(parseInput);
    return {
      parseResult,
      pacingResult: resolveParagraphPauses({
        parsedScript: parseResult,
        configuration: paragraphPause,
      }),
      transformResult: transformScript({ parsedScript: parseResult, entries }),
    };
  });
  return {
    client,
    analyze,
    replace,
    duplicate,
    create,
    replaceIgnoredDiagnostics,
    replaceGlobalLexicon,
    listProjects,
  };
}

function renderPage(
  client: PersistenceClient,
  analyze: ScriptAnalyzer["analyze"],
  options: {
    connection?: SpeechBackendConnection | null;
    catalog?: VoiceCatalog;
    speechCatalog?: SpeechCatalog;
    discovery?: () => Promise<SpeechCatalog>;
    previewClient?: ProjectPreviewClient;
    renderClient?: RenderClient;
    path?: string;
  } = {},
) {
  const connection = options.connection ?? {
    backendId: "speaches" as const,
    baseUrl: null,
    suppliedUrlForm: "unconfigured" as const,
    configured: false,
    defaultModelId: null,
    defaultVoiceId: null,
    timeoutSeconds: 120,
    retryCount: 2,
    responseFormat: "wav" as const,
    lastTestedAt: null,
    lastSuccessfulTestAt: null,
    lastTestSummary: null,
    createdAt: "2026-08-12T12:00:00.000Z",
    updatedAt: "2026-08-12T12:00:00.000Z",
  };
  const discoveredCatalog = options.speechCatalog ?? {
    schemaVersion: 1 as const,
    models: connection.defaultModelId
      ? [
          {
            modelId: connection.defaultModelId,
            voices: (options.catalog?.entries ?? []).map((entry) => ({
              voiceId: entry.voiceId,
              name: entry.voiceId,
              language: entry.language,
              gender: null,
            })),
          },
        ]
      : [],
  };
  const connections = {
    get: vi.fn(async () => connection),
    update: vi.fn(),
    test: vi.fn(),
    exportDiagnostics: vi.fn(),
    discoverSpeechCatalog: vi.fn(
      options.discovery ?? (async () => discoveredCatalog),
    ),
    getSetupState: vi.fn(async () => ({
      onboardingCompletedAt: "2026-08-12T12:00:00.000Z",
      client: "web" as const,
    })),
    completeOnboarding: vi.fn(),
  };
  const voiceCatalog = {
    get: vi.fn(
      async (modelId: string) =>
        options.catalog ?? { schemaVersion: 1 as const, modelId, entries: [] },
    ),
    replace: vi.fn(),
  };
  const previewClient =
    options.previewClient ??
    ({ preview: vi.fn() } as unknown as ProjectPreviewClient);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const page = (
    <ProjectsPage
      client={client}
      analyzer={{ analyze }}
      previewClient={previewClient}
      {...(options.renderClient ? { renderClient: options.renderClient } : {})}
    />
  );
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider
          connectionClient={connections}
          voiceCatalog={voiceCatalog}
        >
          <MemoryRouter
            initialEntries={[options.path ?? `/projects/${project.id}`]}
          >
            <Link to="/settings">Settings test link</Link>
            <Routes>
              <Route path="/projects" element={page} />
              <Route path="/projects/:projectId" element={page} />
              <Route path="/settings" element={<p>Settings destination</p>} />
            </Routes>
          </MemoryRouter>
        </ConnectionProvider>
      </QueryClientProvider>,
    ),
    connections,
    voiceCatalog,
    previewClient,
  };
}

function installMemoryLocalStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const setItem = vi.fn((key: string, value: string) => {
    values.set(key, value);
  });
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem,
  };
  vi.stubGlobal("localStorage", storage);
  return { storage, setItem };
}

function renderClientWithEstimateContext(
  getEstimateContext: RenderClient["getEstimateContext"],
) {
  const fallbackJob = renderJobFixture(
    "00000000-0000-4000-8000-000000000091",
    "complete",
  );
  const startProject = vi.fn(async () => fallbackJob);
  return {
    startProject,
    renderClient: {
      ...renderClientFixture([], vi.fn()),
      startProject,
      getEstimateContext,
    },
  };
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function installAudioContext() {
  const source = {
    buffer: null as AudioBuffer | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const context = {
    destination: {},
    resume: vi.fn(async () => undefined),
    decodeAudioData: vi.fn(async () => ({}) as AudioBuffer),
    createBufferSource: vi.fn(() => source),
    close: vi.fn(async () => undefined),
  };
  function FakeAudioContext() {
    return context;
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("atob", (value: string) =>
    Buffer.from(value, "base64").toString("binary"),
  );
  return { context, source };
}

async function openProjectTab(
  name: "Script Editor" | "Settings" | "Details" | "Render",
) {
  await userEvent.click(await screen.findByRole("tab", { name }));
}

function scriptEditorView(): EditorView {
  const content = screen.getByRole("textbox", { name: "Script source" });
  const view = EditorView.findFromDOM(
    content.closest(".cm-editor") as HTMLElement,
  );
  if (!view) throw new Error("Expected a CodeMirror editor view.");
  return view;
}

function replaceScriptSource(value: string): void {
  const view = scriptEditorView();
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
  });
}

function estimateValue(strip: HTMLElement, label: string): HTMLElement {
  const term = within(strip).getByText(label, { exact: true });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement))
    throw new Error(`Expected an estimate value for ${label}.`);
  return value;
}

beforeEach(() => {
  window.localStorage?.clear();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
    () => undefined,
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    () => undefined,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Projects workbench", () => {
  it("renders the project index ledger and creates from an expandable form", async () => {
    const { client, analyze, create } = fixture(
      { ...project, description: "" },
      { audioDurationMs: 752_000 },
    );
    renderPage(client, analyze, { path: "/projects" });

    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Name", "Description", "Script Lines", "Audio Length"]);
    const row = within(table).getByRole("row", { name: /Authoring study/u });
    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["-", "3", "12:32"]);
    expect(
      within(row).getByRole("link", { name: "Authoring study" }),
    ).toHaveAttribute("href", `/projects/${project.id}`);
    expect(screen.queryByText("Your projects")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New project" }));
    await userEvent.type(
      screen.getByLabelText("Project name"),
      "Index-created project",
    );
    await userEvent.type(
      screen.getByLabelText("Description"),
      "Created from the project index.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create project" }),
    );
    expect(create).toHaveBeenCalledWith({
      name: "Index-created project",
      description: "Created from the project index.",
    });
    expect(
      await screen.findByRole("heading", { name: "Project details" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("tab", { name: "Script Editor" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("deep-links and keyboard-navigates tabs and returns source actions to the editor", async () => {
    const { client, analyze } = fixture();
    renderPage(client, analyze, {
      path: `/projects/${project.id}?tab=details`,
    });

    const details = await screen.findByRole("tab", { name: "Details" });
    expect(details).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "id",
      "project-panel-details",
    );
    await userEvent.type(details, "{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Render" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.type(screen.getByRole("tab", { name: "Render" }), "{Home}");
    expect(screen.getByRole("tab", { name: "Script Editor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await openProjectTab("Details");
    await userEvent.click(
      (
        await screen.findAllByRole("button", { name: "Focus source line 1" })
      )[0]!,
    );
    expect(screen.getByRole("tab", { name: "Script Editor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByLabelText("Script source")).toHaveFocus();
  });

  it("falls back to the script editor for invalid tab queries and reports index loading failures", async () => {
    const loaded = fixture();
    renderPage(loaded.client, loaded.analyze, {
      path: `/projects/${project.id}?tab=unknown`,
    });
    expect(
      await screen.findByRole("tab", { name: "Script Editor" }),
    ).toHaveAttribute("aria-selected", "true");
    cleanup();

    const failed = fixture();
    failed.client.projects.list = vi.fn(async () => {
      throw new Error("project index unavailable");
    });
    renderPage(failed.client, failed.analyze, { path: "/projects" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "project index unavailable",
    );
  });

  it("shows live word and character counts for the raw script source", async () => {
    const { client, analyze } = fixture();
    renderPage(client, analyze);

    const statistics = await screen.findAllByRole("group", {
      name: /Script statistics/u,
    });
    expect(statistics).toHaveLength(2);
    for (const item of statistics) {
      expect(within(item).getByText("4 words")).toBeInTheDocument();
      expect(
        within(item).getByText(
          `${project.scriptSource.length.toLocaleString()} characters`,
        ),
      ).toBeInTheDocument();
    }

    const mixedWhitespace = "  [speaker_teacher]\nOne\t two  ";
    replaceScriptSource(mixedWhitespace);
    for (const item of statistics) {
      expect(await within(item).findByText("3 words")).toBeInTheDocument();
      expect(
        within(item).getByText(
          `${mixedWhitespace.length.toLocaleString()} characters`,
        ),
      ).toBeInTheDocument();
    }

    const whitespaceOnly = " \n\t ";
    replaceScriptSource(whitespaceOnly);
    for (const item of statistics) {
      expect(await within(item).findByText("0 words")).toBeInTheDocument();
      expect(
        within(item).getByText(
          `${whitespaceOnly.length.toLocaleString()} characters`,
        ),
      ).toBeInTheDocument();
    }
  });

  it("uses worker-derived speech and exact pauses with persisted voice calibration", async () => {
    const { client, analyze } = fixture();
    const calibration = {
      modelId: "model",
      voiceId: "voice_teacher",
      millisecondsPerNormalizedCharacter: 200,
      sampleCount: 3,
      updatedAt: "2026-08-12T12:00:00.000Z",
    };
    const getEstimateContext = vi.fn(
      async (
        input: RenderEstimateContextInput,
      ): Promise<RenderEstimateContextResult> => ({
        freeSpaceBytes: 1_073_741_824,
        calibrations: input.voiceIds.includes("voice_teacher")
          ? [calibration]
          : [],
      }),
    );
    const renderClient = {
      ...renderClientFixture([], vi.fn()),
      getEstimateContext,
    };
    renderPage(client, analyze, {
      connection: estimateConnection,
      catalog: estimateCatalog,
      speechCatalog: estimateSpeechCatalog,
      renderClient,
    });

    const strip = await screen.findByRole("group", {
      name: "Script estimates",
    });
    await waitFor(() =>
      expect(
        within(strip).getByRole("status", {
          name: "Estimate calibration status",
        }),
      ).toHaveTextContent("Voice timing calibration applied"),
    );
    expect(estimateValue(strip, "Words")).toHaveTextContent("4");
    expect(estimateValue(strip, "Duration")).toHaveTextContent("4s");
    expect(estimateValue(strip, "MP3 size")).toHaveTextContent("83.2 KiB");
    expect(estimateValue(strip, "Cache footprint")).toHaveTextContent(
      "150.0 KiB",
    );
    expect(estimateValue(strip, "Peak disk")).toHaveTextContent("399.6 KiB");
    expect(estimateValue(strip, "Free space")).toHaveTextContent("1.0 GiB");
    expect(getEstimateContext).toHaveBeenCalledWith({
      modelId: "model",
      voiceIds: ["voice_teacher"],
    });

    await openProjectTab("Settings");
    fireEvent.change(screen.getByLabelText("Speed for speaker teacher"), {
      target: { value: "2" },
    });
    await openProjectTab("Script Editor");
    const updatedStrip = await screen.findByRole("group", {
      name: "Script estimates",
    });
    expect(estimateValue(updatedStrip, "Duration")).toHaveTextContent("2s");
    expect(estimateValue(updatedStrip, "MP3 size")).toHaveTextContent(
      "45.7 KiB",
    );
    expect(estimateValue(updatedStrip, "Cache footprint")).toHaveTextContent(
      "75.0 KiB",
    );
    expect(estimateValue(updatedStrip, "Peak disk")).toHaveTextContent(
      "212.1 KiB",
    );
  });

  it("keeps default estimates available while free space loads and fails", async () => {
    const { client, analyze } = fixture();
    const pending = deferred<RenderEstimateContextResult>();
    const getEstimateContext = vi.fn(
      (
        input: RenderEstimateContextInput,
      ): Promise<RenderEstimateContextResult> =>
        input.voiceIds.length === 0
          ? Promise.resolve({
              freeSpaceBytes: 1_073_741_824,
              calibrations: [],
            })
          : pending.promise,
    );
    const renderClient = {
      ...renderClientFixture([], vi.fn()),
      getEstimateContext,
    };
    renderPage(client, analyze, {
      connection: estimateConnection,
      catalog: estimateCatalog,
      speechCatalog: estimateSpeechCatalog,
      renderClient,
    });

    const strip = await screen.findByRole("group", {
      name: "Script estimates",
    });
    await waitFor(() =>
      expect(getEstimateContext).toHaveBeenCalledWith({
        modelId: "model",
        voiceIds: ["voice_teacher"],
      }),
    );
    expect(estimateValue(strip, "Estimated duration")).toHaveTextContent("2s");
    expect(estimateValue(strip, "Estimated MP3 size")).toHaveTextContent(
      "38.2 KiB",
    );
    expect(estimateValue(strip, "Estimated cache footprint")).toHaveTextContent(
      "60.0 KiB",
    );
    expect(estimateValue(strip, "Estimated peak disk")).toHaveTextContent(
      "174.6 KiB",
    );
    expect(estimateValue(strip, "Free space")).toHaveTextContent("Loading…");

    pending.reject(new Error("statfs unavailable"));
    await waitFor(() =>
      expect(estimateValue(strip, "Free space")).toHaveTextContent(
        "Unavailable",
      ),
    );
    expect(within(strip).getByRole("status")).toHaveTextContent(
      "default voice timing",
    );
  });

  it("shows placeholders until worker analysis completes", async () => {
    const loaded = fixture();
    const analysis = deferred<Awaited<ReturnType<ScriptAnalyzer["analyze"]>>>();
    const renderClient = renderClientFixture([], vi.fn());
    renderPage(loaded.client, () => analysis.promise, { renderClient });

    const strip = await screen.findByRole("group", {
      name: "Script estimates",
    });
    await waitFor(() =>
      expect(estimateValue(strip, "Free space")).toHaveTextContent("1.0 GiB"),
    );
    expect(estimateValue(strip, "Words")).toHaveTextContent("4");
    expect(estimateValue(strip, "Estimated duration")).toHaveTextContent("—");
    expect(estimateValue(strip, "Estimated MP3 size")).toHaveTextContent("—");
    expect(estimateValue(strip, "Estimated cache footprint")).toHaveTextContent(
      "—",
    );
    expect(estimateValue(strip, "Estimated peak disk")).toHaveTextContent("—");
    expect(within(strip).getByRole("status")).toHaveTextContent(
      "Waiting for script analysis",
    );
  });

  it("ignores stale estimate context after the configured voice changes", async () => {
    const { client, analyze } = fixture();
    const stale = deferred<RenderEstimateContextResult>();
    const getEstimateContext = vi.fn(
      (
        input: RenderEstimateContextInput,
      ): Promise<RenderEstimateContextResult> => {
        if (input.voiceIds.includes("voice_teacher")) return stale.promise;
        return Promise.resolve({
          freeSpaceBytes: input.voiceIds.includes("voice_other")
            ? 2_147_483_648
            : 1_073_741_824,
          calibrations: [],
        });
      },
    );
    const renderClient = {
      ...renderClientFixture([], vi.fn()),
      getEstimateContext,
    };
    renderPage(client, analyze, {
      connection: estimateConnection,
      catalog: estimateCatalog,
      speechCatalog: estimateSpeechCatalog,
      renderClient,
    });
    await screen.findByRole("group", { name: "Script estimates" });
    await waitFor(() =>
      expect(getEstimateContext).toHaveBeenCalledWith({
        modelId: "model",
        voiceIds: ["voice_teacher"],
      }),
    );

    await openProjectTab("Settings");
    await userEvent.selectOptions(
      await screen.findByLabelText("Voice for speaker teacher"),
      "voice_other",
    );
    await waitFor(() =>
      expect(getEstimateContext).toHaveBeenCalledWith({
        modelId: "model",
        voiceIds: ["voice_other"],
      }),
    );
    await openProjectTab("Script Editor");
    const currentStrip = await screen.findByRole("group", {
      name: "Script estimates",
    });
    await waitFor(() =>
      expect(estimateValue(currentStrip, "Free space")).toHaveTextContent(
        "2.0 GiB",
      ),
    );

    act(() => {
      stale.resolve({ freeSpaceBytes: 536_870_912, calibrations: [] });
    });
    await waitFor(() =>
      expect(estimateValue(currentStrip, "Free space")).toHaveTextContent(
        "2.0 GiB",
      ),
    );
  });

  it("defaults the disk-space block on and persists only its boolean client preference", async () => {
    const { setItem } = installMemoryLocalStorage();
    const first = fixture();
    renderPage(first.client, first.analyze, {
      renderClient: renderClientFixture([], vi.fn()),
    });
    await openProjectTab("Render");

    const checkbox = await screen.findByRole("checkbox", {
      name: "Block renders when disk space is insufficient",
    });
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(setItem).toHaveBeenCalledWith(
      "studynarrator.render.disk-space-check.v1",
      "false",
    );

    cleanup();
    const second = fixture();
    renderPage(second.client, second.analyze, {
      renderClient: renderClientFixture([], vi.fn()),
    });
    await openProjectTab("Render");
    const restored = await screen.findByRole("checkbox", {
      name: "Block renders when disk space is insufficient",
    });
    expect(restored).not.toBeChecked();

    setItem.mockImplementation(() => {
      throw new Error("browser storage unavailable");
    });
    await userEvent.click(restored);
    expect(restored).toBeChecked();
  });

  it("blocks a known insufficient render locally with the same byte-only message", async () => {
    const { client, analyze } = fixture();
    const { renderClient, startProject } = renderClientWithEstimateContext(
      vi.fn(async () => ({ freeSpaceBytes: 1, calibrations: [] })),
    );
    renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");
    const renderButton = await screen.findByRole("button", { name: "Render" });
    await waitFor(() => expect(renderButton).toBeEnabled());

    await userEvent.click(renderButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Render blocked: estimated peak disk use is 178800 bytes, but the data volume has 1 free bytes and 0 usable bytes after the required 10% reserve.",
    );
    expect(startProject).not.toHaveBeenCalled();
  });

  it("shows the soft disk warning and continues with the enabled option", async () => {
    const { client, analyze } = fixture();
    const { renderClient, startProject } = renderClientWithEstimateContext(
      vi.fn(async () => ({ freeSpaceBytes: 220_000, calibrations: [] })),
    );
    renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");
    const renderButton = await screen.findByRole("button", { name: "Render" });
    await waitFor(() => expect(renderButton).toBeEnabled());

    await userEvent.click(renderButton);

    await waitFor(() =>
      expect(startProject).toHaveBeenCalledWith(project.id, {
        diskSpaceCheckEnabled: true,
      }),
    );
    expect(
      await screen.findByText(
        "Disk space warning: estimated peak disk use is 178800 bytes; the data volume has 220000 free bytes and 165000 usable bytes after the recommended 25% reserve. Rendering will continue.",
      ),
    ).toBeInTheDocument();
  });

  it("allows known insufficient space when disabled and transports false", async () => {
    const { client, analyze } = fixture();
    const { renderClient, startProject } = renderClientWithEstimateContext(
      vi.fn(async () => ({ freeSpaceBytes: 1, calibrations: [] })),
    );
    renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");
    await userEvent.click(
      await screen.findByRole("checkbox", {
        name: "Block renders when disk space is insufficient",
      }),
    );
    const renderButton = await screen.findByRole("button", { name: "Render" });
    await waitFor(() => expect(renderButton).toBeEnabled());

    await userEvent.click(renderButton);

    await waitFor(() =>
      expect(startProject).toHaveBeenCalledWith(project.id, {
        diskSpaceCheckEnabled: false,
      }),
    );
    expect(screen.queryByText(/Disk space warning:/u)).not.toBeInTheDocument();
  });

  it("never blocks from script estimates when measured free space is unavailable", async () => {
    const { client, analyze } = fixture();
    const { renderClient, startProject } = renderClientWithEstimateContext(
      vi.fn(async () => {
        throw new Error("statfs unavailable");
      }),
    );
    renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");
    const renderButton = await screen.findByRole("button", { name: "Render" });
    await waitFor(() => expect(renderButton).toBeEnabled());

    await userEvent.click(renderButton);

    await waitFor(() =>
      expect(startProject).toHaveBeenCalledWith(project.id, {
        diskSpaceCheckEnabled: true,
      }),
    );
  });

  it("keeps project lexicon changes isolated from global entries", async () => {
    const { client, analyze, replace, replaceGlobalLexicon } = fixture();
    renderPage(client, analyze);
    await openProjectTab("Settings");
    const lexicon = (
      await screen.findByRole("heading", { name: "Project lexicon" })
    ).closest("section");
    expect(lexicon).not.toBeNull();
    await userEvent.click(within(lexicon!).getByLabelText("Enabled"));
    expect(within(lexicon!).getByLabelText("Enabled")).not.toBeChecked();
    await userEvent.type(
      within(lexicon!).getAllByLabelText("Script Text")[0]!,
      "GraphQL",
    );
    await userEvent.type(
      within(lexicon!).getAllByLabelText("Spoken Text")[0]!,
      "graph Q L",
    );
    await userEvent.click(
      within(lexicon!).getByRole("button", { name: "Add" }),
    );
    await waitFor(() => expect(replace).toHaveBeenCalled(), { timeout: 2_000 });
    expect(replace.mock.calls.at(-1)?.[1].lexiconEntries).toContainEqual(
      expect.objectContaining({
        displayText: "GraphQL",
        spokenText: "graph Q L",
        entryType: "exactTerm",
        caseSensitive: false,
        wholeWord: true,
        priority: 0,
        enabled: true,
        notes: "",
      }),
    );
    expect(replaceGlobalLexicon).not.toHaveBeenCalled();
  });

  it("uses the singleton model and maps searchable friendly voices with raw IDs", async () => {
    const { client, analyze, replace } = fixture();
    const summary = {
      schemaVersion: 1 as const,
      overall: "connected" as const,
      testedAt: "2026-08-12T12:00:00.000Z",
      httpStatus: 200,
      stages: [
        "url",
        "dns",
        "tcp",
        "http",
        "authentication",
        "model",
        "voice",
        "audio",
      ].map((stage) => ({
        stage: stage as "url",
        status: "pass" as const,
        code: `${stage}-pass`,
        message: "Passed.",
        durationMs: 1,
      })),
      availableModelIds: ["speaches-ai/Kokoro-82M-v1.0-ONNX"],
      availableVoiceIds: ["af_heart"],
    };
    const connection: SpeechBackendConnection = {
      backendId: "speaches",
      baseUrl: "http://127.0.0.1:8000",
      suppliedUrlForm: "root",
      configured: true,
      defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      defaultVoiceId: "af_heart",
      timeoutSeconds: 120,
      retryCount: 2,
      responseFormat: "wav",
      lastTestedAt: summary.testedAt,
      lastSuccessfulTestAt: summary.testedAt,
      lastTestSummary: summary as SpeechBackendConnection["lastTestSummary"],
      createdAt: summary.testedAt,
      updatedAt: summary.testedAt,
    };
    const catalog: VoiceCatalog = {
      schemaVersion: 1,
      modelId: connection.defaultModelId!,
      entries: [
        {
          voiceId: "af_heart",
          label: "Heart — American English — af_heart",
          enabled: true,
          favorite: false,
          language: "American English",
          locale: "en-US",
          accent: "American",
          category: null,
          style: null,
          sampleText: null,
        },
        {
          voiceId: "af_sky",
          label: "Sky — American English — af_sky",
          enabled: true,
          favorite: true,
          language: "American English",
          locale: "en-US",
          accent: "American",
          category: null,
          style: null,
          sampleText: null,
        },
      ],
    };
    renderPage(client, analyze, { connection, catalog });
    await openProjectTab("Settings");
    await waitFor(() => expect(analyze).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText("Voice for speaker teacher")).toHaveValue(
        "af_heart",
      ),
    );
    const speakers = screen.getByRole("region", { name: "Project speakers" });
    expect(within(speakers).getByRole("table")).toBeInTheDocument();
    expect(
      within(speakers)
        .getAllByRole("columnheader")
        .map(({ textContent }) => textContent),
    ).toEqual(["Name", "Voice", "Speed", "Gain dB"]);
    expect(screen.getByLabelText("Name for speaker teacher")).toHaveValue(
      "Teacher",
    );
    expect(screen.getByLabelText("Speed for speaker teacher")).toHaveValue(1);
    expect(screen.getByLabelText("Gain dB for speaker teacher")).toHaveValue(0);
    expect(screen.queryByText("Project Timings")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Pauses$/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/1 uses/u)).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Heart (af_heart | en-US)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Sky (af_sky | en-US)" }),
    ).toBeInTheDocument();
    expect(
      [
        ...screen
          .getByLabelText("Voice for speaker teacher")
          .querySelectorAll("optgroup"),
      ].map(({ label }) => label),
    ).toEqual(["Favorites", "en-US"]);
    expect(
      screen.queryByText("Heart — American English — af_heart"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("available")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Project connection" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Optional model override"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        project.id,
        expect.objectContaining({
          speakerMappings: [
            expect.objectContaining({
              speakerId: "teacher",
              voiceId: "af_heart",
            }),
          ],
        }),
      ),
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Voice for speaker teacher"),
      "af_sky",
    );
    expect(screen.getByLabelText("Voice for speaker teacher")).toHaveValue(
      "af_sky",
    );
  });

  it("filters voices by model from one session discovery and appends unknown supported voices", async () => {
    const connection: SpeechBackendConnection = {
      backendId: "speaches",
      baseUrl: "http://127.0.0.1:8000",
      suppliedUrlForm: "root",
      configured: true,
      defaultModelId: "model-a",
      defaultVoiceId: "voice-a",
      timeoutSeconds: 120,
      retryCount: 2,
      responseFormat: "wav",
      lastTestedAt: null,
      lastSuccessfulTestAt: null,
      lastTestSummary: null,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    };
    const connected = {
      ...project,
      speakerMappings: [{ ...project.speakerMappings[0]!, voiceId: "voice-a" }],
    };
    const { client, analyze, replace } = fixture(connected);
    const catalog: VoiceCatalog = {
      schemaVersion: 1,
      modelId: "model-a",
      entries: [
        {
          voiceId: "voice-a",
          label: "Catalog A",
          enabled: true,
          favorite: false,
          language: null,
          locale: null,
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
        {
          voiceId: "voice-b",
          label: "Catalog B",
          enabled: true,
          favorite: false,
          language: null,
          locale: null,
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
        {
          voiceId: "voice-disabled",
          label: "Disabled",
          enabled: false,
          favorite: false,
          language: null,
          locale: null,
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
      ],
    };
    const speechCatalog: SpeechCatalog = {
      schemaVersion: 1,
      models: [
        {
          modelId: "model-a",
          voices: [
            {
              voiceId: "voice-a",
              name: "Server A",
              language: null,
              gender: null,
            },
            {
              voiceId: "voice-new",
              name: "New server voice",
              language: "English",
              gender: null,
            },
            {
              voiceId: "voice-disabled",
              name: "Disabled server voice",
              language: null,
              gender: null,
            },
          ],
        },
        {
          modelId: "model-b",
          voices: [
            {
              voiceId: "voice-b",
              name: "Server B",
              language: null,
              gender: null,
            },
          ],
        },
      ],
    };
    const { connections } = renderPage(client, analyze, {
      connection,
      catalog,
      speechCatalog,
    });
    await openProjectTab("Settings");

    expect(
      await screen.findByLabelText("Voice for speaker teacher"),
    ).toHaveValue("voice-a");
    expect(
      screen.getByRole("option", {
        name: "Server A (voice-a | Locale unavailable)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "New server voice (voice-new | Locale unavailable)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Disabled" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Catalog B" }),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole("option", {
        name: "Server B (voice-b | Locale unavailable)",
      }),
    ).not.toBeInTheDocument();
    expect(connections.discoverSpeechCatalog).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("preserves the saved voice on discovery failure and retries without a synthesis request", async () => {
    const connection: SpeechBackendConnection = {
      backendId: "speaches",
      baseUrl: "http://127.0.0.1:8000",
      suppliedUrlForm: "root",
      configured: true,
      defaultModelId: "model-a",
      defaultVoiceId: "voice-a",
      timeoutSeconds: 120,
      retryCount: 2,
      responseFormat: "wav",
      lastTestedAt: null,
      lastSuccessfulTestAt: null,
      lastTestSummary: null,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    };
    const connected = {
      ...project,
      speakerMappings: [{ ...project.speakerMappings[0]!, voiceId: "voice-a" }],
    };
    const { client, analyze, replace } = fixture(connected);
    const catalog: VoiceCatalog = {
      schemaVersion: 1,
      modelId: "model-a",
      entries: [
        {
          voiceId: "voice-a",
          label: "Catalog A",
          enabled: true,
          favorite: false,
          language: null,
          locale: null,
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
      ],
    };
    const speechCatalog: SpeechCatalog = {
      schemaVersion: 1,
      models: [
        {
          modelId: "model-a",
          voices: [
            {
              voiceId: "voice-a",
              name: "Voice A",
              language: null,
              gender: null,
            },
          ],
        },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const discovery = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Supported voices are temporarily unavailable."),
      )
      .mockResolvedValue(speechCatalog);
    const { connections } = renderPage(client, analyze, {
      connection,
      catalog,
      speechCatalog,
      discovery,
    });
    await openProjectTab("Settings");

    expect(
      await screen.findByLabelText("Voice for speaker teacher"),
    ).toBeDisabled();
    expect(
      screen.getByText("Supported voices are temporarily unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByText("voice-a")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("button", { name: "Retry supported voices" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Voice for speaker teacher")).toHaveValue(
        "voice-a",
      ),
    );
    expect(
      screen.getByRole("option", {
        name: "Voice A (voice-a | Locale unavailable)",
      }),
    ).toBeInTheDocument();
    expect(connections.discoverSpeechCatalog).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the global voice catalog before a project connection is selected", async () => {
    const unreconciled = { ...project, speakerMappings: [] };
    const { client, analyze, replace } = fixture(unreconciled);
    const { voiceCatalog } = renderPage(client, analyze, {
      catalog: globalCatalog,
    });
    await openProjectTab("Settings");

    expect(
      await screen.findByLabelText("Voice for speaker teacher"),
    ).toBeEnabled();
    expect(screen.getByLabelText("Voice for speaker teacher")).toHaveValue(
      "af_heart",
    );
    expect(
      screen.getByRole("option", { name: "Sky (af_sky | en-US)" }),
    ).toBeInTheDocument();
    expect(voiceCatalog.get).toHaveBeenCalledWith(
      GLOBAL_VOICE_CATALOG_MODEL_ID,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        project.id,
        expect.objectContaining({
          speakerMappings: [
            expect.objectContaining({
              speakerId: "teacher",
              voiceId: "af_heart",
            }),
          ],
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("MISSING_VOICE_MAPPING"),
      ).not.toBeInTheDocument(),
    );
  });

  it("analyzes offline, renders the narration score, and autosaves edits", async () => {
    const { client, analyze, replace } = fixture();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderPage(client, analyze);

    expect(
      await screen.findByRole("heading", { name: "Script editor" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Upload .txt")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Find text")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Replacement text")).not.toBeInTheDocument();
    expect(screen.queryByText(/drop a UTF-8/u)).not.toBeInTheDocument();
    await waitFor(() => expect(analyze).toHaveBeenCalled());
    expect(
      screen.getByRole("region", { name: "Script editor content" }),
    ).toHaveAttribute("tabindex", "0");
    await openProjectTab("Details");
    expect(
      screen.getByRole("region", { name: "Narration score content" }),
    ).toHaveAttribute("tabindex", "0");
    const score = await screen.findByLabelText("Dry run ordered segment table");
    expect(within(score).getByText("Speaker / cue")).toBeInTheDocument();
    expect(within(score).getByText("Original")).toBeInTheDocument();
    expect(within(score).getByText("Readable")).toBeInTheDocument();
    expect(within(score).getByText("TTS text")).toBeInTheDocument();
    expect(score).toHaveTextContent("teacher");
    expect(score).not.toHaveTextContent("voice_teacher");
    expect(
      within(score).getAllByLabelText(
        "Speaker teacher. Voice ID voice_teacher",
      ),
    ).toEqual([
      expect.objectContaining({ title: "Voice ID: voice_teacher" }),
      expect.objectContaining({ title: "Voice ID: voice_teacher" }),
    ]);
    expect(score).toHaveTextContent("sequel");
    await openProjectTab("Settings");
    expect(
      screen.getByRole("article", { name: "Lexicon entry SQL" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/1 matches/u)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    const projectName = screen.getByLabelText("Project name");
    fireEvent.change(projectName, { target: { value: "Autosaved study" } });
    expect(
      screen.queryByText(
        /Unsaved changes|Saving…|Save failed|Invalid changes/u,
      ),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalled(), { timeout: 2_000 });
    expect(replace.mock.calls.at(-1)?.[1]).toMatchObject({
      name: "Autosaved study",
    });
    await waitFor(() =>
      expect(screen.queryByText(/^Saved$/u)).not.toBeInTheDocument(),
    );
  });

  it("persists and restores exact diagnostic suppressions", async () => {
    const { client, analyze, replaceIgnoredDiagnostics } = fixture({
      ...project,
      scriptSource: "[section Topic]\n[speaker_teacher] Second.",
    });
    renderPage(client, analyze);
    await openProjectTab("Details");

    expect(
      await screen.findByText("MALFORMED_SECTION_DIRECTIVE"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Ignore this pattern" }),
    );
    await waitFor(() =>
      expect(replaceIgnoredDiagnostics).toHaveBeenCalledWith([
        expect.objectContaining({ code: "MALFORMED_SECTION_DIRECTIVE" }),
      ]),
    );
    expect(
      await screen.findByRole("region", {
        name: "Ignored diagnostic patterns",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Ignore this pattern" }),
      ).not.toBeInTheDocument(),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Restore this pattern" }),
    );
    await waitFor(() =>
      expect(replaceIgnoredDiagnostics).toHaveBeenLastCalledWith([]),
    );
    expect(
      await screen.findByText("MALFORMED_SECTION_DIRECTIVE"),
    ).toBeInTheDocument();
  });

  it("schedules one autosave for an edit burst instead of re-arming while saving", async () => {
    const { client, analyze, replace } = fixture();
    const pendingSave = deferred<ProjectDetail>();
    replace.mockImplementationOnce(() => pendingSave.promise);
    const timerSpy = vi.spyOn(window, "setTimeout");
    renderPage(client, analyze);

    await screen.findByRole("textbox", { name: "Script source" });
    await waitFor(() => expect(analyze).toHaveBeenCalled());
    timerSpy.mockClear();

    const pastedSource = `[speaker_teacher] ${"Responsive paste 🧠 ".repeat(2_000)}`;
    replaceScriptSource("[speaker_teacher] Autosave revision one");
    replaceScriptSource("[speaker_teacher] Autosave revision two");
    replaceScriptSource(pastedSource);
    const editTimers = timerSpy.mock.calls.filter(
      ([, delay]) => delay === 800,
    ).length;
    expect(scriptEditorView().state.doc.toString()).toBe(pastedSource);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    });
    expect(editTimers).toBe(3);
    expect(
      timerSpy.mock.calls.filter(([, delay]) => delay === 800),
    ).toHaveLength(editTimers);
    expect(replace).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({ scriptSource: pastedSource }),
    );

    pendingSave.resolve({
      ...project,
      scriptSource: pastedSource,
      updatedAt: "2026-08-12T13:30:00.000Z",
    });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/^Saved$/u)).not.toBeInTheDocument();
  });

  it("does not autosave discovery reconciliation when the user has not edited the project", async () => {
    const unreconciled = { ...project, speakerMappings: [] };
    const { client, analyze, replace } = fixture(unreconciled);
    const timerSpy = vi.spyOn(window, "setTimeout");
    renderPage(client, analyze);
    await openProjectTab("Settings");

    await waitFor(() => expect(analyze).toHaveBeenCalled());
    expect(
      await screen.findByLabelText("Voice for speaker teacher"),
    ).toBeDisabled();
    expect(screen.getByLabelText("Voice for speaker teacher")).toHaveValue("");
    expect(
      screen.getByText("The global voice catalog has no enabled voices."),
    ).toBeInTheDocument();
    expect(
      timerSpy.mock.calls.filter(([, delay]) => delay === 800),
    ).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Saved$/u)).not.toBeInTheDocument();
  });

  it("serializes saves so a stale response cannot overwrite a newer revision", async () => {
    const { client, analyze, replace } = fixture();
    const firstSave = deferred<ProjectDetail>();
    replace.mockImplementationOnce(() => firstSave.promise);
    replace.mockImplementationOnce(async (_id, input) => ({
      ...project,
      ...input,
      lexiconEntries: project.lexiconEntries,
      updatedAt: "2026-08-12T14:00:00.000Z",
    }));
    renderPage(client, analyze);
    const projectName = await screen.findByDisplayValue("Authoring study");

    fireEvent.change(projectName, { target: { value: "Revision one" } });
    const saveButton = screen.getByRole("button", { name: "Save now" });
    const initialClassName = saveButton.className;
    fireEvent.click(saveButton);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(saveButton).toBeEnabled();
    expect(saveButton.className).toBe(initialClassName);
    fireEvent.change(projectName, { target: { value: "Revision two" } });
    fireEvent.click(saveButton);
    firstSave.resolve({
      ...project,
      name: "Revision one",
      updatedAt: "2026-08-12T13:30:00.000Z",
    });

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2), {
      timeout: 2_000,
    });
    expect(replace.mock.calls.map((call) => call[1].name)).toEqual([
      "Revision one",
      "Revision two",
    ]);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/^Saved$/u)).not.toBeInTheDocument();
    expect(projectName).toHaveValue("Revision two");
  });

  it("flushes a valid pending revision before duplication", async () => {
    const { client, analyze, replace, duplicate } = fixture();
    const prompt = vi
      .spyOn(window, "prompt")
      .mockReturnValue("Authoring study copy");
    renderPage(client, analyze);
    const description = await screen.findByDisplayValue("Offline fixture");
    fireEvent.change(description, {
      target: { value: "Pending duplicate source" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    await waitFor(() =>
      expect(duplicate).toHaveBeenCalledWith(project.id, {
        name: "Authoring study copy",
      }),
    );
    expect(prompt).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({ description: "Pending duplicate source" }),
    );
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(
      duplicate.mock.invocationCallOrder[0]!,
    );
  });

  it("flushes pending edits before inline segment playback and removes the outline and audible preview", async () => {
    const { source } = installAudioContext();
    const { client, analyze, replace } = fixture(project);
    const connection: SpeechBackendConnection = {
      backendId: "speaches",
      baseUrl: "http://127.0.0.1:8000",
      suppliedUrlForm: "root",
      configured: true,
      defaultModelId: "model",
      defaultVoiceId: "voice_teacher",
      timeoutSeconds: 120,
      retryCount: 0,
      responseFormat: "wav",
      lastTestedAt: null,
      lastSuccessfulTestAt: null,
      lastTestSummary: null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const catalog: VoiceCatalog = {
      schemaVersion: 1,
      modelId: "model",
      entries: [
        {
          voiceId: "voice_teacher",
          label: "Teacher Voice",
          enabled: true,
          favorite: false,
          language: null,
          locale: null,
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
      ],
    };
    const preview = vi.fn(
      async (
        _projectId: string,
        input: { mode: "segment" | "pronunciation" },
      ) => projectPreviewResult(input.mode),
    );
    renderPage(client, analyze, {
      connection,
      catalog,
      speechCatalog: {
        schemaVersion: 1,
        models: [
          {
            modelId: "model",
            voices: [
              {
                voiceId: "voice_teacher",
                name: "Teacher Voice",
                language: null,
                gender: null,
              },
            ],
          },
        ],
      },
      previewClient: { preview } as unknown as ProjectPreviewClient,
    });

    fireEvent.change(await screen.findByDisplayValue("Offline fixture"), {
      target: { value: "Pending preview edit" },
    });
    await openProjectTab("Details");
    expect(
      screen.queryByRole("heading", { name: "Sections" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Project outline")).not.toBeInTheDocument();
    const playButton = (
      await screen.findAllByRole("button", { name: /Play narration row/u })
    )[0]!;
    await userEvent.click(playButton);
    expect(
      await screen.findByRole("button", { name: /Playing narration row/u }),
    ).toBeInTheDocument();
    expect(source.start).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("region", { name: "Project preview result" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Audible preview")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Preview" }),
    ).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({ description: "Pending preview edit" }),
    );
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(
      preview.mock.invocationCallOrder[0]!,
    );
    act(() => source.onended?.());
    expect(
      screen.getAllByRole("button", { name: /Play narration row/u }).length,
    ).toBeGreaterThan(0);

    await openProjectTab("Settings");
    expect(
      screen.queryByLabelText("Pronunciation test"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Preview pronunciation" }),
    ).not.toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("shows the simplified render-and-listen surface without plan internals", async () => {
    const { client, analyze } = fixture();
    renderPage(client, analyze);
    await openProjectTab("Render");
    expect(
      screen.getByRole("heading", { name: "Project details" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Project name")).toHaveValue(project.name);
    expect(screen.getByLabelText("Description")).toHaveValue(
      project.description,
    );
    expect(
      screen.getByRole("button", { name: "Save now" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Duplicate" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Render and listen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/first render may take longer/u),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Frozen render plans/u)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Saved render plans"),
    ).not.toBeInTheDocument();
  });

  it("streams render progress and restores prior audio after a terminal failure", async () => {
    const { client, analyze } = fixture();
    const priorJob: RenderJob = {
      contractVersion: 1,
      id: "00000000-0000-4000-8000-000000000010",
      projectId: project.id,
      planId: "00000000-0000-4000-8000-000000000011",
      retryOfRenderId: null,
      pinned: false,
      state: "complete",
      progress: {
        phase: "complete",
        sectionTitle: null,
        sectionOrdinal: 1,
        sectionCount: 1,
        entryOrdinal: null,
        speechOrdinal: 1,
        speechCount: 1,
        chunkOrdinal: null,
        completedChunks: 1,
        totalChunks: 1,
        cacheHits: 0,
        cacheMisses: 1,
        ttsRequests: 1,
        speakerId: null,
        voiceId: null,
        excerpt: null,
        elapsedMs: 1_000,
      },
      error: null,
      createdAt: "2026-08-12T13:00:00.000Z",
      startedAt: "2026-08-12T13:00:00.000Z",
      finishedAt: "2026-08-12T13:00:01.000Z",
    };
    const renderingJob: RenderJob = {
      ...priorJob,
      id: "00000000-0000-4000-8000-000000000012",
      planId: "00000000-0000-4000-8000-000000000013",
      state: "synthesizing",
      progress: {
        ...priorJob.progress,
        phase: "synthesizing",
        speechOrdinal: 12,
        speechCount: 300,
        chunkOrdinal: 1,
        completedChunks: 11,
        totalChunks: 300,
        elapsedMs: 500,
      },
      createdAt: "2026-08-12T14:00:00.000Z",
      startedAt: "2026-08-12T14:00:00.000Z",
      finishedAt: null,
    };
    const failedJob: RenderJob = {
      ...renderingJob,
      state: "failed",
      progress: { ...renderingJob.progress, phase: "failed" },
      error: {
        code: "RENDER_SYNTHESIS_FAILED",
        message: "Speech generation failed.",
        retryable: true,
        phase: "synthesizing",
        entryOrdinal: 12,
        chunkOrdinal: 1,
        sourceRange: null,
        speakerId: "teacher",
        voiceId: "voice_teacher",
      },
      finishedAt: "2026-08-12T14:00:01.000Z",
    };
    const startRequest = deferred<RenderJob>();
    const getRender = vi.fn(async () => failedJob);
    let publish: ((job: RenderJob) => void) | undefined;
    let reportDropped: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(
      (
        _renderId: string,
        onJob: (job: RenderJob) => void,
        onDropped: () => void,
      ) => {
        publish = onJob;
        reportDropped = onDropped;
        return unsubscribe;
      },
    );
    const renderClient = {
      start: vi.fn(() => startRequest.promise),
      startProject: vi.fn(() => startRequest.promise),
      getEstimateContext: vi.fn(async () => ({
        freeSpaceBytes: 1_073_741_824,
        calibrations: [],
      })),
      list: vi.fn(async () => [priorJob]),
      get: getRender,
      subscribe,
      cancel: vi.fn(),
      retry: vi.fn(),
      listArtifacts: vi.fn(async () => []),
      exportArtifact: vi.fn(),
      exportAudio: vi.fn(),
      exportDetails: vi.fn(),
      listSegments: vi.fn(async () => []),
      getWaveform: vi.fn(async () => ({
        status: "unavailable" as const,
        renderId: priorJob.id,
        reason: "audioMissing" as const,
      })),
      renderAudioSource: vi.fn(
        (renderId: string) => `/renders/${renderId}.mp3`,
      ),
      segmentAudioSource: vi.fn(),
      exportSegment: vi.fn(),
    } as unknown as RenderProgressClient;
    renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");
    const player = await screen.findByLabelText(
      "Audio player for Completed project render",
    );
    const renderButton = await screen.findByRole("button", { name: "Render" });
    await waitFor(() => expect(renderButton).toBeEnabled());
    fireEvent.click(renderButton);

    expect(screen.getByRole("button", { name: "Rendering…" })).toBeDisabled();
    expect(screen.getByText("Preparing render…")).toBeInTheDocument();
    expect(screen.getByLabelText("Render chunk progress")).not.toHaveAttribute(
      "value",
    );
    expect(player).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Download Details" }),
    ).toBeDisabled();

    await act(async () => {
      startRequest.resolve(renderingJob);
      await startRequest.promise;
    });
    expect(
      await screen.findByText("Processing chunk 12 of 300"),
    ).toBeInTheDocument();
    expect(screen.getByText("11 of 300 chunks complete")).toBeInTheDocument();
    expect(screen.getByLabelText("Render chunk progress")).toHaveAttribute(
      "max",
      "300",
    );
    expect(screen.getByLabelText("Render chunk progress")).toHaveAttribute(
      "value",
      "11",
    );

    await waitFor(() =>
      expect(subscribe).toHaveBeenCalledWith(
        renderingJob.id,
        expect.any(Function),
        expect.any(Function),
      ),
    );
    expect(reportDropped).toEqual(expect.any(Function));
    expect(getRender).not.toHaveBeenCalled();

    const streamedJob: RenderJob = {
      ...renderingJob,
      progress: {
        ...renderingJob.progress,
        completedChunks: 12,
        elapsedMs: 750,
      },
    };
    act(() => publish!(streamedJob));
    expect(
      await screen.findByText("Processing chunk 13 of 300"),
    ).toBeInTheDocument();
    expect(screen.getByText("12 of 300 chunks complete")).toBeInTheDocument();

    act(() => publish!(failedJob));
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeEnabled();
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
    expect(getRender).not.toHaveBeenCalled();
    expect(player).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Download Details" }),
    ).toBeEnabled();
  });

  it("ignores stale reconciliation after recovered stream progress and unsubscribes on unmount", async () => {
    const { client, analyze } = fixture();
    const activeJob = renderJobFixture(
      "00000000-0000-4000-8000-000000000092",
      "synthesizing",
    );
    const reconciledJob = renderJobFixture(activeJob.id, "synthesizing", 2);
    const recoveredJob = renderJobFixture(activeJob.id, "synthesizing", 3);
    const getRequest = deferred<RenderJob>();
    const getRender = vi.fn(() => getRequest.promise);
    let publish: ((job: RenderJob) => void) | undefined;
    let reportDropped: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(
      (
        _renderId: string,
        onJob: (job: RenderJob) => void,
        onDropped: () => void,
      ) => {
        publish = onJob;
        reportDropped = onDropped;
        return unsubscribe;
      },
    );
    const renderClient = renderClientFixture([activeJob], getRender, subscribe);
    const page = renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce());

    act(() => {
      reportDropped!();
      reportDropped!();
      reportDropped!();
    });
    await waitFor(() => expect(getRender).toHaveBeenCalledWith(activeJob.id));
    expect(getRender).toHaveBeenCalledOnce();
    act(() => publish!(recoveredJob));
    expect(
      await screen.findByText("3 of 4 chunks complete"),
    ).toBeInTheDocument();

    await act(async () => {
      getRequest.resolve(reconciledJob);
      await getRequest.promise;
    });
    expect(screen.getByText("3 of 4 chunks complete")).toBeInTheDocument();
    expect(
      screen.queryByText("2 of 4 chunks complete"),
    ).not.toBeInTheDocument();
    expect(subscribe).toHaveBeenCalledOnce();

    page.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    act(() => reportDropped!());
    expect(getRender).toHaveBeenCalledOnce();
  });

  it("keeps a locally started render when the initial render list resolves late", async () => {
    const { client, analyze } = fixture();
    const activeJob = renderJobFixture(
      "00000000-0000-4000-8000-000000000094",
      "synthesizing",
    );
    const listRequest = deferred<RenderJob[]>();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const renderClient: RenderProgressClient = {
      ...renderClientFixture([], vi.fn(), subscribe),
      startProject: vi.fn(async () => activeJob),
      list: vi.fn(() => listRequest.promise),
    };
    renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");
    const renderButton = await screen.findByRole("button", { name: "Render" });
    await waitFor(() => expect(renderButton).toBeEnabled());
    fireEvent.click(renderButton);
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
    expect(screen.getByText("1 of 4 chunks complete")).toBeInTheDocument();

    await act(async () => {
      listRequest.resolve([]);
      await listRequest.promise;
    });
    expect(screen.getByText("1 of 4 chunks complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rendering…" })).toBeDisabled();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("discards a delayed render start after navigating to another project", async () => {
    const { client, analyze } = fixture();
    const nextProject: ProjectDetail = {
      ...project,
      id: "00000000-0000-4000-8000-000000000002",
      name: "Navigation target",
    };
    client.projects.list = vi.fn(async () =>
      [project, nextProject].map((item): ProjectSummary => ({
        id: item.id,
        name: item.name,
        description: item.description,
        scriptHash: item.scriptHash,
        scriptLineCount: item.scriptSource.split("\n").length,
        audioDurationMs: null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    );
    client.projects.get = vi.fn(async (id: string) =>
      structuredClone(id === project.id ? project : nextProject),
    );

    const staleProjectJob = renderJobFixture(
      "00000000-0000-4000-8000-000000000095",
      "synthesizing",
    );
    const activeProjectJob: RenderJob = {
      ...renderJobFixture(
        "00000000-0000-4000-8000-000000000096",
        "synthesizing",
        2,
      ),
      projectId: nextProject.id,
    };
    const startRequest = deferred<RenderJob>();
    const listRequest = deferred<RenderJob[]>();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const startProject = vi.fn(() => startRequest.promise);
    const listRenders = vi.fn((id: string) =>
      id === nextProject.id ? listRequest.promise : Promise.resolve([]),
    );
    const renderClient: RenderProgressClient = {
      ...renderClientFixture([], vi.fn(), subscribe),
      startProject,
      list: listRenders,
    };

    renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");
    const renderButton = await screen.findByRole("button", { name: "Render" });
    await waitFor(() => expect(renderButton).toBeEnabled());
    fireEvent.click(renderButton);
    await waitFor(() =>
      expect(startProject).toHaveBeenCalledWith(project.id, {
        diskSpaceCheckEnabled: true,
      }),
    );

    await userEvent.click(
      screen.getByRole("link", { name: /Back to Projects/u }),
    );
    await userEvent.click(
      await screen.findByRole("link", { name: nextProject.name }),
    );
    expect(
      await screen.findByDisplayValue(nextProject.name),
    ).toBeInTheDocument();
    await openProjectTab("Render");
    await waitFor(() =>
      expect(listRenders).toHaveBeenCalledWith(nextProject.id),
    );

    await act(async () => {
      startRequest.resolve(staleProjectJob);
      await startRequest.promise;
    });
    expect(
      screen.queryByText("1 of 4 chunks complete"),
    ).not.toBeInTheDocument();
    expect(subscribe).not.toHaveBeenCalledWith(
      staleProjectJob.id,
      expect.any(Function),
      expect.any(Function),
    );

    await act(async () => {
      listRequest.resolve([activeProjectJob]);
      await listRequest.promise;
    });
    expect(
      await screen.findByText("2 of 4 chunks complete"),
    ).toBeInTheDocument();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledWith(
      activeProjectJob.id,
      expect.any(Function),
      expect.any(Function),
    );
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("keeps the current project render pending when a stale start rejects", async () => {
    const { client, analyze } = fixture();
    const nextProject: ProjectDetail = {
      ...project,
      id: "00000000-0000-4000-8000-000000000002",
      name: "Navigation target",
    };
    client.projects.list = vi.fn(async () =>
      [project, nextProject].map((item): ProjectSummary => ({
        id: item.id,
        name: item.name,
        description: item.description,
        scriptHash: item.scriptHash,
        scriptLineCount: item.scriptSource.split("\n").length,
        audioDurationMs: null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    );
    client.projects.get = vi.fn(async (id: string) =>
      structuredClone(id === project.id ? project : nextProject),
    );

    const staleStartRequest = deferred<RenderJob>();
    const activeStartRequest = deferred<RenderJob>();
    const activeProjectJob: RenderJob = {
      ...renderJobFixture(
        "00000000-0000-4000-8000-000000000097",
        "synthesizing",
        2,
      ),
      projectId: nextProject.id,
    };
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const startProject = vi.fn((id: string) =>
      id === project.id
        ? staleStartRequest.promise
        : activeStartRequest.promise,
    );
    const renderClient: RenderProgressClient = {
      ...renderClientFixture([], vi.fn(), subscribe),
      startProject,
      list: vi.fn(async () => []),
    };

    renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");
    const firstRenderButton = await screen.findByRole("button", {
      name: "Render",
    });
    await waitFor(() => expect(firstRenderButton).toBeEnabled());
    fireEvent.click(firstRenderButton);
    await waitFor(() =>
      expect(startProject).toHaveBeenCalledWith(project.id, {
        diskSpaceCheckEnabled: true,
      }),
    );

    await userEvent.click(
      screen.getByRole("link", { name: /Back to Projects/u }),
    );
    await userEvent.click(
      await screen.findByRole("link", { name: nextProject.name }),
    );
    expect(
      await screen.findByDisplayValue(nextProject.name),
    ).toBeInTheDocument();
    await openProjectTab("Render");
    const activeRenderButton = await screen.findByRole("button", {
      name: "Render",
    });
    await waitFor(() => expect(activeRenderButton).toBeEnabled());
    fireEvent.click(activeRenderButton);
    await waitFor(() =>
      expect(startProject).toHaveBeenCalledWith(nextProject.id, {
        diskSpaceCheckEnabled: true,
      }),
    );
    expect(screen.getByRole("button", { name: "Rendering…" })).toBeDisabled();

    await act(async () => {
      staleStartRequest.reject(new Error("Project A render start failed."));
      await staleStartRequest.promise.catch(() => undefined);
    });
    expect(
      screen.queryByText("Project A render start failed."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rendering…" })).toBeDisabled();
    expect(screen.getByText("Preparing render…")).toBeInTheDocument();

    await act(async () => {
      activeStartRequest.resolve(activeProjectJob);
      await activeStartRequest.promise;
    });
    expect(
      await screen.findByText("2 of 4 chunks complete"),
    ).toBeInTheDocument();
    expect(subscribe).toHaveBeenCalledWith(
      activeProjectJob.id,
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("retains polling for an Electron render client without subscriptions and stops on terminal state", async () => {
    const { client, analyze } = fixture();
    const activeJob = renderJobFixture(
      "00000000-0000-4000-8000-000000000093",
      "synthesizing",
    );
    const failedJob = renderJobFixture(activeJob.id, "failed");
    const getRender = vi.fn(async () => failedJob);
    const clearInterval = vi.spyOn(window, "clearInterval");
    const renderClient = renderClientFixture([activeJob], getRender);

    renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");
    await waitFor(() => expect(getRender).toHaveBeenCalledWith(activeJob.id), {
      timeout: 1_500,
    });
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeEnabled();
    await waitFor(() => expect(clearInterval).toHaveBeenCalled());
    expect(getRender).toHaveBeenCalledOnce();
  });

  it("starts the project render and exposes only completed playback and downloads", async () => {
    const { client, analyze } = fixture();
    const plan = frozenPlan(
      "00000000-0000-4000-8000-000000000002",
      project.scriptHash,
      "2026-08-12T14:00:00.000Z",
    );
    const job = {
      contractVersion: 1 as const,
      id: "00000000-0000-4000-8000-000000000003",
      projectId: project.id,
      planId: plan.id,
      retryOfRenderId: null,
      pinned: false,
      state: "complete" as const,
      progress: {
        phase: "complete" as const,
        sectionTitle: null,
        sectionOrdinal: 0,
        sectionCount: 0,
        entryOrdinal: null,
        speechOrdinal: 1,
        speechCount: 1,
        chunkOrdinal: null,
        completedChunks: 1,
        totalChunks: 1,
        cacheHits: 0,
        cacheMisses: 1,
        ttsRequests: 1,
        speakerId: null,
        voiceId: null,
        excerpt: null,
        elapsedMs: 1_000,
      },
      error: null,
      createdAt: "2026-08-12T14:00:00.000Z",
      startedAt: "2026-08-12T14:00:00.000Z",
      finishedAt: "2026-08-12T14:00:01.000Z",
    };
    const artifact = {
      contractVersion: 1 as const,
      id: "00000000-0000-4000-8000-000000000004",
      renderId: job.id,
      type: "mp3" as const,
      fileName: "offline-fixture.mp3",
      sizeBytes: 1_024,
      checksum: "a".repeat(64),
      durationMs: 1_000,
      createdAt: job.finishedAt,
    };
    const start = vi.fn(async () => job);
    const exportArtifact = vi.fn(async () => ({
      disposition: "download" as const,
      fileName: artifact.fileName,
    }));
    const exportDetails = vi.fn(async () => ({
      disposition: "download" as const,
      fileName: "offline-fixture-render-details.zip",
    }));
    const renderClient: RenderClient = {
      startProject: start,
      getEstimateContext: vi.fn(async () => ({
        freeSpaceBytes: 1_073_741_824,
        calibrations: [],
      })),
      list: vi.fn(async () => []),
      get: vi.fn(async () => job),
      cancel: vi.fn(async () => job),
      retry: vi.fn(async () => job),
      setPinned: vi.fn(async () => job),
      listArtifacts: vi.fn(async () => [artifact]),
      exportArtifact,
      exportAudio: exportArtifact,
      exportDetails,
      listSegments: vi.fn(async () => []),
      getWaveform: vi.fn(async () => ({
        status: "unavailable" as const,
        renderId: job.id,
        reason: "audioMissing" as const,
      })),
      renderAudioSource: vi.fn(() => "/render.mp3"),
      segmentAudioSource: vi.fn(() => "/segment.wav"),
      exportSegment: vi.fn(async () => ({
        disposition: "download" as const,
        fileName: "000001.wav",
      })),
    };
    renderPage(client, analyze, {
      renderClient,
    });
    await openProjectTab("Render");
    const renderSection = (
      await screen.findByRole("heading", { name: "Render and listen" })
    ).closest("section")!;
    const renderButton = within(renderSection).getByRole("button", {
      name: "Render",
    });
    await waitFor(() => expect(renderButton).toBeEnabled());
    fireEvent.click(renderButton);
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(project.id, {
        diskSpaceCheckEnabled: true,
      }),
    );
    expect(
      await screen.findByLabelText(
        /Audio player for Completed project render/u,
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(exportArtifact).toHaveBeenCalledWith(job.id);
    await userEvent.click(
      screen.getByRole("button", { name: "Download Details" }),
    );
    expect(exportDetails).toHaveBeenCalledWith(job.id);
  });

  it("pins and unpins the completed render from the render result", async () => {
    const { client, analyze } = fixture();
    const completed = renderJobFixture(
      "00000000-0000-4000-8000-000000000094",
      "complete",
    );
    const renderClient = renderClientFixture(
      [completed],
      async () => completed,
    );
    const setPinned = vi.fn(async (_renderId: string, pinned: boolean) => ({
      ...completed,
      pinned,
    }));
    renderClient.setPinned = setPinned;
    renderPage(client, analyze, { renderClient });
    await openProjectTab("Render");

    const pin = await screen.findByRole("button", {
      name: "Pin completed output",
    });
    await userEvent.click(pin);
    expect(setPinned).toHaveBeenCalledWith(completed.id, true);
    expect(
      await screen.findByRole("button", { name: "Unpin completed output" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(
      screen.getByRole("button", { name: "Unpin completed output" }),
    );
    expect(setPinned).toHaveBeenLastCalledWith(completed.id, false);
  });

  it("rolls back an optimistic save and invalidates the project ledger", async () => {
    const { client, analyze, replace, listProjects } = fixture();
    const pendingSave = deferred<ProjectDetail>();
    replace.mockImplementationOnce(() => pendingSave.promise);
    const { queryClient } = renderPage(client, analyze);
    const projectName = await screen.findByDisplayValue("Authoring study");

    fireEvent.change(projectName, { target: { value: "Pending query save" } });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));

    await waitFor(() =>
      expect(
        queryClient.getQueryData<ProjectDetail>(
          queryKeys.persistence.project(project.id),
        ),
      ).toMatchObject({ name: "Pending query save" }),
    );

    await act(async () => {
      pendingSave.reject(new Error("disk unavailable"));
      await pendingSave.promise.catch(() => undefined);
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<ProjectDetail>(
          queryKeys.persistence.project(project.id),
        ),
      ).toMatchObject({ name: project.name }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "disk unavailable",
    );
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));
  });

  it("shows failed saves and guards unload and route navigation", async () => {
    const { client, analyze, replace } = fixture();
    replace.mockRejectedValueOnce(new Error("disk unavailable"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage(client, analyze);
    const description = await screen.findByDisplayValue("Offline fixture");
    fireEvent.change(description, { target: { value: "Cannot save yet" } });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "disk unavailable",
    );
    expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Settings test link" }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved project changes?");
    expect(screen.queryByText("Settings destination")).not.toBeInTheDocument();
  });
});
