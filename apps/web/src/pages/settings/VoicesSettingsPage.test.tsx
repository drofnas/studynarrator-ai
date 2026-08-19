// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScratchpadClient } from "@studynarrator/shared-types";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";
import { VoicesSettingsPage } from "./VoicesSettingsPage.js";
import {
  connectionClient,
  scratchpadClient,
  scratchpadResult,
} from "./settingsTestFixtures.js";

let audioSource: {
  buffer: AudioBuffer | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
};
let audioContext: {
  destination: object;
  resume: ReturnType<typeof vi.fn>;
  decodeAudioData: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  audioSource = {
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  };
  audioContext = {
    destination: {},
    resume: vi.fn(async () => undefined),
    decodeAudioData: vi.fn(async () => ({}) as AudioBuffer),
    createBufferSource: vi.fn(() => audioSource),
    close: vi.fn(async () => undefined),
  };
  function FakeAudioContext() {
    return audioContext;
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("atob", (value: string) =>
    Buffer.from(value, "base64").toString("binary"),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Voices settings", () => {
  it("uses the saved model, preserves server ordering, and auditions disabled voices without a player", async () => {
    const localVoiceCatalog = {
      get: vi.fn(async (modelId: string) => ({
        schemaVersion: 1 as const,
        modelId,
        entries: [
          {
            voiceId: "voice-b1",
            label: "First — English — voice-b1",
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
            voiceId: "voice-b2",
            label: "Second — English — voice-b2",
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
      })),
      replace: vi.fn(),
    };
    let firstSignal: AbortSignal | undefined;
    const preview = vi.fn<ScratchpadClient["preview"]>((input, signal) => {
      if (input.voiceId === "voice-b1") {
        firstSignal = signal;
        return new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          ),
        );
      }
      return Promise.resolve({
        ...scratchpadResult,
        originalText: input.text,
        readableText: input.text,
        transformedText: input.text,
        voiceId: input.voiceId,
      });
    });
    const idNamedConnection = connectionClient({
      discoverSpeechCatalog: vi.fn(async () => ({
        schemaVersion: 1 as const,
        models: [
          {
            modelId: "model-b",
            voices: [
              {
                voiceId: "voice-b2",
                name: "VOICE-B2",
                language: null,
                gender: null,
              },
              {
                voiceId: "voice-b1",
                name: "voice-b1",
                language: null,
                gender: null,
              },
            ],
          },
        ],
      })),
    });
    render(
      <ConnectionProvider
        connectionClient={idNamedConnection}
        voiceCatalog={localVoiceCatalog}
      >
        <VoicesSettingsPage scratchpadClient={{ preview }} />
      </ConnectionProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Voices" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Address")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Default Voice")).not.toBeInTheDocument();
    expect(await screen.findByText("voice-b2 | en-US")).toBeInTheDocument();
    const secondVoice = screen.getByText("voice-b2 | en-US").closest("article");
    expect(secondVoice).not.toBeNull();
    expect(secondVoice).toHaveAttribute("data-enabled", "false");
    expect(secondVoice).not.toHaveTextContent(/\b(?:enabled|disabled)\b/u);
    expect(screen.getByLabelText("Voice test script")).toHaveValue(
      "This short sample lets you hear how this voice handles clear narration.",
    );
    expect(screen.getByText("Default model")).toBeInTheDocument();
    expect(screen.getByLabelText("en-US voices")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Strict override JSON"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Replace model overrides" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Voice test script"), {
      target: { value: "Hear this exact sample." },
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Test First" }),
    );
    expect(
      screen.getByRole("button", { name: "Preparing First" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Test Second" }));
    expect(firstSignal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", { name: "Playing Second" }),
    ).toBeInTheDocument();
    expect(preview).toHaveBeenLastCalledWith(
      {
        modelId: "model-b",
        voiceId: "voice-b2",
        speed: 1,
        text: "Hear this exact sample.",
        applyGlobalLexicon: false,
      },
      expect.any(AbortSignal),
    );
    expect(document.querySelector("audio")).not.toBeInTheDocument();
    act(() => audioSource.onended?.());
    expect(
      screen.getByRole("button", { name: "Test Second" }),
    ).toBeInTheDocument();
    expect(audioContext.close).toHaveBeenCalled();
  });

  it("searches locales and persists favorites with rollback on failure", async () => {
    let stored = {
      schemaVersion: 1 as const,
      modelId: "model-b",
      entries: [
        {
          voiceId: "voice-b1",
          label: "Catalog First",
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
          voiceId: "voice-b2",
          label: "Catalog Second",
          enabled: false,
          favorite: true,
          language: "English",
          locale: "en-US",
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
        {
          voiceId: "voice-local",
          label: "Local Only — British English — voice-local",
          enabled: true,
          favorite: false,
          language: "British English",
          locale: "en-GB",
          accent: null,
          category: null,
          style: null,
          sampleText: null,
        },
      ],
    };
    const replace = vi.fn(async (input: typeof stored) => {
      stored = structuredClone(input);
      return structuredClone(stored);
    });
    const localVoiceCatalog = {
      get: vi.fn(async () => structuredClone(stored)),
      replace,
    };
    render(
      <ConnectionProvider
        connectionClient={connectionClient()}
        voiceCatalog={localVoiceCatalog}
      >
        <VoicesSettingsPage scratchpadClient={scratchpadClient} />
      </ConnectionProvider>,
    );

    const favorites = await screen.findByLabelText("Favorites voices");
    expect(within(favorites).getByText("Second")).toBeInTheDocument();
    expect(screen.getByLabelText("en-GB voices")).toHaveTextContent(
      "Local Only",
    );
    expect(screen.getByLabelText("en-US voices")).toHaveTextContent("First");
    expect(
      screen.getByRole("button", { name: "Remove Second from favorites" }),
    ).toBeEnabled();
    expect(
      [...document.querySelectorAll("section[aria-label$=' voices']")].map(
        (element) => element.getAttribute("aria-label"),
      ),
    ).toEqual(["Favorites voices", "en-US voices", "en-GB voices"]);

    fireEvent.change(screen.getByLabelText("Search voice catalog"), {
      target: { value: "en-US" },
    });
    expect(screen.queryByLabelText("en-GB voices")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Favorites voices")).toHaveTextContent(
      "Second",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add First to favorites" }),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    expect(
      replace.mock.calls[0]?.[0].entries.find(
        ({ voiceId }) => voiceId === "voice-b1",
      )?.favorite,
    ).toBe(true);
    expect(
      within(screen.getByLabelText("Favorites voices")).getByText("First"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove First from favorites" }),
    ).toHaveAttribute("aria-pressed", "true");

    replace.mockRejectedValueOnce(new Error("Catalog storage unavailable"));
    await userEvent.click(
      screen.getByRole("button", { name: "Remove First from favorites" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Favorite not saved: Catalog storage unavailable",
    );
    expect(
      screen.getByRole("button", { name: "Remove First from favorites" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("returns an audition button to normal and reports decoding failures", async () => {
    audioContext.decodeAudioData.mockRejectedValue(
      new Error("Unsupported WAV data"),
    );
    const localVoiceCatalog = {
      get: vi.fn(async (modelId: string) => ({
        schemaVersion: 1 as const,
        modelId,
        entries: [
          {
            voiceId: "voice-b2",
            label: "Second voice",
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
    render(
      <ConnectionProvider
        connectionClient={connectionClient()}
        voiceCatalog={localVoiceCatalog}
      >
        <VoicesSettingsPage scratchpadClient={scratchpadClient} />
      </ConnectionProvider>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Test Second" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Voice test failed: Unsupported WAV data",
    );
    expect(
      screen.getByRole("button", { name: "Test Second" }),
    ).toBeInTheDocument();
  });

  it("disables invalid auditions and aborts pending synthesis on unmount", async () => {
    let pendingSignal: AbortSignal | undefined;
    const preview = vi.fn<ScratchpadClient["preview"]>((_input, signal) => {
      pendingSignal = signal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Cancelled", "AbortError")),
        ),
      );
    });
    const localVoiceCatalog = {
      get: vi.fn(async (modelId: string) => ({
        schemaVersion: 1 as const,
        modelId,
        entries: [
          {
            voiceId: "voice-b2",
            label: "Second voice",
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
    const view = render(
      <ConnectionProvider
        connectionClient={connectionClient()}
        voiceCatalog={localVoiceCatalog}
      >
        <VoicesSettingsPage scratchpadClient={{ preview }} />
      </ConnectionProvider>,
    );
    const button = await screen.findByRole("button", { name: "Test Second" });
    fireEvent.change(screen.getByLabelText("Voice test script"), {
      target: { value: "" },
    });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Voice test script"), {
      target: { value: "Ready sample" },
    });
    await userEvent.click(button);
    expect(pendingSignal?.aborted).toBe(false);
    view.unmount();
    expect(pendingSignal?.aborted).toBe(true);
    expect(audioContext.close).toHaveBeenCalled();
  });
});
