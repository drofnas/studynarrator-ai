// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionTestOverall, GlobalLexiconReplaceInput, PersistenceClient, SpeachesConnection, SpeachesConnectionClient } from "@studynarrator/shared-types";
import { SettingsPage } from "./SettingsPage.js";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const cacheClient = {
  status: vi.fn(async () => ({ contractVersion: 1 as const, entryCount: 0, totalBytes: 0, lastUsedAt: null, sessionHits: 0, sessionMisses: 0, sessionWrites: 0, sessionCorruptMisses: 0, inFlight: 0 })),
  clearAll: vi.fn(async () => ({ contractVersion: 1 as const, entriesRemoved: 0, bytesFreed: 0 })),
  clearProject: vi.fn(), clearEntry: vi.fn()
};
const timestamp = "2026-08-12T12:00:00.000Z";
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

    const connected = render(<ConnectionProvider connectionClient={connectionClient({ get: vi.fn(async () => connectionWithTest("connected")) })} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} /></ConnectionProvider>);
    await screen.findByDisplayValue(savedConnection.baseUrl);
    expect(screen.queryByText("Signal path")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export redacted JSON" })).not.toBeInTheDocument();
    connected.unmount();

    const failed = render(<ConnectionProvider connectionClient={connectionClient({ get: vi.fn(async () => connectionWithTest("disconnected")) })} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} /></ConnectionProvider>);
    expect(await screen.findByText("Signal path")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "disconnected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export redacted JSON" })).toBeInTheDocument();
    failed.unmount();

    render(<ConnectionProvider connectionClient={connectionClient({ get: vi.fn(async () => connectionWithTest("configurationError", false)) })} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} /></ConnectionProvider>);
    await waitFor(() => expect(screen.getByLabelText("Address")).toHaveValue(""));
    expect(screen.queryByText("Signal path")).not.toBeInTheDocument();
  });

  it("manages persisted global lexicon entries outside project settings", async () => {
    let stored = [{ id: "global-sql", scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel", caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp }];
    const replace = vi.fn(async (entries: Array<Record<string, unknown>>) => {
      stored = entries.map((entry, index) => ({ ...entry, id: typeof entry.id === "string" ? entry.id : `global-${String(index + 1)}`, scope: "global", createdAt: timestamp, updatedAt: timestamp })) as typeof stored;
      return structuredClone(stored);
    });
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
      globalLexicon: { list: vi.fn(async () => structuredClone(stored)), replace }
    } as unknown as PersistenceClient;
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} /></ConnectionProvider>);

    expect(await screen.findByRole("heading", { name: "Global lexicon" })).toBeInTheDocument();
    expect(screen.getByText("SQL")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(replace).toHaveBeenLastCalledWith([expect.objectContaining({ id: "global-sql", enabled: false, scope: "global" })]);

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Spoken text"), { target: { value: "ess cue ell" } });
    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));
    expect(await screen.findByText("→ ess cue ell")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("No matching global lexicon entries.")).toBeInTheDocument();
  });

  it("normalizes and saves new-project pacing without touching projects", async () => {
    const updatePacing = vi.fn(async (input: { enabled: boolean; durationMs: number }) => input);
    const replaceProject = vi.fn();
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing },
      globalLexicon: { list: vi.fn(async () => []), replace: vi.fn(async (entries: GlobalLexiconReplaceInput) => entries) },
      projects: { replace: replaceProject }
    } as unknown as PersistenceClient;
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} /></ConnectionProvider>);
    const input = await screen.findByLabelText(/Default pause_medium duration/u);
    fireEvent.change(input, { target: { value: "1.5 s" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pacing defaults" }));
    expect(await screen.findByText("Pacing defaults saved. Existing projects were not changed.")).toBeInTheDocument();
    expect(updatePacing).toHaveBeenCalledWith({ enabled: true, durationMs: 1_500 });
    expect(replaceProject).not.toHaveBeenCalled();
  });

  it("uses an editable singleton and preserves server ordering in the model and default voice dropdowns", async () => {
    const replaceCatalog = vi.fn(async (input: { schemaVersion: 1; modelId: string; entries: never[] }) => input);
    const localVoiceCatalog = {
      get: vi.fn(async (modelId: string) => ({ schemaVersion: 1 as const, modelId, entries: [{ voiceId: "voice-b2", label: "Disabled locally", enabled: false, language: "English", locale: "en-US", accent: null, category: null, style: null, sampleText: null }] })),
      replace: replaceCatalog
    };
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
      globalLexicon: { list: vi.fn(async () => []), replace: vi.fn(async (entries: GlobalLexiconReplaceInput) => entries) }
    } as unknown as PersistenceClient;
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={localVoiceCatalog}><SettingsPage client={client} cacheClient={cacheClient} /></ConnectionProvider>);
    expect(await screen.findByLabelText("Address")).toBeEnabled();
    expect(screen.queryByText(/Environment Speaches|Active profile|API key/u)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("model-b"));
    expect(screen.getByLabelText("Default Voice")).toHaveValue("voice-b2");
    expect(screen.getByRole("option", { name: "Second — voice-b2" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "First — voice-b1" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Strict override JSON"), { target: { value: JSON.stringify({ schemaVersion: 1, modelId: savedConnection.defaultModelId, entries: [] }) } });
    await userEvent.click(screen.getByRole("button", { name: "Replace model overrides" }));
    expect(replaceCatalog).toHaveBeenCalledWith({ schemaVersion: 1, modelId: savedConnection.defaultModelId, entries: [] });
  });

  it("shows session cache statistics and confirms clear-all", async () => {
    const client = { settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() }, globalLexicon: { list: vi.fn(async () => []), replace: vi.fn(async (entries: GlobalLexiconReplaceInput) => entries) } } as unknown as PersistenceClient;
    const status = vi.fn()
      .mockResolvedValueOnce({ contractVersion: 1, entryCount: 2, totalBytes: 2048, lastUsedAt: "2026-08-12T12:00:00.000Z", sessionHits: 3, sessionMisses: 2, sessionWrites: 2, sessionCorruptMisses: 1, inFlight: 0 })
      .mockResolvedValueOnce({ contractVersion: 1, entryCount: 0, totalBytes: 0, lastUsedAt: null, sessionHits: 3, sessionMisses: 2, sessionWrites: 2, sessionCorruptMisses: 1, inFlight: 0 });
    const clearAll = vi.fn(async () => ({ contractVersion: 1 as const, entriesRemoved: 2, bytesFreed: 2048 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={voiceCatalog}><SettingsPage client={client} cacheClient={{ status, clearAll, clearProject: vi.fn(), clearEntry: vi.fn() }} /></ConnectionProvider>);
    expect(await screen.findByText("2 entries")).toBeInTheDocument();
    expect(screen.getByText("3 hits · 2 misses")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear all cached speech" }));
    expect(clearAll).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Cleared 2 cached speech entries/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all cached speech" })).toBeDisabled();
  });
});
