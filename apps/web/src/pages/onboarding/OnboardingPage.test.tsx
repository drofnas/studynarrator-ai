// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile, ConnectionTestSummary, ConnectionsClient, PersistenceClient } from "@studynarrator/shared-types";
import { App } from "@/app/App.js";

const timestamp = "2026-08-12T12:00:00.000Z";
const profile: ConnectionProfile = {
  id: "local", name: "Local Speaches", baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root", source: "saved", editable: true,
  credentialEntryAllowed: true, configured: true, apiKeyConfigured: true, defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX", defaultVoiceId: "af_heart",
  timeoutSeconds: 120, retryCount: 2, responseFormat: "wav", lastTestedAt: null, lastSuccessfulTestAt: null, lastTestSummary: null,
  createdAt: timestamp, updatedAt: timestamp
};
const summary: ConnectionTestSummary = {
  schemaVersion: 1, overall: "modelUnavailable", testedAt: timestamp, httpStatus: 200,
  stages: ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"].map((stage, index) => ({
    stage: stage as ConnectionTestSummary["stages"][number]["stage"], status: index < 5 ? "pass" : index === 5 ? "fail" : "skipped",
    code: `${stage}-result`, message: "Diagnostic result.", durationMs: 1
  })),
  availableModelIds: [], availableVoiceIds: null
};
const persistence = {
  projects: { list: vi.fn(async () => []), create: vi.fn(), get: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), delete: vi.fn() },
  globalLexicon: { list: vi.fn(async () => []), replace: vi.fn() },
  preferences: { getIgnoredDiagnostics: vi.fn(async () => []), replaceIgnoredDiagnostics: vi.fn() }
} as unknown as PersistenceClient;
const voiceCatalog = { get: vi.fn(async (modelId: string) => ({ schemaVersion: 1 as const, modelId, entries: [] })), replace: vi.fn() };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function clients(client: "web" | "electron") {
  const completeOnboarding = vi.fn(async () => ({ activeProfileId: null, activeProfileLocked: false, onboardingCompletedAt: timestamp, client }));
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => profile), replace: vi.fn(), delete: vi.fn(),
    test: vi.fn(async () => summary), exportDiagnostics: vi.fn(),
    discoverSpeechCatalog: vi.fn(async (profileId: string) => ({ schemaVersion: 1 as const, profileId, models: [] })),
    getSetupState: vi.fn(async () => ({ activeProfileId: null, activeProfileLocked: false, onboardingCompletedAt: null, client })),
    setActiveProfile: vi.fn(async () => ({ activeProfileId: profile.id, activeProfileLocked: false, onboardingCompletedAt: null, client })),
    completeOnboarding
  };
}

function renderApp(connections: ConnectionsClient, route = "/projects") {
  const speechCache = {
    status: vi.fn(async () => ({ contractVersion: 1 as const, entryCount: 0, totalBytes: 0, lastUsedAt: null, sessionHits: 0, sessionMisses: 0, sessionWrites: 0, sessionCorruptMisses: 0, inFlight: 0 })),
    clearAll: vi.fn(), clearProject: vi.fn(), clearEntry: vi.fn()
  };
  return render(<MemoryRouter initialEntries={[route]}><App analyzer={{ analyze: vi.fn() }} client={{ diagnostics: vi.fn() }} persistence={persistence} connections={connections} voiceCatalog={voiceCatalog} scratchpad={{ preview: vi.fn() }} projectPreview={{ preview: vi.fn() }} speechCache={speechCache} renderPlans={{ create: vi.fn(), list: vi.fn(async () => []), get: vi.fn() }} /></MemoryRouter>);
}

describe("connection onboarding", () => {
  it("redirects first run, shows Web guidance, and persists Continue offline", async () => {
    const connections = clients("web");
    renderApp(connections);
    expect(await screen.findByRole("heading", { name: "Connect the voice workshop" })).toBeInTheDocument();
    expect(screen.getByText(/API keys must come from SPEACHES_API_KEY/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continue offline" }));
    expect(connections.completeOnboarding).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
  });

  it("submits an Electron key once and clears the password field after a failed diagnostic", async () => {
    const connections = clients("electron");
    renderApp(connections, "/onboarding");
    const password = await screen.findByLabelText(/API key \(one shot\)/u);
    await userEvent.type(password, "test-secret-must-not-appear");
    await userEvent.click(screen.getByRole("button", { name: "Create + Test Connection" }));
    expect(connections.create).toHaveBeenCalledWith(expect.objectContaining({ credential: { action: "replace", apiKey: "test-secret-must-not-appear" } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("modelUnavailable");
    expect(password).toHaveValue("");
    expect(JSON.stringify(await connections.list())).not.toContain("test-secret-must-not-appear");
  });

  it("shows Testing in the shell while a staged check is pending", async () => {
    let finish: (value: ConnectionTestSummary) => void = () => undefined;
    const pending = new Promise<ConnectionTestSummary>((resolve) => { finish = resolve; });
    const connections = {
      ...clients("web"),
      list: vi.fn(async () => [profile]),
      test: vi.fn(() => pending),
      getSetupState: vi.fn(async () => ({ activeProfileId: profile.id, activeProfileLocked: false, onboardingCompletedAt: null, client: "web" as const }))
    };
    renderApp(connections, "/onboarding");
    const buttons = await screen.findAllByRole("button", { name: "Test Connection" });
    fireEvent.click(buttons.at(-1)!);
    expect(screen.getByRole("link", { name: "Testing" })).toHaveAttribute("data-state", "testing");
    await act(async () => finish(summary));
  });
});
