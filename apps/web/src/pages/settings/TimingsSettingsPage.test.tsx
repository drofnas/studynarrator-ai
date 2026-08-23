// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DEFAULT_SYSTEM_TIMING } from "@studynarrator/shared-types";
import type {
  PersistenceClient,
  SystemTimingConfiguration,
} from "@studynarrator/shared-types";
import { queryKeys } from "@/app/queryKeys.js";
import { TimingsSettingsPage } from "./TimingsSettingsPage.js";

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

describe("Timings settings", () => {
  it("offers only named transition pauses and saves them without touching projects", async () => {
    const loaded = {
      ...DEFAULT_SYSTEM_TIMING,
      transitionPauses: {
        paragraph: { mode: "duration", durationMs: 600 },
        speakerChange: { mode: "none" },
        section: { mode: "preset", pauseId: "pause_long" },
      },
    } satisfies SystemTimingConfiguration;
    const updatePacing = vi.fn(
      async (input: SystemTimingConfiguration) => input,
    );
    const replaceProject = vi.fn();
    const client = {
      settings: { getPacing: vi.fn(async () => loaded), updatePacing },
      projects: { replace: replaceProject },
    } as unknown as PersistenceClient;
    renderPage(<TimingsSettingsPage client={client} />);
    const input = await screen.findByLabelText("pause_medium duration");
    expect(
      screen.getByRole("heading", { name: "Timings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("pause_short");
    expect(screen.getByRole("table")).toHaveTextContent("pause_long");
    for (const label of ["Paragraph", "Speaker change", "Section"]) {
      const group = within(screen.getByRole("group", { name: label }));
      expect(group.getAllByRole("combobox")).toHaveLength(1);
      expect(
        group.getAllByRole("option").map((option) => option.textContent),
      ).toEqual(["None", "pause_short", "pause_medium", "pause_long"]);
    }
    expect(
      within(screen.getByRole("group", { name: "Paragraph" })).getByLabelText(
        "Pause",
      ),
    ).toHaveValue("pause_medium");
    expect(screen.queryByText("Direct duration")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Duration", { exact: true }),
    ).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "1.5 s" } });
    await userEvent.selectOptions(
      within(
        screen.getByRole("group", { name: "Speaker change" }),
      ).getByLabelText("Pause"),
      "pause_short",
    );
    await userEvent.selectOptions(
      within(screen.getByRole("group", { name: "Section" })).getByLabelText(
        "Pause",
      ),
      "none",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save timing" }));
    expect(await screen.findByText("Global timing saved.")).toBeInTheDocument();
    const saved = updatePacing.mock.calls[0]?.[0];
    expect(
      saved?.pausePresets.find(({ pauseId }) => pauseId === "pause_medium")
        ?.durationMs,
    ).toBe(1_500);
    expect(saved?.transitionPauses).toEqual({
      paragraph: { mode: "preset", pauseId: "pause_medium" },
      speakerChange: { mode: "preset", pauseId: "pause_short" },
      section: { mode: "none" },
    });
    expect(replaceProject).not.toHaveBeenCalled();
  });

  it("loads, reports query errors, and preserves active edits during refetch", async () => {
    let resolveInitial!: (timing: SystemTimingConfiguration) => void;
    const initial = new Promise<SystemTimingConfiguration>((resolve) => {
      resolveInitial = resolve;
    });
    const reloaded = {
      ...DEFAULT_SYSTEM_TIMING,
      pausePresets: [
        DEFAULT_SYSTEM_TIMING.pausePresets[0],
        {
          ...DEFAULT_SYSTEM_TIMING.pausePresets[1],
          description: "Reloaded medium pause",
        },
        DEFAULT_SYSTEM_TIMING.pausePresets[2],
      ],
    } satisfies SystemTimingConfiguration;
    const getPacing = vi
      .fn()
      .mockImplementationOnce(async () => await initial)
      .mockRejectedValueOnce(new Error("Timing storage unavailable"))
      .mockResolvedValueOnce(reloaded);
    const client = {
      settings: { getPacing, updatePacing: vi.fn() },
    } as unknown as PersistenceClient;
    const { queryClient } = renderPage(<TimingsSettingsPage client={client} />);

    expect(screen.getByText("Loading timing settings…")).toBeInTheDocument();
    await waitFor(() => expect(getPacing).toHaveBeenCalledOnce());
    resolveInitial(DEFAULT_SYSTEM_TIMING);
    expect(
      await screen.findByText(
        "Timing settings apply to every editable project.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("pause_medium duration"), {
      target: { value: "1.25 s" },
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.persistence.timing(),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Timing storage unavailable",
    );

    await queryClient.invalidateQueries({
      queryKey: queryKeys.persistence.timing(),
    });
    expect(screen.getByLabelText("pause_medium duration")).toHaveValue(
      "1.25 s",
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
