// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistenceClient } from "@studynarrator/shared-types";
import { SettingsPage } from "./SettingsPage.js";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";

afterEach(cleanup);

describe("System Settings", () => {
  it("normalizes and saves new-project pacing without touching projects", async () => {
    const updatePacing = vi.fn(async (input: { enabled: boolean; durationMs: number }) => input);
    const replaceProject = vi.fn();
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing },
      projects: { replace: replaceProject }
    } as unknown as PersistenceClient;
    const connections = {
      list: vi.fn(async () => []), create: vi.fn(), replace: vi.fn(), delete: vi.fn(), test: vi.fn(), exportDiagnostics: vi.fn(),
      getSetupState: vi.fn(async () => ({ activeProfileId: null, activeProfileLocked: false, onboardingCompletedAt: "2026-08-12T12:00:00.000Z", client: "web" as const })),
      setActiveProfile: vi.fn(), completeOnboarding: vi.fn()
    };
    const voiceCatalog = { get: vi.fn(async (modelId: string) => ({ schemaVersion: 1 as const, modelId, entries: [] })), replace: vi.fn() };
    render(<ConnectionProvider connections={connections} voiceCatalog={voiceCatalog}><SettingsPage client={client} /></ConnectionProvider>);
    const input = await screen.findByLabelText(/Default pause_medium duration/u);
    fireEvent.change(input, { target: { value: "1.5 s" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pacing defaults" }));
    expect(await screen.findByText("Pacing defaults saved. Existing projects were not changed.")).toBeInTheDocument();
    expect(updatePacing).toHaveBeenCalledWith({ enabled: true, durationMs: 1_500 });
    expect(replaceProject).not.toHaveBeenCalled();
  });

  it("locks environment fields and supports catalog search and strict replacement", async () => {
    const timestamp = "2026-08-12T12:00:00.000Z";
    const environmentProfile = {
      id: "environment-speaches", name: "Environment Speaches", baseUrl: "https://speech.example.test", suppliedUrlForm: "v1" as const,
      source: "environment" as const, editable: false, credentialEntryAllowed: false, configured: true, apiKeyConfigured: true,
      defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX", defaultVoiceId: "af_heart", timeoutSeconds: 120, retryCount: 2, responseFormat: "wav" as const,
      lastTestedAt: null, lastSuccessfulTestAt: null, lastTestSummary: null, createdAt: timestamp, updatedAt: timestamp
    };
    const connections = {
      list: vi.fn(async () => [environmentProfile]), create: vi.fn(), replace: vi.fn(), delete: vi.fn(), test: vi.fn(), exportDiagnostics: vi.fn(),
      getSetupState: vi.fn(async () => ({ activeProfileId: environmentProfile.id, activeProfileLocked: true, onboardingCompletedAt: timestamp, client: "web" as const })),
      setActiveProfile: vi.fn(), completeOnboarding: vi.fn()
    };
    const replaceCatalog = vi.fn(async (input: { schemaVersion: 1; modelId: string; entries: never[] }) => input);
    const voiceCatalog = {
      get: vi.fn(async (modelId: string) => ({ schemaVersion: 1 as const, modelId, entries: [{ voiceId: "af_heart", label: "Heart — American English — af_heart", enabled: true, language: "American English", locale: "en-US", accent: "American", category: null, style: null, sampleText: null }] })),
      replace: replaceCatalog
    };
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing: vi.fn() }
    } as unknown as PersistenceClient;
    render(<ConnectionProvider connections={connections} voiceCatalog={voiceCatalog}><SettingsPage client={client} /></ConnectionProvider>);
    expect(await screen.findByDisplayValue("Environment Speaches")).toBeDisabled();
    expect(screen.getByText(/effective source: server environment/u)).toBeInTheDocument();
    expect(screen.getByLabelText("Active profile")).toBeDisabled();
    expect((await screen.findAllByText("Heart — American English — af_heart")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Strict override JSON"), { target: { value: JSON.stringify({ schemaVersion: 1, modelId: environmentProfile.defaultModelId, entries: [] }) } });
    await userEvent.click(screen.getByRole("button", { name: "Replace model overrides" }));
    expect(replaceCatalog).toHaveBeenCalledWith({ schemaVersion: 1, modelId: environmentProfile.defaultModelId, entries: [] });
  });
});
