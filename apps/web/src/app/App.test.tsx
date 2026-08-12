// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemClient } from "@studynarrator/shared-types";
import { App } from "./App.js";

const unusedAnalyzer = { analyze: vi.fn() };

afterEach(cleanup);

function renderApp(route: string, client: SystemClient = { diagnostics: vi.fn() }) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App analyzer={unusedAnalyzer} client={client} />
    </MemoryRouter>
  );
}

describe("application routing", () => {
  it.each(["/", "/missing-page"])("redirects %s to Script Lab", async (route) => {
    const diagnostics = vi.fn();
    renderApp(route, { diagnostics });
    expect(await screen.findByRole("heading", { name: "Script Lab" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).getByRole("link", { name: "Script Lab" })).toHaveAttribute("aria-current", "page");
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it("navigates between stable page routes", async () => {
    const user = userEvent.setup();
    renderApp("/script-lab");
    await user.click(screen.getByRole("link", { name: "Runtime diagnostics" }));
    expect(screen.getByRole("heading", { name: "Runtime self-test" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Runtime diagnostics" })).toHaveAttribute("aria-current", "page");
  });
});
