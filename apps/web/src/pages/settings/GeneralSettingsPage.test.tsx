// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  it("shows the Signal path only for an actual connection error", async () => {
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
    expect(screen.queryByText("Signal path")).not.toBeInTheDocument();
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
    expect(await screen.findByText("Signal path")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "disconnected" }),
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
    expect(screen.queryByText("Signal path")).not.toBeInTheDocument();
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
      });
    const clearAll = vi.fn(async () => ({
      contractVersion: 1 as const,
      entriesRemoved: 2,
      bytesFreed: 2048,
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
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
  });

  it("includes rendered clips only when explicitly selected", async () => {
    const clearAll = vi.fn(async () => ({
      contractVersion: 1 as const,
      entriesRemoved: 0,
      bytesFreed: 0,
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage(
      <ConnectionProvider
        connectionClient={connectionClient()}
        voiceCatalog={voiceCatalog}
      >
        <GeneralSettingsPage
          cacheClient={{
            status: vi.fn(async () => ({
              contractVersion: 1 as const,
              entryCount: 0,
              totalBytes: 0,
              lastUsedAt: null,
              sessionHits: 0,
              sessionMisses: 0,
              sessionWrites: 0,
              sessionCorruptMisses: 0,
              inFlight: 0,
            })),
            clearAll,
            clearProject: vi.fn(),
            clearEntry: vi.fn(),
          }}
        />
      </ConnectionProvider>,
    );
    const checkbox = await screen.findByRole("checkbox", {
      name: "Include Rendered Project Clips",
    });
    expect(checkbox).not.toBeChecked();
    const clearButton = screen.getByRole("button", {
      name: "Clear all cached speech",
    });
    const cacheControls = checkbox.parentElement?.parentElement;
    expect(cacheControls).not.toBeNull();
    expect(Array.from(cacheControls?.children ?? [])).toEqual([
      checkbox.parentElement,
      clearButton,
    ]);
    expect(clearButton).toBeDisabled();
    await userEvent.click(checkbox);
    await userEvent.click(clearButton);
    expect(clearAll).toHaveBeenCalledWith({
      includeRenderedProjectClips: true,
    });
    expect(
      await screen.findByText(/removed rendered project clips/u),
    ).toBeInTheDocument();
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
