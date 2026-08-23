// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PersistenceClient,
  ScratchpadPreviewResult,
  VoiceCatalog,
} from "@studynarrator/shared-types";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";
import { ScratchpadPage } from "./ScratchpadPage.js";

const timestamp = "2026-08-12T12:00:00.000Z";
const connection = {
  baseUrl: "http://127.0.0.1:8000",
  suppliedUrlForm: "root" as const,
  configured: true,
  defaultModelId: "model",
  defaultVoiceId: "voice",
  timeoutSeconds: 120,
  retryCount: 2,
  responseFormat: "wav" as const,
  lastTestedAt: timestamp,
  lastSuccessfulTestAt: timestamp,
  lastTestSummary: {
    schemaVersion: 1 as const,
    overall: "connected" as const,
    testedAt: timestamp,
    httpStatus: 200,
    stages: [],
    availableModelIds: ["model"],
    availableVoiceIds: ["voice"],
  },
  createdAt: timestamp,
  updatedAt: timestamp,
};
const globalLexicon = [
  {
    id: "sql",
    scope: "global" as const,
    entryType: "exactTerm" as const,
    displayText: "SQL",
    spokenText: "sequel",
    caseSensitive: true,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];
const persistence = {
  status: vi.fn(),
  projects: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    replace: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
  },
  settings: { getPacing: vi.fn(), updatePacing: vi.fn() },
  preferences: {
    getIgnoredDiagnostics: vi.fn(),
    replaceIgnoredDiagnostics: vi.fn(),
  },
  globalLexicon: {
    list: vi.fn(async () => ({
      builtIns: globalLexicon.map((entry) => ({
        ...entry,
        entryKind: "builtIn" as const,
      })),
      custom: [],
    })),
    setBuiltInEnabled: vi.fn(),
    replaceCustom: vi.fn(),
    reimportBuiltIns: vi.fn(),
  },
} as unknown as PersistenceClient;
const connections = {
  get: vi.fn(async () => connection),
  update: vi.fn(),
  test: vi.fn(),
  exportDiagnostics: vi.fn(),
  discoverSpeechCatalog: vi.fn(async () => ({
    schemaVersion: 1 as const,
    models: [
      {
        modelId: "model",
        voices: [
          { voiceId: "voice", name: "Teacher", language: null, gender: null },
        ],
      },
    ],
  })),
  getSetupState: vi.fn(async () => ({
    onboardingCompletedAt: timestamp,
    client: "web" as const,
  })),
  completeOnboarding: vi.fn(),
};
const voiceCatalog = {
  get: vi.fn(async (): Promise<VoiceCatalog> => ({
    schemaVersion: 1,
    modelId: "model",
    entries: [
      {
        voiceId: "voice",
        label: "Teacher — voice",
        enabled: true,
        favorite: false,
        language: null,
        locale: null,
        accent: null,
        category: null,
        style: null,
        sampleText: null,
      },
    ],
  })),
  replace: vi.fn(),
};

function previewResult(text: string): ScratchpadPreviewResult {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    createdAt: timestamp,
    modelId: "model",
    voiceId: "voice",
    voiceLabel: "Teacher — voice",
    speed: 1,
    originalText: text,
    readableText: text,
    transformedText: text.replace("SQL", "sequel"),
    lexiconApplied: true,
    warnings: [],
    cache: {
      key: "a".repeat(64),
      status: "miss",
      byteLength: 3,
      createdAt: timestamp,
      lastUsedAt: timestamp,
    },
    audio: { mimeType: "audio/wav", base64: "AQID", byteLength: 3 },
  };
}

