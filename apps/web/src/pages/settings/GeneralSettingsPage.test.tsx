// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";
import { GeneralSettingsPage } from "./GeneralSettingsPage.js";
import { cacheClient, connectionClient, connectionWithTest, savedConnection, voiceCatalog } from "./settingsTestFixtures.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("General settings", () => {
  it("shows the Signal path only for an actual connection error", async () => {
    const connected = render(<ConnectionProvider connectionClient={connectionClient({ get: vi.fn(async () => connectionWithTest("connected")) })} voiceCatalog={voiceCatalog}><GeneralSettingsPage cacheClient={cacheClient} /></ConnectionProvider>);
    await screen.findByDisplayValue(savedConnection.baseUrl);
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.queryByText("Signal path")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export redacted JSON" })).not.toBeInTheDocument();
    connected.unmount();

    const failed = render(<ConnectionProvider connectionClient={connectionClient({ get: vi.fn(async () => connectionWithTest("disconnected")) })} voiceCatalog={voiceCatalog}><GeneralSettingsPage cacheClient={cacheClient} /></ConnectionProvider>);
    expect(await screen.findByText("Signal path")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "disconnected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export redacted JSON" })).toBeInTheDocument();
    failed.unmount();

    render(<ConnectionProvider connectionClient={connectionClient({ get: vi.fn(async () => connectionWithTest("configurationError", false)) })} voiceCatalog={voiceCatalog}><GeneralSettingsPage cacheClient={cacheClient} /></ConnectionProvider>);
    await waitFor(() => expect(screen.getByLabelText("Address")).toHaveValue(""));
    expect(screen.queryByText("Signal path")).not.toBeInTheDocument();
  });

  it("shows session cache statistics and confirms clear-all", async () => {
    const status = vi.fn()
      .mockResolvedValueOnce({ contractVersion: 1, entryCount: 2, totalBytes: 2048, lastUsedAt: "2026-08-12T12:00:00.000Z", sessionHits: 3, sessionMisses: 2, sessionWrites: 2, sessionCorruptMisses: 1, inFlight: 0 })
      .mockResolvedValueOnce({ contractVersion: 1, entryCount: 0, totalBytes: 0, lastUsedAt: null, sessionHits: 3, sessionMisses: 2, sessionWrites: 2, sessionCorruptMisses: 1, inFlight: 0 });
    const clearAll = vi.fn(async () => ({ contractVersion: 1 as const, entriesRemoved: 2, bytesFreed: 2048 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ConnectionProvider connectionClient={connectionClient()} voiceCatalog={voiceCatalog}><GeneralSettingsPage cacheClient={{ status, clearAll, clearProject: vi.fn(), clearEntry: vi.fn() }} /></ConnectionProvider>);
    expect(await screen.findByText("2 entries")).toBeInTheDocument();
    expect(screen.getByText("3 hits · 2 misses")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear all cached speech" }));
    expect(clearAll).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Cleared 2 cached speech entries/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all cached speech" })).toBeDisabled();
  });
});
