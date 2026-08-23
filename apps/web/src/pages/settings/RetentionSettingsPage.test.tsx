// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  DEFAULT_RETENTION_SETTINGS,
  type PersistenceClient,
  type RetentionSettings,
} from "@studynarrator/shared-types";
import { queryKeys } from "@/app/queryKeys.js";
import { RetentionSettingsPage } from "./RetentionSettingsPage.js";

const loaded: RetentionSettings = {
  ...DEFAULT_RETENTION_SETTINGS,
  updatedAt: "2026-08-22T00:00:00.000Z",
};
const usage = {
  speechCache: { entries: 2, bytes: 10 },
  jobSnapshots: { entries: 1, bytes: 20 },
  renderArtifacts: { entries: 1, bytes: 30 },
};

function clientFixture(overrides: Record<string, unknown> = {}) {
  const retention = {
    get: vi.fn(async () => loaded),
    update: vi.fn(
      async (
        input: Parameters<PersistenceClient["retention"]["update"]>[0],
      ) => ({
        ...input,
        updatedAt: loaded.updatedAt,
      }),
    ),
    usage: vi.fn(async () => usage),
    previewReclaim: vi.fn(async () => ({
      reclaimable: {
        speechCache: { entries: 1, bytes: 5 },
        jobSnapshots: { entries: 1, bytes: 20 },
        renderArtifacts: { entries: 0, bytes: 0 },
      },
      skipped: false,
    })),
    reclaim: vi.fn(async () => ({
      reclaimed: {
        speechCache: { entries: 1, bytes: 5 },
        jobSnapshots: { entries: 1, bytes: 20 },
        renderArtifacts: { entries: 0, bytes: 0 },
      },
      skipped: false,
    })),
    ...overrides,
  };
  return { retention, client: { retention } as unknown as PersistenceClient };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>,
    ),
  };
}

describe("Retention settings", () => {
  it("loads, saves, and reloads the persisted policy", async () => {
    const { client, retention } = clientFixture();
    const view = renderPage(<RetentionSettingsPage client={client} />);

    expect(screen.getByText("Loading retention settings…")).toBeInTheDocument();
    expect(await screen.findByLabelText("Speech cache retention")).toHaveValue(
      "7d",
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Speech cache retention"),
      "24h",
    );
    await userEvent.clear(screen.getByLabelText("Speech cache cap (GiB)"));
    await userEvent.type(screen.getByLabelText("Speech cache cap (GiB)"), "2");
    await userEvent.click(
      screen.getByRole("button", { name: "Save retention settings" }),
    );
    expect(await screen.findByText("Retention settings saved.")).toBeVisible();
    expect(retention.update).toHaveBeenCalledWith({
      speechCacheTtl: "24h",
      jobSnapshotTtl: "never",
      renderArtifactTtl: "never",
      speechCacheSizeCapBytes: 2 * 1_024 ** 3,
    });

    view.unmount();
    retention.get.mockResolvedValueOnce({
      ...loaded,
      speechCacheTtl: "24h",
      speechCacheSizeCapBytes: 2 * 1_024 ** 3,
    });
    renderPage(<RetentionSettingsPage client={client} />);
    expect(await screen.findByLabelText("Speech cache retention")).toHaveValue(
      "24h",
    );
    expect(screen.getByLabelText("Speech cache cap (GiB)")).toHaveValue(2);
  });

  it("loads, reports query errors, and preserves active policy edits during refetch", async () => {
    let resolveInitial!: (settings: RetentionSettings) => void;
    const initial = new Promise<RetentionSettings>((resolve) => {
      resolveInitial = resolve;
    });
    const get = vi
      .fn()
      .mockImplementationOnce(async () => await initial)
      .mockRejectedValueOnce(new Error("Retention storage unavailable"))
      .mockResolvedValueOnce({ ...loaded, speechCacheTtl: "8h" });
    const { client } = clientFixture({ get });
    const { queryClient } = renderPage(
      <RetentionSettingsPage client={client} />,
    );

    expect(screen.getByText("Loading retention settings…")).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledOnce());
    resolveInitial(loaded);
    expect(await screen.findByLabelText("Speech cache retention")).toHaveValue(
      "7d",
    );

    await userEvent.selectOptions(
      screen.getByLabelText("Speech cache retention"),
      "24h",
    );
    await queryClient.invalidateQueries({
      queryKey: queryKeys.persistence.retention(),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Retention storage unavailable",
    );

    await queryClient.invalidateQueries({
      queryKey: queryKeys.persistence.retention(),
    });
    expect(screen.getByLabelText("Speech cache retention")).toHaveValue("24h");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("shows a preview, permits cancel, and reclaims only after confirmation", async () => {
    const { client, retention } = clientFixture();
    renderPage(<RetentionSettingsPage client={client} />);
    await screen.findByText("Retention settings are loaded.");

    await userEvent.click(
      screen.getByRole("button", { name: "Preview reclaim" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Confirm reclaim" }),
    ).toBeVisible();
    expect(retention.reclaim).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Cancel reclaim" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Confirm reclaim" }),
    ).toBeNull();
    expect(retention.reclaim).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Preview reclaim" }),
    );
    await screen.findByRole("dialog", { name: "Confirm reclaim" });
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm reclaim" }),
    );
    expect(await screen.findByText("Reclaimed 25 B.")).toBeVisible();
    expect(retention.reclaim).toHaveBeenCalledWith({ confirm: true });
    expect(retention.usage).toHaveBeenCalledTimes(2);
  });

  it("shows Refresh usage failures in the accessible error state", async () => {
    const { client, retention } = clientFixture({
      usage: vi
        .fn()
        .mockResolvedValueOnce(usage)
        .mockRejectedValueOnce(new Error("Usage unavailable")),
    });
    renderPage(<RetentionSettingsPage client={client} />);
    await screen.findByText("Retention settings are loaded.");

    await userEvent.click(
      screen.getByRole("button", { name: "Refresh usage" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Usage unavailable",
    );
    expect(retention.usage).toHaveBeenCalledTimes(2);
  });

  it("shows retention service failures", async () => {
    const { client } = clientFixture({
      previewReclaim: vi.fn(async () => {
        throw new Error("Maintenance offline");
      }),
    });
    renderPage(<RetentionSettingsPage client={client} />);
    await screen.findByText("Retention settings are loaded.");
    await userEvent.click(
      screen.getByRole("button", { name: "Preview reclaim" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Maintenance offline",
    );
  });
});
