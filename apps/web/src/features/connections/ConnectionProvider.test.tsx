// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile, ConnectionTestSummary, ConnectionsClient, SpeechCatalog, VoiceCatalogClient } from "@studynarrator/shared-types";
import { ConnectionProvider, useConnections } from "./ConnectionProvider.js";

const timestamp = "2026-08-12T12:00:00.000Z";
const summary: ConnectionTestSummary = {
  schemaVersion: 1,
  overall: "connected",
  testedAt: timestamp,
  httpStatus: 200,
  stages: ["url", "dns", "tcp", "http", "authentication", "model", "voice", "audio"].map((stage) => ({
    stage: stage as ConnectionTestSummary["stages"][number]["stage"], status: "pass", code: `${stage}-pass`, message: "Passed.", durationMs: 1
  })),
  availableModelIds: ["model"],
  availableVoiceIds: ["voice"]
};
const profile: ConnectionProfile = {
  id: "profile", name: "Profile", baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root", source: "saved", editable: true,
  credentialEntryAllowed: false, configured: true, apiKeyConfigured: false, defaultModelId: "model", defaultVoiceId: "voice",
  timeoutSeconds: 120, retryCount: 2, responseFormat: "wav", lastTestedAt: timestamp, lastSuccessfulTestAt: timestamp, lastTestSummary: summary,
  createdAt: timestamp, updatedAt: timestamp
};
const catalog: SpeechCatalog = {
  schemaVersion: 1, profileId: profile.id, models: [{ modelId: "model", voices: [{ voiceId: "voice", name: "Voice", language: null, gender: null }] }]
};

function Consumer() {
  const workspace = useConnections();
  const state = workspace.speechCatalog(profile.id);
  return <div>
    <span>{state.status}</span>
    <button type="button" onClick={() => void Promise.all([workspace.loadSpeechCatalog(profile.id), workspace.loadSpeechCatalog(profile.id)])}>Load twice</button>
    <button type="button" onClick={() => void workspace.test(profile.id)}>Test profile</button>
  </div>;
}

afterEach(cleanup);

describe("ConnectionProvider speech catalog session", () => {
  it("deduplicates session discovery and invalidates it after a connection test", async () => {
    const discoverSpeechCatalog = vi.fn(async () => catalog);
    const connections: ConnectionsClient = {
      list: vi.fn(async () => [profile]), create: vi.fn(), replace: vi.fn(), delete: vi.fn(),
      test: vi.fn(async () => summary), discoverSpeechCatalog, exportDiagnostics: vi.fn(),
      getSetupState: vi.fn(async () => ({ activeProfileId: profile.id, activeProfileLocked: false, onboardingCompletedAt: timestamp, client: "web" as const })),
      setActiveProfile: vi.fn(), completeOnboarding: vi.fn()
    };
    const voiceCatalog: VoiceCatalogClient = { get: vi.fn(), replace: vi.fn() };
    render(<ConnectionProvider connections={connections} voiceCatalog={voiceCatalog}><Consumer /></ConnectionProvider>);

    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    expect(discoverSpeechCatalog).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Load twice" }));
    expect(discoverSpeechCatalog).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Test profile" }));
    await waitFor(() => expect(discoverSpeechCatalog).toHaveBeenCalledTimes(2));
  });
});
