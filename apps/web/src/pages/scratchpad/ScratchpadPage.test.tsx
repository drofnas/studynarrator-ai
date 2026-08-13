// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistenceClient, ScratchpadPreviewResult } from "@studynarrator/shared-types";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";
import { ScratchpadSessionProvider } from "@/features/scratchpad/ScratchpadSessionProvider.js";
import { ScratchpadPage } from "./ScratchpadPage.js";

const timestamp = "2026-08-12T12:00:00.000Z";
const profile = {
  id: "local", name: "Local Speaches", baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root" as const, source: "saved" as const,
  editable: true, credentialEntryAllowed: false, configured: true, apiKeyConfigured: false, defaultModelId: "model", defaultVoiceId: "voice",
  timeoutSeconds: 120, retryCount: 2, responseFormat: "wav" as const, lastTestedAt: timestamp, lastSuccessfulTestAt: timestamp,
  lastTestSummary: { schemaVersion: 1 as const, overall: "connected" as const, testedAt: timestamp, httpStatus: 200, stages: [], availableModelIds: ["model"], availableVoiceIds: ["voice"] },
  createdAt: timestamp, updatedAt: timestamp
};
const globalLexicon = [{
  id: "sql", scope: "global" as const, entryType: "exactTerm" as const, displayText: "SQL", spokenText: "sequel", caseSensitive: true,
  wholeWord: true, priority: 0, enabled: true, notes: "", createdAt: timestamp, updatedAt: timestamp
}];
const persistence = {
  status: vi.fn(), projects: { list: vi.fn(), create: vi.fn(), get: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), delete: vi.fn() },
  settings: { getPacing: vi.fn(), updatePacing: vi.fn() }, preferences: { getIgnoredDiagnostics: vi.fn(), replaceIgnoredDiagnostics: vi.fn() },
  globalLexicon: { list: vi.fn(async () => globalLexicon), replace: vi.fn() }
} as unknown as PersistenceClient;
const connections = {
  list: vi.fn(async () => [profile]), create: vi.fn(), replace: vi.fn(), delete: vi.fn(), test: vi.fn(), exportDiagnostics: vi.fn(),
  getSetupState: vi.fn(async () => ({ activeProfileId: "local", activeProfileLocked: false, onboardingCompletedAt: timestamp, client: "web" as const })),
  setActiveProfile: vi.fn(), completeOnboarding: vi.fn()
};
const voiceCatalog = { get: vi.fn(async () => ({ schemaVersion: 1 as const, modelId: "model", entries: [{ voiceId: "voice", label: "Teacher — voice", enabled: true, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }] })), replace: vi.fn() };

function previewResult(text: string): ScratchpadPreviewResult {
  return {
    schemaVersion: 1, id: crypto.randomUUID(), createdAt: timestamp, connectionProfileId: "local", connectionProfileName: "Local Speaches",
    modelId: "model", voiceId: "voice", speed: 1, originalText: text, readableText: text, transformedText: text.replace("SQL", "sequel"),
    lexiconApplied: true, warnings: [], audio: { mimeType: "audio/wav", base64: "AQID", byteLength: 3 }
  };
}

function renderPage(preview = vi.fn(async (input: { text: string }) => previewResult(input.text))) {
  return render(<MemoryRouter><ConnectionProvider connections={connections as never} voiceCatalog={voiceCatalog as never}><ScratchpadSessionProvider><ScratchpadPage client={{ preview }} persistence={persistence} /></ScratchpadSessionProvider></ConnectionProvider></MemoryRouter>);
}

beforeEach(() => {
  vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:scratchpad"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) { fireEvent.play(this); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { fireEvent.pause(this); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Quick Scratchpad", () => {
  it("defaults from the active profile, previews global transformation, synthesizes, and plays", async () => {
    const user = userEvent.setup();
    const preview = vi.fn(async (input: { text: string }) => previewResult(input.text));
    const { container } = renderPage(preview);
    expect(await screen.findByRole("heading", { name: "Quick Scratchpad" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Connection profile")).toHaveValue("local"));
    expect(screen.getByLabelText("Model ID")).toHaveValue("model");
    expect(screen.getByLabelText("Voice catalog or manual ID")).toHaveValue("voice");
    expect(screen.getByLabelText("Speed")).toHaveAttribute("max", "4");
    expect(screen.getByLabelText("Passage")).toHaveAttribute("maxlength", "1200");
    expect(screen.getByRole("button", { name: "Synthesize passage" })).toBeDisabled();
    await user.type(screen.getByLabelText("Passage"), "SQL indexes can improve database reads.");
    expect(screen.getAllByText("SQL indexes can improve database reads.", { selector: "p" })).toHaveLength(2);
    await user.click(screen.getByLabelText("Apply global lexicon"));
    expect(screen.getByText("sequel indexes can improve database reads.", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Original").parentElement).toHaveTextContent("SQL indexes can improve database reads.");
    await user.click(screen.getByRole("button", { name: "Synthesize passage" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({ text: "SQL indexes can improve database reads.", applyGlobalLexicon: true }), expect.any(AbortSignal)));
    expect(await screen.findByLabelText(/Audio player for Local Speaches/u)).toBeInTheDocument();

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    Object.defineProperty(audio, "duration", { configurable: true, value: 1 });
    fireEvent.loadedMetadata(audio!);
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("status")).toHaveTextContent("Playing");
    fireEvent.ended(audio!);
    expect(screen.getByRole("status")).toHaveTextContent("Playback complete");
  });

  it("preserves every control after failure and retries without appending a failed result", async () => {
    const user = userEvent.setup();
    const preview = vi.fn()
      .mockRejectedValueOnce(new Error("Speaches rejected the selected voice."))
      .mockImplementationOnce(async (input: { text: string }) => previewResult(input.text));
    renderPage(preview);
    await waitFor(() => expect(screen.getByLabelText("Connection profile")).toHaveValue("local"));
    await user.type(screen.getByLabelText("Passage"), "Keep this passage.");
    await user.click(screen.getByRole("button", { name: "Synthesize passage" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Speaches rejected the selected voice.");
    expect(screen.getByLabelText("Passage")).toHaveValue("Keep this passage.");
    expect(screen.getByText("Up to five successful tests remain here until reload or restart.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry synthesis" }));
    expect(await screen.findByLabelText(/Audio player/u)).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(2);
  });
});