function renderPage(
  preview = vi.fn(async (input: { text: string }) => previewResult(input.text)),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ConnectionProvider
            connectionClient={connections as never}
            voiceCatalog={voiceCatalog as never}
          >
            <ScratchpadPage client={{ preview }} persistence={persistence} />
          </ConnectionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

const sources: Array<{
  buffer: AudioBuffer | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}> = [];

beforeEach(() => {
  sources.length = 0;
  window.sessionStorage.clear();
  connections.discoverSpeechCatalog.mockResolvedValue({
    schemaVersion: 1 as const,
    models: [
      {
        modelId: "model",
        voices: [
          { voiceId: "voice", name: "Teacher", language: null, gender: null },
        ],
      },
    ],
  });
  voiceCatalog.get.mockResolvedValue({
    schemaVersion: 1 as const,
    modelId: "model",
    entries: [
      {
        voiceId: "voice",
        label: "Teacher — voice",
        enabled: true,
        favorite: false,
        language: null,
        locale: null,
        accent: null,
        category: null,
        style: null,
        sampleText: null,
      },
    ],
  });
  vi.stubGlobal("atob", (value: string) =>
    Buffer.from(value, "base64").toString("binary"),
  );
  function FakeAudioContext() {
    return {
      destination: {},
      resume: vi.fn(async () => undefined),
      decodeAudioData: vi.fn(async () => ({}) as AudioBuffer),
      createBufferSource: vi.fn(() => {
        const source = {
          buffer: null as AudioBuffer | null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null as (() => void) | null,
        };
        sources.push(source);
        return source;
      }),
      close: vi.fn(async () => undefined),
    };
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Quick Scratchpad", () => {
  it("defaults from the singleton connection, previews global transformation, synthesizes, and plays", async () => {
    const user = userEvent.setup();
    const preview = vi.fn(async (input: { text: string }) =>
      previewResult(input.text),
    );
    const rendered = renderPage(preview);
    expect(
      await screen.findByRole("heading", { name: "Quick Scratchpad" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Model")).toHaveValue("model"),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Voice")).toHaveValue("voice"),
    );
    expect(screen.getByLabelText("Model")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText("Voice")).toBeInstanceOf(HTMLSelectElement);
    expect(
      screen.getByRole("option", {
        name: "Teacher (voice | Locale unavailable)",
      }),
    ).toHaveValue("voice");
    expect(screen.getByLabelText("Speed")).toHaveAttribute("max", "4");
    expect(screen.getByLabelText("Passage")).toHaveAttribute(
      "maxlength",
      "1200",
    );
    expect(
      screen
        .getByRole("heading", { name: "Voice setup" })
        .compareDocumentPosition(
          screen.getByRole("heading", { name: "Short passage" }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("Recent results")).not.toBeInTheDocument();
    expect(screen.queryByText("Sent to Speaches")).not.toBeInTheDocument();
    expect(screen.queryByText("No audio loaded")).not.toBeInTheDocument();
    expect(screen.queryByText("Active signal")).not.toBeInTheDocument();
    expect(screen.queryByText("Audible proof")).not.toBeInTheDocument();
    const renderButton = screen.getByRole("button", {
      name: "Render and Play",
    });
    expect(renderButton).toBeDisabled();
    expect(
      within(
        screen
          .getByRole("heading", { name: "Short passage" })
          .closest("section")!,
      ).getByRole("button", { name: "Render and Play" }),
    ).toBe(renderButton);
    await user.type(
      screen.getByLabelText("Passage"),
      "SQL indexes can improve database reads.",
    );
    expect(
      window.sessionStorage.getItem("studynarrator.scratchpad.lastPassage"),
    ).toBe("SQL indexes can improve database reads.");
    await user.click(screen.getByLabelText("Apply global lexicon"));
    await user.click(renderButton);
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "SQL indexes can improve database reads.",
          applyGlobalLexicon: true,
        }),
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() => expect(sources[0]?.start).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: "Render and Play" }),
    ).toBeEnabled();
    expect(screen.queryByLabelText(/Audio player/u)).not.toBeInTheDocument();
    expect(document.querySelector("audio")).toBeNull();
    expect(screen.queryByText(/Result · cache/u)).not.toBeInTheDocument();
    rendered.unmount();
    expect(sources[0]?.stop).toHaveBeenCalledOnce();
  });

  it("restores the last passage from session storage after a reload", async () => {
    window.sessionStorage.setItem(
      "studynarrator.scratchpad.lastPassage",
      "Remember this short passage.",
    );
    renderPage();
    expect(await screen.findByLabelText("Passage")).toHaveValue(
      "Remember this short passage.",
    );
  });

  it("groups enabled supported voices with shared friendly labels", async () => {
    connections.discoverSpeechCatalog.mockResolvedValue({
      schemaVersion: 1 as const,
      models: [
        {
          modelId: "model",
          voices: [
            { voiceId: "voice", name: "VOICE", language: null, gender: null },
            {
              voiceId: "favorite",
              name: "FAVORITE",
              language: null,
              gender: null,
            },
            {
              voiceId: "disabled",
              name: "Disabled server voice",
              language: null,
              gender: null,
            },
          ],
        },
      ],
    });
    const groupedCatalog: VoiceCatalog = {
      schemaVersion: 1,
      modelId: "model",
      entries: [
        {
          voiceId: "voice",
          label: "Teacher",
          enabled: true,
          favorite: false,
          language: "English",
          locale: "en-US",
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
        {
          voiceId: "favorite",
          label: "Favorite Voice",
          enabled: true,
          favorite: true,
          language: "English",
          locale: "en-GB",
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
        {
          voiceId: "disabled",
          label: "Disabled Voice",
          enabled: false,
          favorite: false,
          language: "English",
          locale: "en-US",
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
      ],
    };
    voiceCatalog.get.mockResolvedValue(groupedCatalog);
    renderPage();

    const select = await screen.findByLabelText("Voice");
    await waitFor(() => expect(select).toHaveValue("voice"));
    expect(
      [...select.querySelectorAll("optgroup")].map(({ label }) => label),
    ).toEqual(["Favorites", "en-US"]);
    expect(
      screen.getByRole("option", { name: "Favorite Voice (favorite | en-GB)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Teacher (voice | en-US)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Disabled/u }),
    ).not.toBeInTheDocument();
  });

  it("disables catalog selections and explains discovery failures", async () => {
    connections.discoverSpeechCatalog.mockRejectedValue(
      new Error("Model discovery is unavailable."),
    );
    renderPage();
    expect(
      await screen.findByText("Model discovery is unavailable."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeDisabled();
    expect(screen.getByLabelText("Voice")).toBeDisabled();
  });

  it("stops prior playback, preserves every control after failure, and retries with a constant label", async () => {
    const user = userEvent.setup();
    const preview = vi
      .fn()
      .mockImplementationOnce(async (input: { text: string }) =>
        previewResult(input.text),
      )
      .mockRejectedValueOnce(new Error("Speaches rejected the selected voice."))
      .mockImplementationOnce(async (input: { text: string }) =>
        previewResult(input.text),
      );
    renderPage(preview);
    await waitFor(() =>
      expect(screen.getByLabelText("Voice")).toHaveValue("voice"),
    );
    await user.type(screen.getByLabelText("Passage"), "Keep this passage.");
    const renderButton = screen.getByRole("button", {
      name: "Render and Play",
    });
    await user.click(renderButton);
    await waitFor(() => expect(sources[0]?.start).toHaveBeenCalledOnce());
    await user.click(renderButton);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Speaches rejected the selected voice.",
    );
    expect(screen.getByLabelText("Passage")).toHaveValue("Keep this passage.");
    expect(sources[0]?.stop).toHaveBeenCalledOnce();
    expect(renderButton).toHaveTextContent("Render and Play");
    expect(renderButton).toBeEnabled();
    expect(screen.queryByLabelText(/Audio player/u)).not.toBeInTheDocument();
    await user.click(renderButton);
    await waitFor(() => expect(sources[1]?.start).toHaveBeenCalledOnce());
    expect(preview).toHaveBeenCalledTimes(3);
  });
});
