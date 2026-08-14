// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseScript, resolveParagraphPauses, transformScript } from "@studynarrator/core";
import type { IgnoredDiagnosticCollection, PersistenceClient, ProjectDetail, ProjectPreviewResult, ProjectReplaceInput, ProjectPreviewClient, RenderClient, RenderPlan, RenderPlanClient, RenderPlanSummary, SpeachesConnection, SpeechCacheClient, SpeechCatalog, VoiceCatalog } from "@studynarrator/shared-types";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import type { ScriptAnalysisInput } from "@/workers/parser/parserWorkerProtocol.js";
import { GLOBAL_VOICE_CATALOG_MODEL_ID } from "@/features/projects/projectAuthoring.js";
import { ProjectsPage } from "./ProjectsPage.js";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";

const project: ProjectDetail = {
  contractVersion: 6,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Authoring study",
  description: "Offline fixture",
  scriptSource: "[speaker_teacher] SQL.\n[pause_short]\nContinue.",
  scriptHash: "a".repeat(64),
  modelId: null,
  speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: "voice_teacher", speed: 1, gainDb: 0, roleDescription: "", sampleText: "" }],
  pausePresets: [
    { pauseId: "pause_short", durationMs: 350, description: "Brief" },
    { pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }
  ],
  transitionPauses: { paragraph: { mode: "preset", pauseId: "pause_medium" }, speakerChange: { mode: "none" }, section: { mode: "none" } },
  lexiconEntries: [{
    id: "project-sql", scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel",
    caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z"
  }],
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z"
};

const globalCatalog: VoiceCatalog = { schemaVersion: 1, modelId: GLOBAL_VOICE_CATALOG_MODEL_ID, entries: [
  { voiceId: "af_heart", label: "Heart — American English — af_heart", enabled: true, language: "American English", locale: "en-US", accent: "American", category: null, style: null, sampleText: null },
  { voiceId: "af_sky", label: "Sky — American English — af_sky", enabled: true, language: "American English", locale: "en-US", accent: "American", category: null, style: null, sampleText: null }
] };

function projectPreviewResult(mode: "segment" | "pronunciation" = "segment"): ProjectPreviewResult {
  const timestamp = "2026-08-12T12:00:00.000Z";
  return {
    schemaVersion: 2,
    id: "00000000-0000-4000-8000-000000000002",
    createdAt: timestamp,
    projectId: project.id,
    mode,
    nodeOrdinal: mode === "segment" ? 1 : null,
    sourceRange: mode === "segment" ? { start: { line: 1, column: 1 }, end: { line: 1, column: 23 } } : null,
    modelId: "model",
    speakerId: "teacher",
    voiceId: "voice_teacher",
    voiceLabel: "Teacher Voice",
    speed: 1,
    originalText: "SQL.",
    readableText: "SQL.",
    transformedText: "sequel.",
    cache: { key: "a".repeat(64), status: "miss", byteLength: 3, createdAt: timestamp, lastUsedAt: timestamp },
    audio: { mimeType: "audio/wav", base64: "AQID", byteLength: 3 }
  };
}

function frozenPlan(id: string, scriptHash: string, createdAt: string): RenderPlan {
  return {
    schemaVersion: 1,
    id,
    projectId: project.id,
    createdAt,
    snapshotHash: "b".repeat(64),
    planHash: id.endsWith("2") ? "c".repeat(64) : "d".repeat(64),
    scriptHash,
    entries: [
      { type: "section", ordinal: 1, nodeOrdinal: 1, title: "Opening", sectionTitle: "Opening", sourceRange: null },
      {
        type: "speech", ordinal: 2, nodeOrdinal: 2, sectionTitle: "Opening", sourceRange: null,
        speakerId: "teacher", voiceId: "voice_teacher", speed: 1, gainDb: 0,
        originalText: "SQL.", readableText: "SQL.", ttsText: "sequel.",
        chunks: [{ ordinal: 1, text: "sequel.", cacheKey: "e".repeat(64), cacheStatus: "miss" }]
      },
      { type: "pause", ordinal: 3, sectionTitle: "Opening", sourceRange: null, pauseKind: "automatic", reason: "paragraph", pauseId: "pause_medium", durationMs: 750, silence: null }
    ],
    summary: { sectionCount: 1, speechCount: 1, pauseCount: 1, cacheHits: 0, cacheMisses: 1, silenceDurationMs: 750 }
  };
}

function summaryOf(plan: RenderPlan): RenderPlanSummary {
  return {
    id: plan.id, projectId: plan.projectId, createdAt: plan.createdAt, snapshotHash: plan.snapshotHash,
    planHash: plan.planHash, scriptHash: plan.scriptHash, summary: plan.summary
  };
}

