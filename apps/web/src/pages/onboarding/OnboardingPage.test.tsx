// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionTestSummary, PersistenceClient, SpeachesConnectionClient } from "@studynarrator/shared-types";
import { App } from "@/app/App.js";

const timestamp = "2026-08-12T12:00:00.000Z";
const emptyConnection = {
  baseUrl: null, suppliedUrlForm: "unconfigured" as const, configured: false, defaultModelId: null, defaultVoiceId: null,
  timeoutSeconds: 120, retryCount: 2, responseFormat: "wav" as const, lastTestedAt: null, lastSuccessfulTestAt: null,
  lastTestSummary: null, createdAt: timestamp, updatedAt: timestamp
};
const connectedSummary: ConnectionTestSummary = {
  schemaVersion: 1, overall: "connected", testedAt: timestamp, httpStatus: 200,
  stages: ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"].map((stage) => ({
    stage: stage as ConnectionTestSummary["stages"][number]["stage"], status: "pass", code: `${stage}-pass`, message: "Passed.", durationMs: 1
  })), availableModelIds: ["model-z", "model-a"], availableVoiceIds: ["voice-z", "voice-a"]
};
const persistence = {
  projects: { list: vi.fn(async () => []), create: vi.fn(), get: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), delete: vi.fn() },
  globalLexicon: { list: vi.fn(async () => []), replace: vi.fn() },
  preferences: { getIgnoredDiagnostics: vi.fn(async () => []), replaceIgnoredDiagnostics: vi.fn() }
} as unknown as PersistenceClient;
const voiceCatalog = { get: vi.fn(async (modelId: string) => ({ schemaVersion: 1 as const, modelId, entries: [] })), replace: vi.fn() };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function client() {
  let onboardingCompletedAt: string | null = null;
  return {
    get: vi.fn(async () => emptyConnection),
    update: vi.fn<SpeachesConnectionClient["update"]>(async (input) => ({
      ...emptyConnection,
      ...input,
      timeoutSeconds: input.timeoutSeconds ?? emptyConnection.timeoutSeconds,
      retryCount: input.retryCount ?? emptyConnection.retryCount,
      responseFormat: input.responseFormat ?? emptyConnection.responseFormat,
      suppliedUrlForm: "root" as const,
      configured: true,
      baseUrl: input.baseUrl ?? null
    })),
    test: vi.fn(async () => connectedSummary),
    discoverSpeechCatalog: vi.fn(async () => ({
      schemaVersion: 1 as const,
      models: [
        { modelId: "model-z", voices: [{ voiceId: "voice-z", name: "First Voice", language: null, gender: null }, { voiceId: "voice-y", name: null, language: null, gender: null }] },
        { modelId: "model-a", voices: [{ voiceId: "voice-a", name: "Other Voice", language: null, gender: null }] }
      ]
    })),
    exportDiagnostics: vi.fn(),
    getSetupState: vi.fn(async () => ({ onboardingCompletedAt, client: "web" as const })),
    completeOnboarding: vi.fn(async () => {
      onboardingCompletedAt = timestamp;
      return { onboardingCompletedAt, client: "web" as const };
    })
  } satisfies SpeachesConnectionClient;
}

function renderApp(connection: SpeachesConnectionClient, route = "/projects") {
  const speechCache = {
    status: vi.fn(async () => ({ contractVersion: 1 as const, entryCount: 0, totalBytes: 0, lastUsedAt: null, sessionHits: 0, sessionMisses: 0, sessionWrites: 0, sessionCorruptMisses: 0, inFlight: 0 })),
    clearAll: vi.fn(), clearProject: vi.fn(), clearEntry: vi.fn()
  };
  return render(<MemoryRouter initialEntries={[route]}><App analyzer={{ analyze: vi.fn() }} client={{ diagnostics: vi.fn() }} persistence={persistence} connection={connection} voiceCatalog={voiceCatalog} scratchpad={{ preview: vi.fn() }} projectPreview={{ preview: vi.fn() }} speechCache={speechCache} renderPlans={{ create: vi.fn(), list: vi.fn(async () => []), get: vi.fn() }} scriptGeneration={{ previewPrompt: vi.fn(), exportPrompt: vi.fn(), exportSkillPackage: vi.fn() }} /></MemoryRouter>);
}

describe("connection onboarding", () => {
  it("discovers a draft and preselects the first returned model and voice", async () => {
    const connection = client();
    renderApp(connection);
    expect(await screen.findByRole("heading", { name: "Connect the voice workshop" })).toBeInTheDocument();
    expect(screen.queryByText(/API key|profile/u)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Speaches address"), "http://127.0.0.1:8000");
    await userEvent.click(screen.getByRole("button", { name: "Load catalog" }));
    expect(await screen.findByLabelText("Model")).toHaveValue("model-z");
    expect(screen.getByLabelText("Default Voice")).toHaveValue("voice-z");
    expect(connection.update).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText("Model"), "model-a");
    expect(screen.getByLabelText("Default Voice")).toHaveValue("voice-a");
    await userEvent.click(screen.getByRole("button", { name: "Save and Test" }));
    await waitFor(() => expect(connection.update).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "http://127.0.0.1:8000", defaultModelId: "model-a", defaultVoiceId: "voice-a"
    })));
    expect(connection.test).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
  });

  it("invalidates the loaded catalog when the address changes", async () => {
    const connection = client();
    renderApp(connection, "/onboarding");
    const address = await screen.findByLabelText("Speaches address");
    await userEvent.type(address, "http://127.0.0.1:8000");
    await userEvent.click(screen.getByRole("button", { name: "Load catalog" }));
    expect(await screen.findByLabelText("Model")).toBeInTheDocument();
    await userEvent.type(address, "1");
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
  });

  it("persists Continue offline without configuring a server", async () => {
    const connection = client();
    renderApp(connection);
    await userEvent.click(await screen.findByRole("button", { name: "Continue offline" }));
    expect(connection.completeOnboarding).toHaveBeenCalledOnce();
    expect(connection.update).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
  });
});
