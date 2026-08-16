// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionTestSummary, SpeachesConnection, SpeachesConnectionClient, SpeechCatalog, VoiceCatalogClient } from "@studynarrator/shared-types";
import { ConnectionProvider, useConnections } from "./ConnectionProvider.js";

const timestamp = "2026-08-12T12:00:00.000Z";
const summary: ConnectionTestSummary = {
  schemaVersion: 1, overall: "connected", testedAt: timestamp, httpStatus: 200,
  stages: ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"].map((stage) => ({
    stage: stage as ConnectionTestSummary["stages"][number]["stage"], status: "pass", code: `${stage}-pass`, message: "Passed.", durationMs: 1
  })),
  availableModelIds: ["model"], availableVoiceIds: ["voice"]
};
const connection: SpeachesConnection = {
  baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root", configured: true,
  defaultModelId: "model", defaultVoiceId: "voice", timeoutSeconds: 120, retryCount: 2,
  responseFormat: "wav", lastTestedAt: timestamp, lastSuccessfulTestAt: timestamp,
  lastTestSummary: summary, createdAt: timestamp, updatedAt: timestamp
};
const catalog: SpeechCatalog = {
  schemaVersion: 1,
  models: [{ modelId: "model", voices: [{ voiceId: "voice", name: "Voice", language: null, gender: null }] }]
};

function Consumer() {
  const workspace = useConnections();
  return <div>
    <span>{workspace.catalog.status}</span>
    <span>{workspace.loading ? "connection loading" : "connection loaded"}</span>
    <span>{workspace.connection?.baseUrl ?? "connection missing"}</span>
    <button type="button" onClick={() => void workspace.discover({ baseUrl: connection.baseUrl!, timeoutSeconds: 120, retryCount: 2 })}>Load catalog</button>
    <button type="button" onClick={() => void workspace.test()}>Test connection</button>
    <button type="button" onClick={() => void workspace.refresh()}>Refresh connection</button>
  </div>;
}

afterEach(cleanup);

describe("ConnectionProvider", () => {
  it("loads the singleton and refreshes it after a connection test", async () => {
    const discoverSpeechCatalog = vi.fn(async () => catalog);
    const get = vi.fn(async () => connection);
    const connectionClient: SpeachesConnectionClient = {
      get, update: vi.fn(async () => connection), test: vi.fn(async () => summary), discoverSpeechCatalog,
      exportDiagnostics: vi.fn(),
      getSetupState: vi.fn(async () => ({ onboardingCompletedAt: timestamp, client: "web" as const })),
      completeOnboarding: vi.fn(async () => ({ onboardingCompletedAt: timestamp, client: "web" as const }))
    };
    const voiceCatalog: VoiceCatalogClient = { get: vi.fn(), replace: vi.fn() };
    render(<ConnectionProvider connectionClient={connectionClient} voiceCatalog={voiceCatalog}><Consumer /></ConnectionProvider>);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(screen.getByText("idle")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load catalog" }));
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    expect(discoverSpeechCatalog).toHaveBeenCalledWith({ baseUrl: connection.baseUrl, timeoutSeconds: 120, retryCount: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it("recovers when the initial singleton load fails during an application restart", async () => {
    const get = vi.fn<SpeachesConnectionClient["get"]>()
      .mockRejectedValueOnce(new Error("Connection service restarted."))
      .mockResolvedValue(connection);
    const connectionClient: SpeachesConnectionClient = {
      get, update: vi.fn(async () => connection), test: vi.fn(async () => summary), discoverSpeechCatalog: vi.fn(async () => catalog),
      exportDiagnostics: vi.fn(),
      getSetupState: vi.fn(async () => ({ onboardingCompletedAt: timestamp, client: "web" as const })),
      completeOnboarding: vi.fn(async () => ({ onboardingCompletedAt: timestamp, client: "web" as const }))
    };
    const voiceCatalog: VoiceCatalogClient = { get: vi.fn(), replace: vi.fn() };
    render(<ConnectionProvider connectionClient={connectionClient} voiceCatalog={voiceCatalog}><Consumer /></ConnectionProvider>);

    expect(await screen.findByText(connection.baseUrl!)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.getByText("connection loaded")).toBeInTheDocument();
    expect(screen.queryByText("connection missing")).not.toBeInTheDocument();
  });

  it("keeps the last loaded singleton visible when a later refresh fails", async () => {
    const get = vi.fn<SpeachesConnectionClient["get"]>()
      .mockResolvedValueOnce(connection)
      .mockRejectedValueOnce(new Error("Connection service restarted."));
    const connectionClient: SpeachesConnectionClient = {
      get, update: vi.fn(async () => connection), test: vi.fn(async () => summary), discoverSpeechCatalog: vi.fn(async () => catalog),
      exportDiagnostics: vi.fn(),
      getSetupState: vi.fn(async () => ({ onboardingCompletedAt: timestamp, client: "web" as const })),
      completeOnboarding: vi.fn(async () => ({ onboardingCompletedAt: timestamp, client: "web" as const }))
    };
    const voiceCatalog: VoiceCatalogClient = { get: vi.fn(), replace: vi.fn() };
    render(<ConnectionProvider connectionClient={connectionClient} voiceCatalog={voiceCatalog}><Consumer /></ConnectionProvider>);

    expect(await screen.findByText(connection.baseUrl!)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh connection" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByText(connection.baseUrl!)).toBeInTheDocument();
    expect(screen.getByText("connection loaded")).toBeInTheDocument();
  });
});
