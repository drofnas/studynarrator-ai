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
const connection = {
  baseUrl: "http://127.0.0.1:8000", suppliedUrlForm: "root" as const, configured: true, defaultModelId: "model", defaultVoiceId: "voice",
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
  get: vi.fn(async () => connection), update: vi.fn(), test: vi.fn(), exportDiagnostics: vi.fn(),
  discoverSpeechCatalog: vi.fn(async () => ({ schemaVersion: 1 as const, models: [{ modelId: "model", voices: [{ voiceId: "voice", name: "Teacher", language: null, gender: null }] }] })),
  getSetupState: vi.fn(async () => ({ onboardingCompletedAt: timestamp, client: "web" as const })),
  completeOnboarding: vi.fn()
};
const voiceCatalog = { get: vi.fn(async () => ({ schemaVersion: 1 as const, modelId: "model", entries: [{ voiceId: "voice", label: "Teacher — voice", enabled: true, favorite: false, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }] })), replace: vi.fn() };

function previewResult(text: string): ScratchpadPreviewResult {
  return {
    schemaVersion: 3, id: crypto.randomUUID(), createdAt: timestamp,
    modelId: "model", voiceId: "voice", voiceLabel: "Teacher — voice", speed: 1, originalText: text, readableText: text, transformedText: text.replace("SQL", "sequel"),
    lexiconApplied: true, warnings: [],
    cache: { key: "a".repeat(64), status: "miss", byteLength: 3, createdAt: timestamp, lastUsedAt: timestamp },
    audio: { mimeType: "audio/wav", base64: "AQID", byteLength: 3 }
  };
}

function renderPage(preview = vi.fn(async (input: { text: string }) => previewResult(input.text))) {
  return render(<MemoryRouter><ConnectionProvider connectionClient={connections as never} voiceCatalog={voiceCatalog as never}><ScratchpadSessionProvider><ScratchpadPage client={{ preview }} persistence={persistence} /></ScratchpadSessionProvider></ConnectionProvider></MemoryRouter>);
}

beforeEach(() => {
  window.sessionStorage.clear();
  connections.discoverSpeechCatalog.mockResolvedValue({ schemaVersion: 1 as const, models: [{ modelId: "model", voices: [{ voiceId: "voice", name: "Teacher", language: null, gender: null }] }] });
  voiceCatalog.get.mockResolvedValue({ schemaVersion: 1 as const, modelId: "model", entries: [{ voiceId: "voice", label: "Teacher — voice", enabled: true, favorite: false, language: null, locale: null, accent: null, category: null, style: null, sampleText: null }] });
  vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:scratchpad");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) { fireEvent.play(this); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { fireEvent.pause(this); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Quick Scratchpad", () => {
  it("defaults from the singleton connection, previews global transformation, synthesizes, and plays", async () => {
    const user = userEvent.setup();
    const preview = vi.fn(async (input: { text: string }) => previewResult(input.text));
    const { container } = renderPage(preview);
    expect(await screen.findByRole("heading", { name: "Quick Scratchpad" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Connection profile")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("model"));
    await waitFor(() => expect(screen.getByLabelText("Voice")).toHaveValue("voice"));
    expect(screen.getByLabelText("Model")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText("Voice")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByRole("option", { name: "Teacher — voice" })).toHaveValue("voice");
    expect(screen.getByLabelText("Speed")).toHaveAttribute("max", "4");
    expect(screen.getByLabelText("Passage")).toHaveAttribute("maxlength", "1200");
    expect(screen.getByRole("heading", { name: "Voice setup" }).compareDocumentPosition(screen.getByRole("heading", { name: "Short passage" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Recent results")).not.toBeInTheDocument();
    expect(screen.queryByText("Sent to Speaches")).not.toBeInTheDocument();
    expect(screen.queryByText("No audio loaded")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Synthesize passage" })).toBeDisabled();
    await user.type(screen.getByLabelText("Passage"), "SQL indexes can improve database reads.");
    expect(window.sessionStorage.getItem("studynarrator.scratchpad.lastPassage")).toBe("SQL indexes can improve database reads.");
    await user.click(screen.getByLabelText("Apply global lexicon"));
    await user.click(screen.getByRole("button", { name: "Synthesize passage" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({ text: "SQL indexes can improve database reads.", applyGlobalLexicon: true }), expect.any(AbortSignal)));
    expect(await screen.findByLabelText(/Audio player for Teacher/u)).toBeInTheDocument();
    expect(screen.queryByText(/Result · cache/u)).not.toBeInTheDocument();

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    Object.defineProperty(audio, "duration", { configurable: true, value: 1 });
    fireEvent.loadedMetadata(audio!);
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("status")).toHaveTextContent("Playing");
    fireEvent.ended(audio!);
    expect(screen.getByRole("status")).toHaveTextContent("Playback complete");
  });

  it("restores the last passage from session storage after a reload", async () => {
    window.sessionStorage.setItem("studynarrator.scratchpad.lastPassage", "Remember this short passage.");
    renderPage();
    expect(await screen.findByLabelText("Passage")).toHaveValue("Remember this short passage.");
  });

  it("disables catalog selections and explains discovery failures", async () => {
    connections.discoverSpeechCatalog.mockRejectedValue(new Error("Model discovery is unavailable."));
    renderPage();
    expect(await screen.findByText("Model discovery is unavailable.")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeDisabled();
    expect(screen.getByLabelText("Voice")).toBeDisabled();
  });

  it("preserves every control and the last player after a failed replacement, then retries", async () => {
    const user = userEvent.setup();
    const preview = vi.fn()
      .mockImplementationOnce(async (input: { text: string }) => previewResult(input.text))
      .mockRejectedValueOnce(new Error("Speaches rejected the selected voice."))
      .mockImplementationOnce(async (input: { text: string }) => previewResult(input.text));
    renderPage(preview);
    await waitFor(() => expect(screen.getByLabelText("Voice")).toHaveValue("voice"));
    await user.type(screen.getByLabelText("Passage"), "Keep this passage.");
    await user.click(screen.getByRole("button", { name: "Synthesize passage" }));
    const player = await screen.findByLabelText(/Audio player/u);
    await user.click(screen.getByRole("button", { name: "Synthesize passage" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Speaches rejected the selected voice.");
    expect(screen.getByLabelText("Passage")).toHaveValue("Keep this passage.");
    expect(screen.getByLabelText(/Audio player/u)).toBe(player);
    await user.click(screen.getByRole("button", { name: "Retry synthesis" }));
    expect(await screen.findByLabelText(/Audio player/u)).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(3);
  });
});
