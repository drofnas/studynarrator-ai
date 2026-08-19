// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYSTEM_TIMING } from "@studynarrator/shared-types";
import type {
  PersistenceClient,
  SystemTimingConfiguration,
} from "@studynarrator/shared-types";
import { TimingsSettingsPage } from "./TimingsSettingsPage.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
    render(<TimingsSettingsPage client={client} />);
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
});
