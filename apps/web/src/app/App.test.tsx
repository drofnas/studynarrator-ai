// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistenceClient, SystemClient } from "@studynarrator/shared-types";
import { App } from "./App.js";

const unusedAnalyzer = { analyze: vi.fn() };
const unusedPersistence: PersistenceClient = {
  status: vi.fn(),
  projects: { list: vi.fn(), create: vi.fn(), get: vi.fn(), replace: vi.fn(), duplicate: vi.fn(), delete: vi.fn() },
  settings: { getPacing: vi.fn(), updatePacing: vi.fn() },
  preferences: { getIgnoredDiagnostics: vi.fn(), replaceIgnoredDiagnostics: vi.fn() },
  globalLexicon: { list: vi.fn(), replace: vi.fn() },
  connectionProfiles: { list: vi.fn(), create: vi.fn(), replace: vi.fn(), delete: vi.fn() }
};

afterEach(cleanup);

function renderApp(route: string, client: SystemClient = { diagnostics: vi.fn() }) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App analyzer={unusedAnalyzer} client={client} persistence={unusedPersistence} />
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

  it("exposes the dedicated persistence route without changing Script Lab", async () => {
    const user = userEvent.setup();
    renderApp("/script-lab");
    await user.click(screen.getByRole("link", { name: "Persistence Lab" }));
    expect(screen.getByRole("heading", { name: "Persistence Lab" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Persistence Lab" })).toHaveAttribute("aria-current", "page");
  });
});
