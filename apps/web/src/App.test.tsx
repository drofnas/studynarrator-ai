// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemDiagnostics } from "@studynarrator/shared-types";
import { App } from "./App.js";

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

describe("G01 status screen", () => {
  it("shows a disabled checking state while diagnostics are in flight", async () => {
    const user = userEvent.setup();
    let finish: ((value: SystemDiagnostics) => void) | undefined;
    const pending = new Promise<SystemDiagnostics>((resolve) => { finish = resolve; });
    render(<App client={{ diagnostics: async () => await pending }} />);

    await user.click(screen.getByRole("button", { name: "Run self-test" }));
    expect(screen.getByRole("button", { name: "Checking signal…" })).toBeDisabled();
    expect(screen.getAllByText("CHECKING")).toHaveLength(3);
    finish?.(passingDiagnostics);
    expect(await screen.findByRole("button", { name: "Run again" })).toBeEnabled();
  });

  it("shows the idle state then all required Web/REST pass lines", async () => {
    const user = userEvent.setup();
    const diagnostics = vi.fn(async () => passingDiagnostics);
    render(<App client={{ diagnostics }} />);

    expect(screen.getAllByText("NOT RUN")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Run self-test" }));
    expect(await screen.findByText("REST")).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getAllByText("PASS")).toHaveLength(3);
    expect(screen.getByText(/study-narrator-g01/u)).toBeInTheDocument();
  });

  it("renders Electron/IPC metadata from the same contract", async () => {
    const user = userEvent.setup();
    render(<App client={{ diagnostics: async () => ({
      ...passingDiagnostics,
      client: "electron",
      transport: "ipc",
      runtime: {
        ...passingDiagnostics.runtime,
        runtimeName: "electron",
        electronVersion: "43.3.0"
      }
    }) }} />);
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
    render(<App client={{ diagnostics }} />);
    await user.click(screen.getByRole("button", { name: "Run self-test" }));
    expect(await screen.findByText(/FFmpeg was not found\./u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run again" }));
    expect(await screen.findAllByText("PASS")).toHaveLength(3);
    expect(diagnostics).toHaveBeenCalledTimes(2);
  });

  it("turns a boundary error into actionable recovery copy", async () => {
    const user = userEvent.setup();
    render(<App client={{ diagnostics: async () => { throw new Error("Local API is unavailable."); } }} />);
    await user.click(screen.getByRole("button", { name: "Run self-test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Local API is unavailable.");
    expect(screen.getByRole("alert")).toHaveTextContent("run the self-test again");
  });
});