function fixture(sourceProject = project) {
  let stored = structuredClone(sourceProject);
  let ignoredDiagnostics: Array<{ code: string; pattern: string }> = [];
  const replace = vi.fn(async (_id: string, input: ProjectReplaceInput) => {
    stored = { ...stored, ...input, modelId: input.modelId ?? stored.modelId, scriptHash: "b".repeat(64), updatedAt: "2026-08-12T13:00:00.000Z", lexiconEntries: stored.lexiconEntries };
    return structuredClone(stored);
  });
  const duplicate = vi.fn(async () => structuredClone(stored));
  const create = vi.fn(async (input: { name: string; description?: string }) => {
    stored = { ...stored, id: "00000000-0000-4000-8000-000000000099", name: input.name, description: input.description ?? "" };
    return structuredClone(stored);
  });
  const replaceIgnoredDiagnostics = vi.fn(async (input: IgnoredDiagnosticCollection) => {
    ignoredDiagnostics = structuredClone(input);
    return structuredClone(input);
  });
  const replaceGlobalLexicon = vi.fn(async () => []);
  const client: PersistenceClient = {
    status: vi.fn(),
    projects: {
      list: vi.fn(async () => [{ id: stored.id, name: stored.name, description: stored.description, scriptHash: stored.scriptHash, createdAt: stored.createdAt, updatedAt: stored.updatedAt }]),
      create,
      get: vi.fn(async () => structuredClone(stored)),
      replace,
      duplicate,
      delete: vi.fn(async () => undefined)
    },
    settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
    preferences: {
      getIgnoredDiagnostics: vi.fn(async () => structuredClone(ignoredDiagnostics)),
      replaceIgnoredDiagnostics
    },
    globalLexicon: { list: vi.fn(async () => []), replace: replaceGlobalLexicon }
  };
  const analyze = vi.fn(async (input: ScriptAnalysisInput) => {
    const { entries, paragraphPause, ...parseInput } = input;
    const parseResult = parseScript(parseInput);
    return {
      parseResult,
      pacingResult: resolveParagraphPauses({ parsedScript: parseResult, configuration: paragraphPause }),
      transformResult: transformScript({ parsedScript: parseResult, entries })
    };
  });
  return { client, analyze, replace, duplicate, create, replaceIgnoredDiagnostics, replaceGlobalLexicon };
}

