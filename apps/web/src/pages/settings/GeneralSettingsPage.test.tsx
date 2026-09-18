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
import type { SpeechCacheStatus } from "@studynarrator/shared-types";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";
import { GeneralSettingsPage } from "./GeneralSettingsPage.js";
import {
  cacheClient,
  connectionClient,
  connectionWithTest,
  savedConnection,
  voiceCatalog,
} from "./settingsTestFixtures.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe("General settings", () => {
  it("shows connection diagnostics only for an actual connection error", async () => {
    const connected = renderPage(
      <ConnectionProvider
        connectionClient={connectionClient({
          get: vi.fn(async () => connectionWithTest("connected")),
        })}
        voiceCatalog={voiceCatalog}
      >
        <GeneralSettingsPage cacheClient={cacheClient} />
      </ConnectionProvider>,
    );
    await screen.findByDisplayValue(savedConnection.baseUrl);
    expect(
      screen.getByRole("heading", { name: "General" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export redacted JSON" }),
    ).not.toBeInTheDocument();
    connected.unmount();

    const failed = renderPage(
      <ConnectionProvider
        connectionClient={connectionClient({
          get: vi.fn(async () => connectionWithTest("disconnected")),
        })}
        voiceCatalog={voiceCatalog}
      >
        <GeneralSettingsPage cacheClient={cacheClient} />
      </ConnectionProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "disconnected" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export redacted JSON" }),
    ).toBeInTheDocument();
    failed.unmount();

    renderPage(
      <ConnectionProvider
        connectionClient={connectionClient({
          get: vi.fn(async () =>
            connectionWithTest("configurationError", false),
          ),
        })}
        voiceCatalog={voiceCatalog}
      >
        <GeneralSettingsPage cacheClient={cacheClient} />
      </ConnectionProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Address")).toHaveValue(""),
    );
  });

  it("shows session cache statistics and confirms clear-all", async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce({
        contractVersion: 1,
        entryCount: 2,
        totalBytes: 2048,
        lastUsedAt: "2026-08-12T12:00:00.000Z",
        sessionHits: 3,
        sessionMisses: 2,
        sessionWrites: 2,
        sessionCorruptMisses: 1,
        inFlight: 0,
        projectRenders: { totalBytes: 4096, reclaimableBytes: 1024 },
      })
      .mockResolvedValueOnce({
        contractVersion: 1,
        entryCount: 0,
        totalBytes: 0,
        lastUsedAt: null,
        sessionHits: 3,
        sessionMisses: 2,
        sessionWrites: 2,
        sessionCorruptMisses: 1,
        inFlight: 0,
        projectRenders: { totalBytes: 4096, reclaimableBytes: 1024 },
      });
    const clearAll = vi.fn(async () => ({
      contractVersion: 1 as const,
      entriesRemoved: 2,
      bytesFreed: 2048,
      renderedProjectClips: { entriesRemoved: 0, bytesFreed: 0 },
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage(
      <ConnectionProvider
        connectionClient={connectionClient()}
        voiceCatalog={voiceCatalog}
      >
        <GeneralSettingsPage
          cacheClient={{
            status,
            clearAll,
            clearProject: vi.fn(),
            clearEntry: vi.fn(),
          }}
        />
      </ConnectionProvider>,
    );
    expect(await screen.findByText("2 entries")).toBeInTheDocument();
    expect(screen.getByText("3 hits · 2 misses")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear all cached speech" }),
    );
    expect(clearAll).toHaveBeenCalledWith({
      includeRenderedProjectClips: false,
    });
    expect(
      await screen.findByText(/Cleared 2 cached speech entries/u),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear all cached speech" }),
    ).toBeDisabled();
    expect(screen.getByText("4.0 KiB stored")).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Cached speech: 2.0 KiB."),
    );
  });

  it("clears only confirmed eligible audio and reports total bytes once", async () => {
    const initial = {
      ...(await cacheClient.status()),
      entryCount: 1,
      totalBytes: 512,
      projectRenders: { totalBytes: 4096, reclaimableBytes: 1024 },
    };
    const status = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue({
        ...initial,
        entryCount: 0,
        totalBytes: 0,
        projectRenders: { totalBytes: 3072, reclaimableBytes: 0 },
      });
    const clearAll = vi.fn(async () => ({
      contractVersion: 1 as const,
      entriesRemoved: 1,
      bytesFreed: 1536,
      renderedProjectClips: { entriesRemoved: 1, bytesFreed: 1024 },
    }));
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    renderPage(
      <ConnectionProvider
        connectionClient={connectionClient()}
        voiceCatalog={voiceCatalog}
      >
        <GeneralSettingsPage
          cacheClient={{
            status,
            clearAll,
            clearProject: vi.fn(),
            clearEntry: vi.fn(),
          }}
        />
      </ConnectionProvider>,
    );
    await screen.findByText("4.0 KiB stored");
    const checkbox = await screen.findByRole("checkbox", {
      name: "Include Rendered Project Clips",
    });
    expect(checkbox).not.toBeChecked();
    const clearButton = screen.getByRole("button", {
      name: "Clear all cached speech",
    });
    expect(clearButton).toBeEnabled();
    await userEvent.click(checkbox);
    expect(clearAll).not.toHaveBeenCalled();
    await userEvent.click(clearButton);
    expect(clearAll).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Eligible project audio: 1.0 KiB."),
    );
    await userEvent.click(clearButton);
    expect(clearAll).toHaveBeenCalledWith({
      includeRenderedProjectClips: true,
    });
    expect(
      await screen.findByText(
        "Cleared 1 cached speech entry and audio for 1 project render (1.0 KiB). Freed 1.5 KiB total. Projects and render history were preserved.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText("3.0 KiB stored")).toBeInTheDocument();
    expect(screen.getByText("0 B reclaimable")).toBeInTheDocument();
  });

  it("distinguishes loading, zero, unavailable and failed refresh without leaking errors", async () => {
    let resolveStatus!: (value: SpeechCacheStatus) => void;
    const pending = new Promise<SpeechCacheStatus>((resolve) => {
      resolveStatus = resolve;
    });
    const empty = {
      ...(await cacheClient.status()),
      projectRenders: { totalBytes: 0, reclaimableBytes: 0 },
    };
    const status = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockRejectedValueOnce(new Error("sentinel-secret-storage-endpoint"))
      .mockResolvedValueOnce({ ...empty, projectRenders: null })
      .mockResolvedValue(empty);
    renderPage(
      <ConnectionProvider
        connectionClient={connectionClient()}
        voiceCatalog={voiceCatalog}
      >
        <GeneralSettingsPage cacheClient={{ ...cacheClient, status }} />
      </ConnectionProvider>,
    );
    const card = within(
      screen.getByRole("article", { name: "Product Renders" }),
    );
    expect(card.getByText("Loading render storage…")).toBeInTheDocument();
    resolveStatus(empty);
    expect(await card.findByText("0 B stored")).toBeInTheDocument();
    const refresh = screen.getByRole("button", {
      name: "Refresh",
    });
    await userEvent.click(refresh);
    expect(await card.findByText("Storage unavailable")).toBeInTheDocument();
    expect(card.queryByText("0 B stored")).not.toBeInTheDocument();
    expect(screen.queryByText(/sentinel-secret/u)).not.toBeInTheDocument();
    expect(
      screen.getByText("Cache statistics unavailable. Try Refresh."),
    ).toBeInTheDocument();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.click(
      screen.getByLabelText("Include Rendered Project Clips"),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Clear all cached speech" }),
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining(
        "Cached speech size unavailable. Project audio size unavailable.",
      ),
    );
    await userEvent.click(refresh);
    expect(await screen.findByText("0 entries")).toBeInTheDocument();
    expect(card.getByText("Storage unavailable")).toBeInTheDocument();
    await userEvent.click(refresh);
    expect(await card.findByText("0 B reclaimable")).toBeInTheDocument();
    expect(
      screen.queryByText("Cache statistics unavailable. Try Refresh."),
    ).not.toBeInTheDocument();
  });

  it("shows recovery state instead of empty fields until the saved connection returns", async () => {
    let resolveConnection!: (value: typeof savedConnection) => void;
    const recovered = new Promise<typeof savedConnection>((resolve) => {
      resolveConnection = resolve;
    });
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection service restarted."))
      .mockImplementationOnce(async () => await recovered);
    renderPage(
      <ConnectionProvider
        connectionClient={connectionClient({ get })}
        voiceCatalog={voiceCatalog}
      >
        <GeneralSettingsPage cacheClient={cacheClient} />
      </ConnectionProvider>,
    );

    expect(
      await screen.findByRole("status", {
        name: "Restoring connection settings",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Address")).not.toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    resolveConnection(savedConnection);
    expect(
      await screen.findByDisplayValue(savedConnection.baseUrl),
    ).toBeInTheDocument();
    expect(
      await screen.findByDisplayValue(savedConnection.defaultModelId),
    ).toHaveValue(savedConnection.defaultModelId);
    expect(screen.getByLabelText("Default Voice")).toHaveValue(
      savedConnection.defaultVoiceId,
    );
    expect(screen.getByLabelText("Timeout (seconds)")).toHaveValue(
      savedConnection.timeoutSeconds,
    );
    expect(screen.getByLabelText("Retries")).toHaveValue(
      savedConnection.retryCount,
    );
  });
});
