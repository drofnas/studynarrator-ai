// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionTestOverall, PersistenceClient, SystemClient } from "@studynarrator/shared-types";
import { App } from "./App.js";

const unusedAnalyzer = { analyze: vi.fn() };
const unusedPersistence: PersistenceClient = {
  status: vi.fn(async () => { throw new Error("unused"); }),
  projects: { list: vi.fn(async () => []), create: vi.fn(), get: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), delete: vi.fn() },
  settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() },
  preferences: { getIgnoredDiagnostics: vi.fn(async () => []), replaceIgnoredDiagnostics: vi.fn() },
  globalLexicon: { list: vi.fn(async () => []), replace: vi.fn() }
};
const unusedConnections = {
  list: vi.fn(async () => []), create: vi.fn(), replace: vi.fn(), delete: vi.fn(), test: vi.fn(), exportDiagnostics: vi.fn(),
  discoverSpeechCatalog: vi.fn(async (profileId: string) => ({ schemaVersion: 1 as const, profileId, models: [] })),
  getSetupState: vi.fn(async () => ({ activeProfileId: null, activeProfileLocked: false, onboardingCompletedAt: "2026-08-12T12:00:00.000Z", client: "web" as const })),
  setActiveProfile: vi.fn(), completeOnboarding: vi.fn()
};
const unusedVoiceCatalog = { get: vi.fn(async (modelId: string) => ({ schemaVersion: 1 as const, modelId, entries: [] })), replace: vi.fn() };
const unusedScratchpad = { preview: vi.fn() };
const unusedProjectPreview = { preview: vi.fn() };
const unusedSpeechCache = {
  status: vi.fn(async () => ({ contractVersion: 1 as const, entryCount: 0, totalBytes: 0, lastUsedAt: null, sessionHits: 0, sessionMisses: 0, sessionWrites: 0, sessionCorruptMisses: 0, inFlight: 0 })),
  clearAll: vi.fn(), clearProject: vi.fn(), clearEntry: vi.fn()
};

afterEach(cleanup);

function renderApp(route: string, client: SystemClient = { diagnostics: vi.fn() }, connections = unusedConnections) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App analyzer={unusedAnalyzer} client={client} persistence={unusedPersistence} connections={connections} voiceCatalog={unusedVoiceCatalog} scratchpad={unusedScratchpad} projectPreview={unusedProjectPreview} speechCache={unusedSpeechCache} renderPlans={{ create: vi.fn(), list: vi.fn(async () => []), get: vi.fn() }} />
    </MemoryRouter>
  );
}

describe("application routing", () => {
  it.each(["/", "/missing-page"])("redirects %s to Projects", async (route) => {
    const diagnostics = vi.fn();
    renderApp(route, { diagnostics });
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it("navigates directly to system diagnostics", async () => {
    const user = userEvent.setup();
    renderApp("/projects");
    await user.click(screen.getByRole("link", { name: "System diagnostics" }));
    expect(screen.getByRole("heading", { name: "Runtime self-test" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "System diagnostics" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Review tools")).not.toBeInTheDocument();
  });

  it("reaches Quick Scratchpad through primary navigation", async () => {
    const user = userEvent.setup();
    renderApp("/projects");
    await user.click(screen.getByRole("link", { name: "Quick Scratchpad" }));
    expect(await screen.findByRole("heading", { name: "Quick Scratchpad" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Quick Scratchpad" })).toHaveAttribute("aria-current", "page");
  });

  it.each(["/script-lab", "/persistence-lab"])("redirects removed review route %s to Projects", async (route) => {
    renderApp(route);
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.queryByText(/Lab/u)).not.toBeInTheDocument();
  });

  it.each([
    ["connected", "Connected"],
    ["modelUnavailable", "Model unavailable"],
    ["voiceUnavailable", "Voice unavailable"],
    ["authenticationRequired", "Authentication required"],
    ["disconnected", "Disconnected"],
    ["configurationError", "Configuration error"],
    ["invalidAudio", "Configuration error"]
  ] as const)("shows the %s shell connection state", async (overall, label) => {
    const testedAt = "2026-08-12T12:00:00.000Z";
    const profile = {
      id: "local", name: "Local", baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root" as const, source: "saved" as const, editable: true,
      credentialEntryAllowed: false, configured: true, apiKeyConfigured: false, defaultModelId: "model", defaultVoiceId: "voice", timeoutSeconds: 120,
      retryCount: 2, responseFormat: "wav" as const, lastTestedAt: testedAt, lastSuccessfulTestAt: overall === "connected" ? testedAt : null,
      lastTestSummary: { schemaVersion: 1 as const, overall: overall as ConnectionTestOverall, testedAt, httpStatus: 200, stages: [], availableModelIds: [], availableVoiceIds: null },
      createdAt: testedAt, updatedAt: testedAt
    };
    const connections = {
      ...unusedConnections,
      list: vi.fn(async () => [profile]),
      getSetupState: vi.fn(async () => ({ activeProfileId: profile.id, activeProfileLocked: false, onboardingCompletedAt: testedAt, client: "web" as const }))
    };
    renderApp("/projects", { diagnostics: vi.fn() }, connections as never);
    expect(await screen.findByRole("link", { name: label })).toHaveAttribute("data-state", overall);
  });
});