function renderPage(client: PersistenceClient, analyze: ScriptAnalyzer["analyze"], options: {
  connection?: SpeachesConnection | null;
  catalog?: VoiceCatalog;
  speechCatalog?: SpeechCatalog;
  discovery?: () => Promise<SpeechCatalog>;
  previewClient?: ProjectPreviewClient;
  cacheClient?: SpeechCacheClient;
  renderPlanClient?: RenderPlanClient;
  renderClient?: RenderClient;
  path?: string;
} = {}) {
  const connection = options.connection ?? {
    baseUrl: null, suppliedUrlForm: "unconfigured" as const, configured: false, defaultModelId: null, defaultVoiceId: null,
    timeoutSeconds: 120, retryCount: 2, responseFormat: "wav" as const, lastTestedAt: null, lastSuccessfulTestAt: null,
    lastTestSummary: null, createdAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z"
  };
  const discoveredCatalog = options.speechCatalog ?? {
    schemaVersion: 1 as const,
    models: connection.defaultModelId ? [{
      modelId: connection.defaultModelId,
      voices: (options.catalog?.entries ?? []).map((entry) => ({ voiceId: entry.voiceId, name: entry.label, language: entry.language, gender: null }))
    }] : []
  };
  const connections = {
    get: vi.fn(async () => connection), update: vi.fn(), test: vi.fn(), exportDiagnostics: vi.fn(),
    discoverSpeechCatalog: vi.fn(options.discovery ?? (async () => discoveredCatalog)),
    getSetupState: vi.fn(async () => ({ onboardingCompletedAt: "2026-08-12T12:00:00.000Z", client: "web" as const })),
    completeOnboarding: vi.fn()
  };
  const voiceCatalog = { get: vi.fn(async (modelId: string) => options.catalog ?? ({ schemaVersion: 1 as const, modelId, entries: [] })), replace: vi.fn() };
  const previewClient = options.previewClient ?? { preview: vi.fn() } as unknown as ProjectPreviewClient;
  const cacheClient = options.cacheClient ?? {
    status: vi.fn(), clearAll: vi.fn(),
    clearProject: vi.fn(async () => ({ contractVersion: 1 as const, entriesRemoved: 0, bytesFreed: 0 })),
    clearEntry: vi.fn(async () => ({ contractVersion: 1 as const, entriesRemoved: 0, bytesFreed: 0 }))
  } as unknown as SpeechCacheClient;
  const renderPlanClient = options.renderPlanClient ?? { create: vi.fn(), list: vi.fn(async () => []), get: vi.fn() } as unknown as RenderPlanClient;
  const page = <ProjectsPage client={client} analyzer={{ analyze }} previewClient={previewClient} cacheClient={cacheClient} renderPlanClient={renderPlanClient} {...(options.renderClient ? { renderClient: options.renderClient } : {})} />;
  return { ...render(<ConnectionProvider connectionClient={connections} voiceCatalog={voiceCatalog}><MemoryRouter initialEntries={[options.path ?? `/projects/${project.id}`]}><Link to="/settings">Settings test link</Link><Routes><Route path="/projects" element={page} /><Route path="/projects/:projectId" element={page} /><Route path="/settings" element={<p>Settings destination</p>} /></Routes></MemoryRouter></ConnectionProvider>), connections, voiceCatalog, previewClient, cacheClient, renderPlanClient };
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

async function openProjectTab(name: "Script Editor" | "Settings" | "Details" | "Render") {
  await userEvent.click(await screen.findByRole("tab", { name }));
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Projects workbench", () => {
  it("renders the project index ledger and creates from an expandable form", async () => {
    const { client, analyze, create } = fixture();
    renderPage(client, analyze, { path: "/projects" });

    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Name", "Description", "Created", "Last updated", "Open"]);
    expect(within(table).getByRole("rowheader", { name: "Authoring study" })).toBeInTheDocument();
    expect(screen.queryByText("Your projects")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New project" }));
    await userEvent.type(screen.getByLabelText("Project name"), "Index-created project");
    await userEvent.type(screen.getByLabelText("Description"), "Created from the project index.");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(create).toHaveBeenCalledWith({ name: "Index-created project", description: "Created from the project index." });
    expect(await screen.findByRole("heading", { name: "Project details" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");
  });

  it("deep-links and keyboard-navigates tabs and returns source actions to the editor", async () => {
    const { client, analyze } = fixture();
    renderPage(client, analyze, { path: `/projects/${project.id}?tab=details` });

    const details = await screen.findByRole("tab", { name: "Details" });
    expect(details).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "project-panel-details");
    await userEvent.type(details, "{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Render" })).toHaveAttribute("aria-selected", "true");
    await userEvent.type(screen.getByRole("tab", { name: "Render" }), "{Home}");
    expect(screen.getByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");

    await openProjectTab("Details");
    await userEvent.click((await screen.findAllByRole("button", { name: "Focus source line 1" }))[0]!);
    expect(screen.getByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Script source")).toHaveFocus();
  });

  it("falls back to the script editor for invalid tab queries and reports index loading failures", async () => {
    const loaded = fixture();
    renderPage(loaded.client, loaded.analyze, { path: `/projects/${project.id}?tab=unknown` });
    expect(await screen.findByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");
    cleanup();

    const failed = fixture();
    failed.client.projects.list = vi.fn(async () => { throw new Error("project index unavailable"); });
    renderPage(failed.client, failed.analyze, { path: "/projects" });
    expect(await screen.findByRole("alert")).toHaveTextContent("project index unavailable");
  });

  it("keeps project lexicon changes isolated from global entries", async () => {
    const { client, analyze, replaceGlobalLexicon } = fixture();
    renderPage(client, analyze);
    await openProjectTab("Settings");
    const lexicon = (await screen.findByRole("heading", { name: "Project lexicon" })).closest("section");
    expect(lexicon).not.toBeNull();
    await userEvent.click(within(lexicon!).getByRole("button", { name: "Disable" }));
    expect(within(lexicon!).getByText(/project · exactTerm · disabled/u)).toBeInTheDocument();
    expect(replaceGlobalLexicon).not.toHaveBeenCalled();
  });

  it("uses the singleton model and maps searchable friendly voices with raw IDs", async () => {
    const { client, analyze, replace } = fixture();
    const summary = {
      schemaVersion: 1 as const, overall: "connected" as const, testedAt: "2026-08-12T12:00:00.000Z", httpStatus: 200,
      stages: ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"].map((stage) => ({ stage: stage as "url", status: "pass" as const, code: `${stage}-pass`, message: "Passed.", durationMs: 1 })),
      availableModelIds: ["speaches-ai/Kokoro-82M-v1.0-ONNX"], availableVoiceIds: ["af_heart"]
    };
    const connection: SpeachesConnection = {
      baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root", configured: true, defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX", defaultVoiceId: "af_heart",
      timeoutSeconds: 120, retryCount: 2, responseFormat: "wav", lastTestedAt: summary.testedAt, lastSuccessfulTestAt: summary.testedAt,
      lastTestSummary: summary as SpeachesConnection["lastTestSummary"], createdAt: summary.testedAt, updatedAt: summary.testedAt
    };
    const catalog: VoiceCatalog = { schemaVersion: 1, modelId: connection.defaultModelId!, entries: [
      { voiceId: "af_heart", label: "Heart — American English — af_heart", enabled: true, language: "American English", locale: "en-US", accent: "American", category: null, style: null, sampleText: null },
      { voiceId: "af_sky", label: "Sky — American English — af_sky", enabled: true, language: "American English", locale: "en-US", accent: "American", category: null, style: null, sampleText: null }
    ] };
    renderPage(client, analyze, { connection, catalog });
    await openProjectTab("Settings");
    expect(screen.queryByLabelText("Connection profile")).not.toBeInTheDocument();
    await waitFor(() => expect(analyze).toHaveBeenCalled());
    expect((await screen.findAllByText("Heart — American English — af_heart")).length).toBeGreaterThan(0);
    expect(await screen.findByLabelText("Voices")).toHaveValue("af_heart");
    expect(await screen.findByText("available")).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(project.id, expect.objectContaining({
      modelId: null,
      speakerMappings: [expect.objectContaining({ speakerId: "teacher", voiceId: "af_heart" })]
    })));
    await userEvent.selectOptions(screen.getByLabelText("Voices"), "af_sky");
    expect(screen.getByLabelText("Voices")).toHaveValue("af_sky");
  });

  it("filters voices by model from one session discovery and appends unknown supported voices", async () => {
    const connection: SpeachesConnection = {
      baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root", configured: true, defaultModelId: "model-a", defaultVoiceId: "voice-a",
      timeoutSeconds: 120, retryCount: 2, responseFormat: "wav", lastTestedAt: null, lastSuccessfulTestAt: null, lastTestSummary: null,
      createdAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z"
    };
    const connected = { ...project, modelId: "model-a", speakerMappings: [{ ...project.speakerMappings[0]!, voiceId: "voice-a" }] };
    const { client, analyze, replace } = fixture(connected);
    const catalog: VoiceCatalog = { schemaVersion: 1, modelId: "model-a", entries: [
      { voiceId: "voice-a", label: "Catalog A", enabled: true, language: null, locale: null, accent: null, category: null, style: null, sampleText: null },
      { voiceId: "voice-b", label: "Catalog B", enabled: true, language: null, locale: null, accent: null, category: null, style: null, sampleText: null },
      { voiceId: "voice-disabled", label: "Disabled", enabled: false, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }
    ] };
    const speechCatalog: SpeechCatalog = { schemaVersion: 1, models: [
      { modelId: "model-a", voices: [
        { voiceId: "voice-a", name: "Server A", language: null, gender: null },
        { voiceId: "voice-new", name: "New server voice", language: "English", gender: null },
        { voiceId: "voice-disabled", name: "Disabled server voice", language: null, gender: null }
      ] },
      { modelId: "model-b", voices: [{ voiceId: "voice-b", name: "Server B", language: null, gender: null }] }
    ] };
    const { connections } = renderPage(client, analyze, { connection, catalog, speechCatalog });
    await openProjectTab("Settings");

    expect(await screen.findByLabelText("Voices")).toHaveValue("voice-a");
    expect(screen.getByRole("option", { name: "Catalog A" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "New server voice — voice-new" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Disabled" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Catalog B" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Optional model override"), { target: { value: "model-b" } });
    await waitFor(() => expect(screen.getByLabelText("Voices")).toHaveValue("voice-b"));
    expect(screen.getByRole("option", { name: "Catalog B" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Catalog A" })).not.toBeInTheDocument();
    expect(connections.discoverSpeechCatalog).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(project.id, expect.objectContaining({
      modelId: "model-b",
      speakerMappings: [expect.objectContaining({ voiceId: "voice-b" })]
    })));
  });

  it("preserves the saved voice on discovery failure and retries without a synthesis request", async () => {
    const connection: SpeachesConnection = {
      baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root", configured: true, defaultModelId: "model-a", defaultVoiceId: "voice-a",
      timeoutSeconds: 120, retryCount: 2, responseFormat: "wav", lastTestedAt: null, lastSuccessfulTestAt: null, lastTestSummary: null,
      createdAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z"
    };
    const connected = { ...project, modelId: "model-a", speakerMappings: [{ ...project.speakerMappings[0]!, voiceId: "voice-a" }] };
    const { client, analyze, replace } = fixture(connected);
    const catalog: VoiceCatalog = { schemaVersion: 1, modelId: "model-a", entries: [
      { voiceId: "voice-a", label: "Catalog A", enabled: true, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }
    ] };
    const speechCatalog: SpeechCatalog = { schemaVersion: 1, models: [{ modelId: "model-a", voices: [{ voiceId: "voice-a", name: "Voice A", language: null, gender: null }] }] };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const discovery = vi.fn()
      .mockRejectedValueOnce(new Error("Supported voices are temporarily unavailable."))
      .mockResolvedValue(speechCatalog);
    const { connections } = renderPage(client, analyze, { connection, catalog, speechCatalog, discovery });
    await openProjectTab("Settings");

    expect(await screen.findByLabelText("Voices")).toBeDisabled();
    expect(screen.getByText("Supported voices are temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByText("voice-a")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Retry supported voices" }));
    await waitFor(() => expect(screen.getByLabelText("Voices")).toHaveValue("voice-a"));
    expect(screen.getByText("voice-a")).toBeInTheDocument();
    expect(connections.discoverSpeechCatalog).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the global voice catalog before a project connection is selected", async () => {
    const unreconciled = { ...project, speakerMappings: [] };
    const { client, analyze, replace } = fixture(unreconciled);
    const { voiceCatalog } = renderPage(client, analyze, { catalog: globalCatalog });
    await openProjectTab("Settings");

    expect(await screen.findByLabelText("Voices")).toBeEnabled();
    expect(screen.getByLabelText("Voices")).toHaveValue("af_heart");
    expect(screen.getByRole("option", { name: "Sky — American English — af_sky" })).toBeInTheDocument();
    expect(voiceCatalog.get).toHaveBeenCalledWith(GLOBAL_VOICE_CATALOG_MODEL_ID);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(project.id, expect.objectContaining({
      modelId: null,
      speakerMappings: [expect.objectContaining({ speakerId: "teacher", voiceId: "af_heart" })]
    })));
    await waitFor(() => expect(screen.queryByText("MISSING_VOICE_MAPPING")).not.toBeInTheDocument());
  });

  it("analyzes offline, renders the narration score, and autosaves edits", async () => {
    const { client, analyze, replace } = fixture();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderPage(client, analyze);

    expect(await screen.findByRole("heading", { name: "Script editor" })).toBeInTheDocument();
    await waitFor(() => expect(analyze).toHaveBeenCalled());
    expect(screen.getByRole("region", { name: "Script editor content" })).toHaveAttribute("tabindex", "0");
    await openProjectTab("Details");
    expect(screen.getByRole("region", { name: "Narration score content" })).toHaveAttribute("tabindex", "0");
    const score = await screen.findByLabelText("Dry run ordered segment table");
    expect(within(score).getByText("Speaker / cue")).toBeInTheDocument();
    expect(within(score).getByText("Original")).toBeInTheDocument();
    expect(within(score).getByText("Readable")).toBeInTheDocument();
    expect(within(score).getByText("TTS text")).toBeInTheDocument();
    expect(score).toHaveTextContent("teacher");
    expect(score).not.toHaveTextContent("voice_teacher");
    expect(within(score).getAllByLabelText("Speaker teacher. Voice ID voice_teacher")).toEqual([
      expect.objectContaining({ title: "Voice ID: voice_teacher" }),
      expect.objectContaining({ title: "Voice ID: voice_teacher" })
    ]);
    expect(score).toHaveTextContent("sequel");
    await openProjectTab("Settings");
    expect(screen.getByText(/project · exactTerm · enabled · 1 matches/u)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Line 1/u }).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    const projectName = screen.getByLabelText("Project name");
    fireEvent.change(projectName, { target: { value: "Autosaved study" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalled(), { timeout: 2_000 });
    expect(replace.mock.calls.at(-1)?.[1]).toMatchObject({ name: "Autosaved study" });
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("persists and restores exact diagnostic suppressions", async () => {
    const { client, analyze, replaceIgnoredDiagnostics } = fixture({ ...project, scriptSource: "[section Topic]\n[speaker_teacher] Second." });
    renderPage(client, analyze);
    await openProjectTab("Details");

    expect(await screen.findByText("MALFORMED_SECTION_DIRECTIVE")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ignore this pattern" }));
    await waitFor(() => expect(replaceIgnoredDiagnostics).toHaveBeenCalledWith([
      expect.objectContaining({ code: "MALFORMED_SECTION_DIRECTIVE" })
    ]));
    expect(await screen.findByRole("region", { name: "Ignored diagnostic patterns" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Ignore this pattern" })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Restore this pattern" }));
    await waitFor(() => expect(replaceIgnoredDiagnostics).toHaveBeenLastCalledWith([]));
    expect(await screen.findByText("MALFORMED_SECTION_DIRECTIVE")).toBeInTheDocument();
  });

  it("schedules one autosave for an edit burst instead of re-arming while saving", async () => {
    const { client, analyze, replace } = fixture();
    const pendingSave = deferred<ProjectDetail>();
    replace.mockImplementationOnce(() => pendingSave.promise);
    const timerSpy = vi.spyOn(window, "setTimeout");
    renderPage(client, analyze);

    const scriptSource = await screen.findByLabelText("Script source");
    await waitFor(() => expect(analyze).toHaveBeenCalled());
    timerSpy.mockClear();

    const pastedSource = `[speaker_teacher] ${"Responsive paste 🧠 ".repeat(2_000)}`;
    fireEvent.change(scriptSource, { target: { value: "[speaker_teacher] Autosave revision one" } });
    fireEvent.change(scriptSource, { target: { value: "[speaker_teacher] Autosave revision two" } });
    fireEvent.change(scriptSource, { target: { value: pastedSource } });
    const editTimers = timerSpy.mock.calls.filter(([, delay]) => delay === 800).length;
    expect(scriptSource).toHaveValue(pastedSource);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(editTimers).toBe(3);
    expect(timerSpy.mock.calls.filter(([, delay]) => delay === 800)).toHaveLength(editTimers);
    expect(replace).toHaveBeenCalledWith(project.id, expect.objectContaining({ scriptSource: pastedSource }));

    pendingSave.resolve({ ...project, scriptSource: pastedSource, updatedAt: "2026-08-12T13:30:00.000Z" });
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("does not autosave discovery reconciliation when the user has not edited the project", async () => {
    const unreconciled = { ...project, speakerMappings: [], pausePresets: [] };
    const { client, analyze, replace } = fixture(unreconciled);
    const timerSpy = vi.spyOn(window, "setTimeout");
    renderPage(client, analyze);
    await openProjectTab("Settings");

    await waitFor(() => expect(analyze).toHaveBeenCalled());
    expect(await screen.findByLabelText("Voices")).toBeDisabled();
    expect(screen.getByLabelText("Voices")).toHaveValue("");
    expect(screen.getByText("The global voice catalog has no enabled voices.")).toBeInTheDocument();
    expect(timerSpy.mock.calls.filter(([, delay]) => delay === 800)).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("retains an invalid custom pause draft and blocks Save now", async () => {
    const custom = { ...project, scriptSource: "[speaker_teacher] One. [pause_custom] Two.", pausePresets: [project.pausePresets[0]!] };
    const { client, analyze, replace, duplicate } = fixture(custom);
    renderPage(client, analyze);
    await openProjectTab("Settings");

    const pauseCode = (await screen.findAllByText("pause_custom")).find((element) => element.tagName === "CODE");
    if (!pauseCode) throw new Error("Expected the custom pause ID in configuration.");
    const pauseCard = pauseCode.closest("article");
    if (!pauseCard) throw new Error("Expected a pause configuration card.");
    fireEvent.change(within(pauseCard).getByLabelText("Duration"), { target: { value: "-1 s" } });
    expect(await within(pauseCard).findByText("Pause duration cannot be negative.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(screen.getByText("Invalid changes")).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();

    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Invalid copy");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(screen.getByText("Invalid changes")).toBeInTheDocument());
    expect(prompt).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
  });

  it("serializes saves so a stale response cannot overwrite a newer revision", async () => {
    const { client, analyze, replace } = fixture();
    const firstSave = deferred<ProjectDetail>();
    replace.mockImplementationOnce(() => firstSave.promise);
    replace.mockImplementationOnce(async (_id, input) => ({
      ...project,
      ...input,
      modelId: input.modelId ?? project.modelId,
      lexiconEntries: project.lexiconEntries,
      updatedAt: "2026-08-12T14:00:00.000Z"
    }));
    renderPage(client, analyze);
    const projectName = await screen.findByDisplayValue("Authoring study");

    fireEvent.change(projectName, { target: { value: "Revision one" } });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    fireEvent.change(projectName, { target: { value: "Revision two" } });
    firstSave.resolve({ ...project, name: "Revision one", updatedAt: "2026-08-12T13:30:00.000Z" });

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    expect(replace.mock.calls.map((call) => call[1].name)).toEqual(["Revision one", "Revision two"]);
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(projectName).toHaveValue("Revision two");
  });

  it("flushes a valid pending revision before duplication", async () => {
    const { client, analyze, replace, duplicate } = fixture();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Authoring study copy");
    renderPage(client, analyze);
    const description = await screen.findByDisplayValue("Offline fixture");
    fireEvent.change(description, { target: { value: "Pending duplicate source" } });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    await waitFor(() => expect(duplicate).toHaveBeenCalledWith(project.id, { name: "Authoring study copy" }));
    expect(prompt).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(project.id, expect.objectContaining({ description: "Pending duplicate source" }));
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(duplicate.mock.invocationCallOrder[0]!);
  });

  it("flushes pending edits before segment and pronunciation previews and scopes cache cleanup", async () => {
    vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:project-preview"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const connectedProject = { ...project, modelId: "model" };
    const { client, analyze, replace } = fixture(connectedProject);
    const connection: SpeachesConnection = {
      baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root", configured: true, defaultModelId: "model", defaultVoiceId: "voice_teacher",
      timeoutSeconds: 120, retryCount: 0, responseFormat: "wav", lastTestedAt: null, lastSuccessfulTestAt: null, lastTestSummary: null,
      createdAt: project.createdAt, updatedAt: project.updatedAt
    };
    const catalog: VoiceCatalog = { schemaVersion: 1, modelId: "model", entries: [{
      voiceId: "voice_teacher", label: "Teacher Voice", enabled: true, language: null, locale: null, accent: null, category: null, style: null, sampleText: null
    }] };
    const preview = vi.fn(async (_projectId: string, input: { mode: "segment" | "pronunciation" }) => projectPreviewResult(input.mode));
    const clearProject = vi.fn(async () => ({ contractVersion: 1 as const, entriesRemoved: 2, bytesFreed: 6 }));
    const clearEntry = vi.fn(async () => ({ contractVersion: 1 as const, entriesRemoved: 1, bytesFreed: 3 }));
    const cacheClient = { status: vi.fn(), clearAll: vi.fn(), clearProject, clearEntry } as unknown as SpeechCacheClient;
    renderPage(client, analyze, {
      connection, catalog,
      speechCatalog: { schemaVersion: 1, models: [{ modelId: "model", voices: [{ voiceId: "voice_teacher", name: "Teacher Voice", language: null, gender: null }] }] },
      previewClient: { preview } as unknown as ProjectPreviewClient,
      cacheClient
    });

    fireEvent.change(await screen.findByDisplayValue("Offline fixture"), { target: { value: "Pending preview edit" } });
    await openProjectTab("Details");
    await userEvent.click((await screen.findAllByRole("button", { name: "Preview" }))[0]!);
    expect(await screen.findByRole("region", { name: "Project preview result" })).toHaveTextContent("Teacher Voice");
    expect(screen.getByRole("region", { name: "Project preview result" })).toHaveTextContent("voice_teacher");
    expect(screen.getByRole("region", { name: "Project preview result" })).toHaveTextContent("Cache miss");
    expect(replace).toHaveBeenCalledWith(project.id, expect.objectContaining({ description: "Pending preview edit" }));
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(preview.mock.invocationCallOrder[0]!);

    await openProjectTab("Settings");
    await userEvent.type(screen.getByLabelText("Pronunciation test"), "SQL sample.");
    await userEvent.click(screen.getByRole("button", { name: "Preview pronunciation" }));
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith(project.id, { mode: "pronunciation", text: "SQL sample." }, expect.any(AbortSignal)));

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Clear this cached entry" }));
    expect(clearEntry).toHaveBeenCalledWith("a".repeat(64));
    await userEvent.click(screen.getByRole("button", { name: "Clear project cache" }));
    expect(clearProject).toHaveBeenCalledWith(project.id);
    expect(confirm.mock.calls.flat().join(" ")).toContain("shared with Scratchpad or other projects");
  });

  it("configures every transition and creates, reopens, and replaces immutable plans", async () => {
    const { client, analyze, replace } = fixture();
    const first = frozenPlan("00000000-0000-4000-8000-000000000002", "b".repeat(64), "2026-08-12T14:00:00.000Z");
    const second = frozenPlan("00000000-0000-4000-8000-000000000003", "c".repeat(64), "2026-08-12T16:00:00.000Z");
    const plans: RenderPlan[] = [];
    const create = vi.fn(async () => {
      const plan = plans.length === 0 ? first : second;
      plans.unshift(plan);
      return plan;
    });
    const list = vi.fn(async () => plans.map(summaryOf));
    const get = vi.fn(async (planId: string) => plans.find(({ id }) => id === planId)!);
    renderPage(client, analyze, { renderPlanClient: { create, list, get } });

    await openProjectTab("Settings");
    await userEvent.selectOptions(screen.getByLabelText("Paragraph transition mode"), "duration");
    fireEvent.change(screen.getByLabelText("Paragraph transition duration (ms)"), { target: { value: "600" } });
    await userEvent.selectOptions(screen.getByLabelText("Speaker change transition mode"), "preset");
    await userEvent.selectOptions(screen.getByLabelText("Speaker change transition preset"), "pause_short");
    await userEvent.selectOptions(screen.getByLabelText("Section transition mode"), "duration");
    fireEvent.change(screen.getByLabelText("Section transition duration (ms)"), { target: { value: "1500" } });
    fireEvent.change(screen.getByDisplayValue("Offline fixture"), { target: { value: "Pending frozen revision" } });
    await openProjectTab("Render");
    const freeze = await screen.findByRole("button", { name: "Freeze render plan" });
    await waitFor(() => expect(freeze).toBeEnabled());
    await userEvent.click(freeze);

    await waitFor(() => expect(create).toHaveBeenCalledWith(project.id));
    expect(replace).toHaveBeenCalledWith(project.id, expect.objectContaining({
      description: "Pending frozen revision",
      transitionPauses: {
        paragraph: { mode: "duration", durationMs: 600 },
        speakerChange: { mode: "preset", pauseId: "pause_short" },
        section: { mode: "duration", durationMs: 1500 }
      }
    }));
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
    const planTable = await screen.findByRole("table", { name: "Frozen render plan ordered entries" });
    expect(planTable).toHaveAttribute("tabindex", "0");
    expect(planTable).toHaveTextContent("automatic · paragraph");
    expect(planTable).toHaveTextContent("750 ms");
    expect(planTable).toHaveTextContent("voice_teacher");
    expect(planTable).toHaveTextContent("sequel.");
    expect(planTable).toHaveTextContent("miss");
    expect(screen.getAllByText("Matches current project").length).toBeGreaterThan(0);

    replace.mockImplementationOnce(async (_id, input) => ({
      ...project, ...input, modelId: input.modelId ?? project.modelId, scriptHash: "c".repeat(64), lexiconEntries: project.lexiconEntries,
      updatedAt: "2026-08-12T15:00:00.000Z"
    }));
    await openProjectTab("Script Editor");
    fireEvent.change(screen.getByLabelText("Script source"), { target: { value: "[speaker_teacher] Changed live script." } });
    await openProjectTab("Render");
    await waitFor(() => expect(screen.getAllByText("Frozen from earlier project").length).toBeGreaterThan(0), { timeout: 2_000 });
    expect(planTable).toHaveTextContent("sequel.");

    const secondFreeze = screen.getByRole("button", { name: "Freeze render plan" });
    await waitFor(() => expect(secondFreeze).toBeEnabled());
    await userEvent.click(secondFreeze);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const savedPlans = screen.getByLabelText("Saved render plans");
    expect(within(savedPlans).getAllByRole("button")).toHaveLength(2);
    await userEvent.click(within(savedPlans).getAllByRole("button")[1]!);
    await waitFor(() => expect(get).toHaveBeenCalledWith(first.id));
    expect(screen.getByRole("table", { name: "Frozen render plan ordered entries" })).toHaveTextContent("sequel.");
  });

  it("starts a selected frozen plan and exposes completed artifact actions", async () => {
    const { client, analyze } = fixture();
    const plan = frozenPlan("00000000-0000-4000-8000-000000000002", project.scriptHash, "2026-08-12T14:00:00.000Z");
    const job = {
      contractVersion: 1 as const, id: "00000000-0000-4000-8000-000000000003", projectId: project.id, planId: plan.id,
      retryOfRenderId: null, state: "complete" as const,
      progress: { phase: "complete" as const, sectionTitle: null, sectionOrdinal: 0, sectionCount: 0, entryOrdinal: null, speechOrdinal: 1, speechCount: 1, chunkOrdinal: null, completedChunks: 1, totalChunks: 1, cacheHits: 0, cacheMisses: 1, ttsRequests: 1, speakerId: null, voiceId: null, excerpt: null, elapsedMs: 1_000 },
      error: null, createdAt: "2026-08-12T14:00:00.000Z", startedAt: "2026-08-12T14:00:00.000Z", finishedAt: "2026-08-12T14:00:01.000Z"
    };
    const artifact = {
      contractVersion: 1 as const, id: "00000000-0000-4000-8000-000000000004", renderId: job.id,
      type: "mp3" as const, fileName: "offline-fixture.mp3", sizeBytes: 1_024, checksum: "a".repeat(64),
      durationMs: 1_000, createdAt: job.finishedAt
    };
    const start = vi.fn(async () => job);
    const exportArtifact = vi.fn(async () => ({ disposition: "download" as const, fileName: artifact.fileName }));
    const renderClient: RenderClient = {
      start, list: vi.fn(async () => []), get: vi.fn(async () => job), cancel: vi.fn(async () => job), retry: vi.fn(async () => job),
      listArtifacts: vi.fn(async () => [artifact]), exportArtifact,
      listSegments: vi.fn(async () => []),
      getWaveform: vi.fn(async () => ({ status: "unavailable" as const, renderId: job.id, reason: "audioMissing" as const })),
      renderAudioSource: vi.fn(() => "/render.mp3"), segmentAudioSource: vi.fn(() => "/segment.wav"),
      exportSegment: vi.fn(async () => ({ disposition: "download" as const, fileName: "000001.wav" }))
    };
    renderPage(client, analyze, {
      renderPlanClient: { create: vi.fn(), list: vi.fn(async () => [summaryOf(plan)]), get: vi.fn(async () => plan) },
      renderClient
    });
    await openProjectTab("Render");
    const savedPlans = await screen.findByLabelText("Saved render plans");
    await userEvent.click(within(savedPlans).getByRole("button"));
    await userEvent.click(await screen.findByRole("button", { name: "Render this frozen plan" }));
    expect(start).toHaveBeenCalledWith(plan.id);
    expect(await screen.findByText(/Phase: complete/u)).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Render artifacts" })).toHaveTextContent("offline-fixture.mp3");
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(exportArtifact).toHaveBeenCalledWith(artifact.id);
  });

  it("shows failed saves and guards unload and route navigation", async () => {
    const { client, analyze, replace } = fixture();
    replace.mockRejectedValueOnce(new Error("disk unavailable"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage(client, analyze);
    const description = await screen.findByDisplayValue("Offline fixture");
    fireEvent.change(description, { target: { value: "Cannot save yet" } });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("disk unavailable");
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Settings test link" }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved project changes?");
    expect(screen.queryByText("Settings destination")).not.toBeInTheDocument();
  });

  it("imports strict UTF-8 text without changing Unicode or CRLF", async () => {
    const { client, analyze } = fixture();
    renderPage(client, analyze);
    const upload = await screen.findByLabelText("Upload .txt");
    const source = "[speaker_teacher] Résumé 🧠\r\n[pause_short]\r\nContinue.";
    fireEvent.change(upload, { target: { files: [new File([source], "fixture.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(analyze.mock.calls.some(([input]) => input.source === source)).toBe(true));
    expect(screen.getByLabelText("Script source")).toHaveValue(source.replaceAll("\r\n", "\n"));
  });
});
