// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionTestOverall, GlobalLexiconReplaceInput, PersistenceClient, ScratchpadClient, SpeachesConnection, SpeachesConnectionClient } from "@studynarrator/shared-types";
import { SettingsPage } from "./SettingsPage.js";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";

let audioSource: { buffer: AudioBuffer | null; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null };
let audioContext: { destination: object; resume: ReturnType<typeof vi.fn>; decodeAudioData: ReturnType<typeof vi.fn>; createBufferSource: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

beforeEach(() => {
  audioSource = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
  audioContext = { destination: {}, resume: vi.fn(async () => undefined), decodeAudioData: vi.fn(async () => ({} as AudioBuffer)), createBufferSource: vi.fn(() => audioSource), close: vi.fn(async () => undefined) };
  function FakeAudioContext() { return audioContext; }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const cacheClient = {
  status: vi.fn(async () => ({ contractVersion: 1 as const, entryCount: 0, totalBytes: 0, lastUsedAt: null, sessionHits: 0, sessionMisses: 0, sessionWrites: 0, sessionCorruptMisses: 0, inFlight: 0 })),
  clearAll: vi.fn(async () => ({ contractVersion: 1 as const, entriesRemoved: 0, bytesFreed: 0 })),
  clearProject: vi.fn(), clearEntry: vi.fn()
};
const timestamp = "2026-08-12T12:00:00.000Z";
const scratchpadResult = {
  schemaVersion: 3 as const, id: "b3b58e96-e98f-4dbf-897b-e2fb4b3a7c5c", createdAt: timestamp,
  modelId: "model-b", voiceId: "voice-b2", voiceLabel: "Second", speed: 1,
  originalText: "sample", readableText: "sample", transformedText: "sample", lexiconApplied: false, warnings: [],
  cache: { status: "miss" as const, key: "a".repeat(64), byteLength: 3, createdAt: timestamp, lastUsedAt: timestamp }, audio: { mimeType: "audio/wav" as const, base64: "AQID", byteLength: 3 }
};
const scratchpadClient = { preview: vi.fn(async () => scratchpadResult) } satisfies ScratchpadClient;
const savedConnection = {
  baseUrl: "https://speech.example.test", suppliedUrlForm: "root" as const, configured: true,
  defaultModelId: "model-b", defaultVoiceId: "voice-b2", timeoutSeconds: 120, retryCount: 2,
  responseFormat: "wav" as const, lastTestedAt: null, lastSuccessfulTestAt: null, lastTestSummary: null,
  createdAt: timestamp, updatedAt: timestamp
};
function connectionWithTest(overall: ConnectionTestOverall, configured = true): SpeachesConnection {
  const stages = ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"] as const;
  return {
    ...savedConnection,
    baseUrl: configured ? savedConnection.baseUrl : null,
    suppliedUrlForm: configured ? "root" : "unconfigured",
    configured,
    defaultModelId: configured ? savedConnection.defaultModelId : null,
    defaultVoiceId: configured ? savedConnection.defaultVoiceId : null,
    lastTestedAt: timestamp,
    lastSuccessfulTestAt: overall === "connected" ? timestamp : null,
    lastTestSummary: {
      schemaVersion: 1,
      overall,
      testedAt: timestamp,
      httpStatus: overall === "connected" ? 200 : null,
      stages: stages.map((stage) => ({ stage, status: overall === "connected" ? "pass" as const : "fail" as const, code: `TEST_${stage.toUpperCase()}`, message: `${stage} result`, durationMs: 1 })),
      availableModelIds: configured ? [savedConnection.defaultModelId] : [],
      availableVoiceIds: configured ? [savedConnection.defaultVoiceId] : null
    }
  };
}
function connectionClient(overrides: Partial<SpeachesConnectionClient> = {}): SpeachesConnectionClient {
  return {
    get: vi.fn(async () => savedConnection),
    update: vi.fn<SpeachesConnectionClient["update"]>(async (input) => ({
      ...savedConnection,
      ...input,
      timeoutSeconds: input.timeoutSeconds ?? savedConnection.timeoutSeconds,
      retryCount: input.retryCount ?? savedConnection.retryCount,
      responseFormat: input.responseFormat ?? savedConnection.responseFormat
    })),
    test: vi.fn(), exportDiagnostics: vi.fn(),
    discoverSpeechCatalog: vi.fn(async () => ({ schemaVersion: 1 as const, models: [
      { modelId: "model-b", voices: [
        { voiceId: "voice-b2", name: "Second", language: null, gender: null },
        { voiceId: "voice-b1", name: "First", language: null, gender: null }
      ] },
      { modelId: "model-a", voices: [{ voiceId: "voice-a1", name: null, language: null, gender: null }] }
    ] })),
    getSetupState: vi.fn(async () => ({ onboardingCompletedAt: timestamp, client: "web" as const })),
    completeOnboarding: vi.fn(),
    ...overrides
  };
}
const voiceCatalog = { get: vi.fn(async (modelId: string) => ({ schemaVersion: 1 as const, modelId, entries: [] })), replace: vi.fn() };

describe("System Settings", () => {
  it("shows the Signal path only for an actual connection error", async () => {
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
      globalLexicon: { list: vi.fn(async () => []), replace: vi.fn(async (entries: GlobalLexiconReplaceInput) => entries) }
    } as unknown as PersistenceClient;

    const connected = render(<ConnectionProvider connectionClient={connectionClient({ get: vi.fn(async () => connectionWithTest("connected")) })} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} scratchpadClient={scratchpadClient} /></ConnectionProvider>);
    await screen.findByDisplayValue(savedConnection.baseUrl);
    expect(screen.queryByText("Signal path")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export redacted JSON" })).not.toBeInTheDocument();
    connected.unmount();

    const failed = render(<ConnectionProvider connectionClient={connectionClient({ get: vi.fn(async () => connectionWithTest("disconnected")) })} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} scratchpadClient={scratchpadClient} /></ConnectionProvider>);
    expect(await screen.findByText("Signal path")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "disconnected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export redacted JSON" })).toBeInTheDocument();
    failed.unmount();

    render(<ConnectionProvider connectionClient={connectionClient({ get: vi.fn(async () => connectionWithTest("configurationError", false)) })} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} scratchpadClient={scratchpadClient} /></ConnectionProvider>);
    await waitFor(() => expect(screen.getByLabelText("Address")).toHaveValue(""));
    expect(screen.queryByText("Signal path")).not.toBeInTheDocument();
  });

  it("adds fixed global rules and autosaves inline text, enablement, and deletion", async () => {
    let stored = [{ id: "global-sql", scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "S Q L", caseSensitive: false, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp }];
    const replace = vi.fn(async (entries: Array<Record<string, unknown>>) => {
      stored = entries.map((entry, index) => ({ ...entry, id: typeof entry.id === "string" ? entry.id : `global-${String(index + 1)}`, scope: "global", createdAt: timestamp, updatedAt: timestamp })) as typeof stored;
      return structuredClone(stored);
    });
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
      globalLexicon: { list: vi.fn(async () => structuredClone(stored)), replace }
    } as unknown as PersistenceClient;
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} scratchpadClient={scratchpadClient} /></ConnectionProvider>);

    expect(await screen.findByRole("heading", { name: "Global lexicon" })).toBeInTheDocument();
    expect(screen.getByText(/complete words regardless of capitalization/u)).toBeInTheDocument();
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
    expect(screen.queryByText("Case sensitive")).not.toBeInTheDocument();

    const addScript = screen.getAllByLabelText("Script Text")[0]!;
    const addSpoken = screen.getAllByLabelText("Spoken Text")[0]!;
    fireEvent.change(addScript, { target: { value: "CLI" } });
    fireEvent.change(addSpoken, { target: { value: "C L I" } });
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(replace).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ displayText: "CLI", spokenText: "C L I", entryType: "exactTerm", caseSensitive: false, wholeWord: true, priority: 0, enabled: true, notes: "" })]));

    fireEvent.change(screen.getByDisplayValue("S Q L"), { target: { value: "ess cue ell" } });
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: "global-sql", spokenText: "ess cue ell" })])), { timeout: 1_500 });
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("checkbox", { name: "Enabled" })[0]!);
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: "global-sql", enabled: false })])));

    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    await waitFor(() => expect(screen.queryByDisplayValue("SQL")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("No matching global lexicon entries.")).toBeInTheDocument();
  });

  it("rejects blank and duplicate Script Text while preserving failed inline edits", async () => {
    const replace = vi.fn()
      .mockRejectedValueOnce(new Error("Storage is unavailable"))
      .mockImplementation(async (entries: GlobalLexiconReplaceInput) => entries.map((entry) => ({ ...entry, id: entry.id ?? "global-new", createdAt: timestamp, updatedAt: timestamp })));
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
      globalLexicon: { list: vi.fn(async () => [{ id: "global-api", scope: "global", entryType: "exactTerm", displayText: "API", spokenText: "A P I", caseSensitive: false, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp }]), replace }
    } as unknown as PersistenceClient;
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} scratchpadClient={scratchpadClient} /></ConnectionProvider>);
    await screen.findByDisplayValue("A P I");

    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Script Text and Spoken Text are required");
    fireEvent.change(screen.getAllByLabelText("Script Text")[0]!, { target: { value: "api" } });
    fireEvent.change(screen.getAllByLabelText("Spoken Text")[0]!, { target: { value: "duplicate" } });
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("unique regardless of capitalization");
    expect(replace).not.toHaveBeenCalled();

    fireEvent.change(screen.getByDisplayValue("A P I"), { target: { value: "new pronunciation" } });
    fireEvent.blur(screen.getByDisplayValue("new pronunciation"));
    expect(await screen.findByText("Not saved — edit or blur to retry")).toBeInTheDocument();
    expect(screen.getByDisplayValue("new pronunciation")).toBeInTheDocument();
    fireEvent.blur(screen.getByDisplayValue("new pronunciation"));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("normalizes and saves new-project pacing without touching projects", async () => {
    const updatePacing = vi.fn(async (input: { enabled: boolean; durationMs: number }) => input);
    const replaceProject = vi.fn();
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing },
      globalLexicon: { list: vi.fn(async () => []), replace: vi.fn(async (entries: GlobalLexiconReplaceInput) => entries) },
      projects: { replace: replaceProject }
    } as unknown as PersistenceClient;
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} scratchpadClient={scratchpadClient} /></ConnectionProvider>);
    const input = await screen.findByLabelText(/Default pause_medium duration/u);
    fireEvent.change(input, { target: { value: "1.5 s" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pacing defaults" }));
    expect(await screen.findByText("Pacing defaults saved. Existing projects were not changed.")).toBeInTheDocument();
    expect(updatePacing).toHaveBeenCalledWith({ enabled: true, durationMs: 1_500 });
    expect(replaceProject).not.toHaveBeenCalled();
  });

  it("uses an editable singleton, preserves server ordering, and auditions disabled voices without a player", async () => {
    const localVoiceCatalog = {
      get: vi.fn(async (modelId: string) => ({ schemaVersion: 1 as const, modelId, entries: [
        { voiceId: "voice-b1", label: "First voice", enabled: true, favorite: false, language: "English", locale: "en-US", accent: null, category: null, style: null, sampleText: null },
        { voiceId: "voice-b2", label: "Disabled locally", enabled: false, favorite: false, language: "English", locale: "en-US", accent: null, category: null, style: null, sampleText: null }
      ] })),
      replace: vi.fn()
    };
    let firstSignal: AbortSignal | undefined;
    const preview = vi.fn<ScratchpadClient["preview"]>((input, signal) => {
      if (input.voiceId === "voice-b1") {
        firstSignal = signal;
        return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError"))));
      }
      return Promise.resolve({ ...scratchpadResult, originalText: input.text, readableText: input.text, transformedText: input.text, voiceId: input.voiceId });
    });
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
      globalLexicon: { list: vi.fn(async () => []), replace: vi.fn(async (entries: GlobalLexiconReplaceInput) => entries) }
    } as unknown as PersistenceClient;
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={localVoiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} scratchpadClient={{ preview }} /></ConnectionProvider>);
    expect(await screen.findByLabelText("Address")).toBeEnabled();
    expect(screen.queryByText(/Environment Speaches|Active profile|API key/u)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("model-b"));
    expect(screen.getByLabelText("Default Voice")).toHaveValue("voice-b2");
    expect(screen.getByRole("option", { name: "Second — voice-b2" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "First — voice-b1" })).toBeInTheDocument();
    expect(screen.getByLabelText("Voice test script")).toHaveValue("Welcome to StudyNarrator. This short sample lets you hear how this voice handles clear narration.");
    expect(screen.queryByLabelText("Strict override JSON")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace model overrides" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Voice test script"), { target: { value: "Hear this exact sample." } });
    await userEvent.click(await screen.findByRole("button", { name: "Test First voice" }));
    expect(screen.getByRole("button", { name: "Preparing First voice" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Test Disabled locally" }));
    expect(firstSignal?.aborted).toBe(true);
    expect(await screen.findByRole("button", { name: "Playing Disabled locally" })).toBeInTheDocument();
    expect(preview).toHaveBeenLastCalledWith({ modelId: "model-b", voiceId: "voice-b2", speed: 1, text: "Hear this exact sample.", applyGlobalLexicon: false }, expect.any(AbortSignal));
    expect(document.querySelector("audio")).not.toBeInTheDocument();
    act(() => audioSource.onended?.());
    expect(screen.getByRole("button", { name: "Test Disabled locally" })).toBeInTheDocument();
    expect(audioContext.close).toHaveBeenCalled();
  });

  it("returns an audition button to normal and reports decoding failures", async () => {
    audioContext.decodeAudioData.mockRejectedValue(new Error("Unsupported WAV data"));
    const localVoiceCatalog = { get: vi.fn(async (modelId: string) => ({ schemaVersion: 1 as const, modelId, entries: [{ voiceId: "voice-b2", label: "Second voice", enabled: true, favorite: false, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }] })), replace: vi.fn() };
    const client = { settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() }, globalLexicon: { list: vi.fn(async () => []), replace: vi.fn(async (entries: GlobalLexiconReplaceInput) => entries) } } as unknown as PersistenceClient;
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={localVoiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} scratchpadClient={scratchpadClient} /></ConnectionProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Test Second voice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Voice test failed: Unsupported WAV data");
    expect(screen.getByRole("button", { name: "Test Second voice" })).toBeInTheDocument();
  });

  it("disables invalid auditions and aborts pending synthesis on unmount", async () => {
    let pendingSignal: AbortSignal | undefined;
    const preview = vi.fn<ScratchpadClient["preview"]>((_input, signal) => {
      pendingSignal = signal;
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError"))));
    });
    const localVoiceCatalog = { get: vi.fn(async (modelId: string) => ({ schemaVersion: 1 as const, modelId, entries: [{ voiceId: "voice-b2", label: "Second voice", enabled: true, favorite: false, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }] })), replace: vi.fn() };
    const client = { settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() }, globalLexicon: { list: vi.fn(async () => []), replace: vi.fn(async (entries: GlobalLexiconReplaceInput) => entries) } } as unknown as PersistenceClient;
    const view = render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={localVoiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} scratchpadClient={{ preview }} /></ConnectionProvider>);
    const button = await screen.findByRole("button", { name: "Test Second voice" });
    fireEvent.change(screen.getByLabelText("Voice test script"), { target: { value: "" } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Voice test script"), { target: { value: "Ready sample" } });
    await userEvent.click(button);
    expect(pendingSignal?.aborted).toBe(false);
    view.unmount();
    expect(pendingSignal?.aborted).toBe(true);
    expect(audioContext.close).toHaveBeenCalled();
  });

  it("shows session cache statistics and confirms clear-all", async () => {
    const client = { settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() }, globalLexicon: { list: vi.fn(async () => []), replace: vi.fn(async (entries: GlobalLexiconReplaceInput) => entries) } } as unknown as PersistenceClient;
    const status = vi.fn()
      .mockResolvedValueOnce({ contractVersion: 1, entryCount: 2, totalBytes: 2048, lastUsedAt: "2026-08-12T12:00:00.000Z", sessionHits: 3, sessionMisses: 2, sessionWrites: 2, sessionCorruptMisses: 1, inFlight: 0 })
      .mockResolvedValueOnce({ contractVersion: 1, entryCount: 0, totalBytes: 0, lastUsedAt: null, sessionHits: 3, sessionMisses: 2, sessionWrites: 2, sessionCorruptMisses: 1, inFlight: 0 });
    const clearAll = vi.fn(async () => ({ contractVersion: 1 as const, entriesRemoved: 2, bytesFreed: 2048 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={{ status, clearAll, clearProject: vi.fn(), clearEntry: vi.fn() }} scratchpadClient={scratchpadClient} /></ConnectionProvider>);
    expect(await screen.findByText("2 entries")).toBeInTheDocument();
    expect(screen.getByText("3 hits · 2 misses")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear all cached speech" }));
    expect(clearAll).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Cleared 2 cached speech entries/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all cached speech" })).toBeDisabled();
  });
});
