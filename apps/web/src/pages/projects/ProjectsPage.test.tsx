// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseScript, resolveParagraphPauses, transformScript } from "@studynarrator/core";
import type { ConnectionProfile, PersistenceClient, ProjectDetail, ProjectReplaceInput, VoiceCatalog } from "@studynarrator/shared-types";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import type { ScriptAnalysisInput } from "@/workers/parser/parserWorkerProtocol.js";
import { ProjectsPage } from "./ProjectsPage.js";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";

const project: ProjectDetail = {
  contractVersion: 3,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Authoring study",
  description: "Offline fixture",
  scriptSource: "[speaker_teacher] SQL.\n[pause_short]\nContinue.",
  scriptHash: "a".repeat(64),
  connectionProfileId: null,
  modelId: null,
  speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: "voice_teacher", speed: 1, gainDb: 0, roleDescription: "", sampleText: "" }],
  pausePresets: [
    { pauseId: "pause_short", durationMs: 350, description: "Brief" },
    { pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }
  ],
  paragraphPause: { enabled: true, pauseId: "pause_medium", durationMs: 750 },
  lexiconEntries: [{
    id: "project-sql", scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel",
    caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z"
  }],
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z"
};

function fixture(sourceProject = project) {
  let stored = structuredClone(sourceProject);
  const replace = vi.fn(async (_id: string, input: ProjectReplaceInput) => {
    stored = { ...stored, ...input, modelId: input.modelId ?? stored.modelId, scriptHash: "b".repeat(64), updatedAt: "2026-08-12T13:00:00.000Z", lexiconEntries: stored.lexiconEntries };
    return structuredClone(stored);
  });
  const duplicate = vi.fn(async () => structuredClone(stored));
  const client: PersistenceClient = {
    status: vi.fn(),
    projects: {
      list: vi.fn(async () => [{ id: stored.id, name: stored.name, description: stored.description, scriptHash: stored.scriptHash, createdAt: stored.createdAt, updatedAt: stored.updatedAt }]),
      create: vi.fn(),
      get: vi.fn(async () => structuredClone(stored)),
      replace,
      duplicate,
      delete: vi.fn(async () => undefined)
    },
    settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
    preferences: { getIgnoredDiagnostics: vi.fn(async () => []), replaceIgnoredDiagnostics: vi.fn() },
    globalLexicon: { list: vi.fn(async () => []), replace: vi.fn(async () => []) }
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
  return { client, analyze, replace, duplicate };
}

function renderPage(client: PersistenceClient, analyze: ScriptAnalyzer["analyze"], options: { profiles?: ConnectionProfile[]; catalog?: VoiceCatalog } = {}) {
  const profiles = options.profiles ?? [];
  const connections = {
    list: vi.fn(async () => profiles), create: vi.fn(), replace: vi.fn(), delete: vi.fn(), test: vi.fn(), exportDiagnostics: vi.fn(),
    getSetupState: vi.fn(async () => ({ activeProfileId: profiles[0]?.id ?? null, activeProfileLocked: false, onboardingCompletedAt: "2026-08-12T12:00:00.000Z", client: "web" as const })),
    setActiveProfile: vi.fn(), completeOnboarding: vi.fn()
  };
  const voiceCatalog = { get: vi.fn(async (modelId: string) => options.catalog ?? ({ schemaVersion: 1 as const, modelId, entries: [] })), replace: vi.fn() };
  return render(<ConnectionProvider connections={connections} voiceCatalog={voiceCatalog}><MemoryRouter initialEntries={[`/projects/${project.id}`]}><Link to="/settings">Settings test link</Link><Routes><Route path="/projects/:projectId" element={<ProjectsPage client={client} analyzer={{ analyze }} />} /><Route path="/settings" element={<p>Settings destination</p>} /></Routes></MemoryRouter></ConnectionProvider>);
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("G05 Projects workbench", () => {
  it("selects a managed profile/model and maps searchable friendly voices with raw IDs", async () => {
    const { client, analyze, replace } = fixture();
    const summary = {
      schemaVersion: 1 as const, overall: "connected" as const, testedAt: "2026-08-12T12:00:00.000Z", httpStatus: 200,
      stages: ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"].map((stage) => ({ stage: stage as "url", status: "pass" as const, code: `${stage}-pass`, message: "Passed.", durationMs: 1 })),
      availableModelIds: ["speaches-ai/Kokoro-82M-v1.0-ONNX"], availableVoiceIds: ["af_heart"]
    };
    const profile: ConnectionProfile = {
      id: "local", name: "Local Speaches", baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root", source: "saved", editable: true,
      credentialEntryAllowed: false, configured: true, apiKeyConfigured: false, defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX", defaultVoiceId: "af_heart",
      timeoutSeconds: 120, retryCount: 2, responseFormat: "wav", lastTestedAt: summary.testedAt, lastSuccessfulTestAt: summary.testedAt,
      lastTestSummary: summary as ConnectionProfile["lastTestSummary"], createdAt: summary.testedAt, updatedAt: summary.testedAt
    };
    const catalog: VoiceCatalog = { schemaVersion: 1, modelId: profile.defaultModelId!, entries: [{ voiceId: "af_heart", label: "Heart — American English — af_heart", enabled: true, language: "American English", locale: "en-US", accent: "American", category: null, style: null, sampleText: null }] };
    renderPage(client, analyze, { profiles: [profile], catalog });
    await userEvent.selectOptions(await screen.findByLabelText("Connection profile"), profile.id);
    await waitFor(() => expect(analyze).toHaveBeenCalled());
    expect((await screen.findAllByText("Heart — American English — af_heart")).length).toBeGreaterThan(0);
    expect(screen.getByText("voice_teacher")).toBeInTheDocument();
    expect(screen.getByText("unavailable")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Voice catalog or manual ID"), { target: { value: "af_heart" } });
    expect(await screen.findByText("available")).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(project.id, expect.objectContaining({ connectionProfileId: profile.id, modelId: null })));
  });

  it("analyzes offline, renders the narration score, and autosaves edits", async () => {
    const { client, analyze, replace } = fixture();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderPage(client, analyze);

    expect(await screen.findByRole("heading", { name: "Script editor" })).toBeInTheDocument();
    await waitFor(() => expect(analyze).toHaveBeenCalled());
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
    expect(screen.getByText(/project · exactTerm · enabled · 1 matches/u)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Line 1/u }).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    const projectName = screen.getAllByLabelText("Project name")[1]!;
    fireEvent.change(projectName, { target: { value: "Autosaved study" } });
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalled(), { timeout: 2_000 });
    expect(replace.mock.calls.at(-1)?.[1]).toMatchObject({ name: "Autosaved study" });
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
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

    await waitFor(() => expect(analyze).toHaveBeenCalled());
    expect(await screen.findByLabelText("Voice catalog or manual ID")).toHaveValue("");
    expect(timerSpy.mock.calls.filter(([, delay]) => delay === 800)).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("retains an invalid custom pause draft and blocks Save now", async () => {
    const custom = { ...project, scriptSource: "[speaker_teacher] One. [pause_custom] Two.", pausePresets: [project.pausePresets[0]!] };
    const { client, analyze, replace, duplicate } = fixture(custom);
    renderPage(client, analyze);

    const pauseCode = (await screen.findAllByText("pause_custom")).find((element) => element.tagName === "CODE");
    if (!pauseCode) throw new Error("Expected the custom pause ID in configuration.");
    const pauseCard = pauseCode.closest("article");
    if (!pauseCard) throw new Error("Expected a pause configuration card.");
    fireEvent.change(within(pauseCard).getByLabelText("Duration"), { target: { value: "-1 s" } });
    expect(await within(pauseCard).findByText("Pause duration cannot be negative.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(screen.getByText("Invalid")).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();

    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Invalid copy");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(screen.getByText("Invalid")).toBeInTheDocument());
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
