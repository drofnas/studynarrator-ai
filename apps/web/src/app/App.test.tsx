// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemClient, SystemDiagnostics } from "@studynarrator/shared-types";
import { App } from "./App.js";

const unusedParser = { parse: vi.fn() };

afterEach(cleanup);

const passingDiagnostics: SystemDiagnostics = {
  schemaVersion: 1,
  overall: "pass",
  client: "web",
  transport: "rest",
  runtime: {
    schemaVersion: 1,
    applicationVersion: "0.1.0",
    runtimeName: "node",
    runtimeVersion: "26.7.0",
    electronVersion: null,
    platform: "darwin",
    architecture: "arm64",
    dataDirectory: "/tmp/g01/web"
  },
  checks: {
    sharedCore: { status: "pass", marker: "study-narrator-g01" },
    storage: {
      status: "pass",
      driver: "better-sqlite3",
      sqliteVersion: "3.50.0",
      migrationVersion: 1,
      databasePath: "/tmp/g01/web/studynarrator.sqlite",
      markerKey: "g01.runtime-self-test",
      markerValue: "study-narrator-g01",
      createdAt: "2026-08-11T12:00:00.000Z"
    },
    ffmpeg: { status: "pass", executable: "ffmpeg", version: "ffmpeg version 8.1.2" }
  }
};

function renderApp(route: string, client: SystemClient = { diagnostics: vi.fn() }) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App client={client} parser={unusedParser} />
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

describe("G01 status screen", () => {
  it("shows a disabled checking state while diagnostics are in flight", async () => {
    const user = userEvent.setup();
    let finish: ((value: SystemDiagnostics) => void) | undefined;
    const pending = new Promise<SystemDiagnostics>((resolve) => { finish = resolve; });
    renderApp("/diagnostics", { diagnostics: async () => await pending });

    await user.click(screen.getByRole("button", { name: "Run self-test" }));
    expect(screen.getByRole("button", { name: "Checking signal…" })).toBeDisabled();
    expect(screen.getAllByText("CHECKING")).toHaveLength(3);
    finish?.(passingDiagnostics);
    expect(await screen.findByRole("button", { name: "Run again" })).toBeEnabled();
  });

  it("shows the idle state then all required Web/REST pass lines", async () => {
    const user = userEvent.setup();
    const diagnostics = vi.fn(async () => passingDiagnostics);
    renderApp("/diagnostics", { diagnostics });

    expect(screen.getAllByText("NOT RUN")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Run self-test" }));
    expect(await screen.findByText("REST")).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getAllByText("PASS")).toHaveLength(3);
    expect(screen.getByText(/study-narrator-g01/u)).toBeInTheDocument();
  });

  it("renders Electron/IPC metadata from the same contract", async () => {
    const user = userEvent.setup();
    renderApp("/diagnostics", { diagnostics: async () => ({
      ...passingDiagnostics,
      client: "electron",
      transport: "ipc",
      runtime: {
        ...passingDiagnostics.runtime,
        runtimeName: "electron",
        electronVersion: "43.3.0"
      }
    }) });
    await user.click(screen.getByRole("button", { name: "Run self-test" }));
    expect(await screen.findByText("IPC")).toBeInTheDocument();
    expect(screen.getByText("Electron")).toBeInTheDocument();
  });

  it("shows component failure details and supports retry", async () => {
    const user = userEvent.setup();
    const diagnostics = vi.fn()
      .mockResolvedValueOnce({
        ...passingDiagnostics,
        overall: "fail",
        checks: {
          ...passingDiagnostics.checks,
          ffmpeg: {
            status: "fail",
            executable: "ffmpeg",
            code: "FFMPEG_NOT_FOUND",
            message: "FFmpeg was not found."
          }
        }
      })
      .mockResolvedValueOnce(passingDiagnostics);
    renderApp("/diagnostics", { diagnostics });
    await user.click(screen.getByRole("button", { name: "Run self-test" }));
    expect(await screen.findByText(/FFmpeg was not found\./u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run again" }));
    expect(await screen.findAllByText("PASS")).toHaveLength(3);
    expect(diagnostics).toHaveBeenCalledTimes(2);
  });

  it("turns a boundary error into actionable recovery copy", async () => {
    const user = userEvent.setup();
    renderApp("/diagnostics", { diagnostics: async () => { throw new Error("Local API is unavailable."); } });
    await user.click(screen.getByRole("button", { name: "Run self-test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Local API is unavailable.");
    expect(screen.getByRole("alert")).toHaveTextContent("run the self-test again");
  });
});
