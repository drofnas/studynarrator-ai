// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistenceClient } from "@studynarrator/shared-types";
import { SettingsPage } from "./SettingsPage.js";

afterEach(cleanup);

describe("G05 System Settings", () => {
  it("normalizes and saves new-project pacing without touching projects", async () => {
    const updatePacing = vi.fn(async (input: { enabled: boolean; durationMs: number }) => input);
    const replaceProject = vi.fn();
    const client = {
      settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing },
      projects: { replace: replaceProject }
    } as unknown as PersistenceClient;
    render(<SettingsPage client={client} />);
    const input = await screen.findByLabelText(/Default pause_medium duration/u);
    fireEvent.change(input, { target: { value: "1.5 s" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pacing defaults" }));
    expect(await screen.findByText("Pacing defaults saved. Existing projects were not changed.")).toBeInTheDocument();
    expect(updatePacing).toHaveBeenCalledWith({ enabled: true, durationMs: 1_500 });
    expect(replaceProject).not.toHaveBeenCalled();
  });
});
