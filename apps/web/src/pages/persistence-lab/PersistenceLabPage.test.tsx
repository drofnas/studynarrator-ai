// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IgnoredDiagnosticCollection, PersistenceClient, ProjectCreateInput, ProjectDetail, ProjectReplaceInput, SystemPacingDefaults } from "@studynarrator/shared-types";
import { PersistenceLabPage } from "./PersistenceLabPage.js";

const project: ProjectDetail = {
  contractVersion: 1,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Restart study",
  description: "Durable fixture",
  scriptSource: "Résumé\r\n\r\nSQL",
  scriptHash: "a".repeat(64),
  connectionProfileId: null,
  speakerMappings: [],
  pausePresets: [{ pauseId: "pause_medium", durationMs: 750, description: "Paragraph" }],
  paragraphPause: { enabled: true, pauseId: "pause_medium", durationMs: 750 },
  lexiconEntries: [],
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z"
};

function clientFixture() {
  let stored = structuredClone(project);
  const replace = vi.fn(async (_projectId: string, input: ProjectReplaceInput) => {
    stored = { ...stored, ...input, scriptHash: "b".repeat(64), updatedAt: "2026-08-12T13:00:00.000Z", lexiconEntries: [] };
    return structuredClone(stored);
  });
  const remove = vi.fn(async () => undefined);
  const updatePacing = vi.fn(async (input: SystemPacingDefaults) => input);
  const replaceIgnored = vi.fn(async (input: IgnoredDiagnosticCollection) => input);
  const replaceGlobal = vi.fn(async () => []);
  const client: PersistenceClient = {
    status: vi.fn(async () => ({ contractVersion: 1, state: "ready", databaseSchemaVersion: 2, targetDatabaseSchemaVersion: 2, databasePath: "/tmp/gates/G04/studynarrator.sqlite", latestBackupPath: null } as const)),
    projects: {
      list: vi.fn(async () => remove.mock.calls.length > 0 ? [] : [{ id: stored.id, name: stored.name, description: stored.description, scriptHash: stored.scriptHash, createdAt: stored.createdAt, updatedAt: stored.updatedAt }]),
      create: vi.fn(async (input: ProjectCreateInput) => ({ ...structuredClone(project), name: input.name, description: input.description ?? "" })),
      get: vi.fn(async () => structuredClone(stored)),
      replace,
      delete: remove
    },
    settings: { getPacing: vi.fn(async () => ({ enabled: true, durationMs: 750 })), updatePacing },
    preferences: { getIgnoredDiagnostics: vi.fn(async () => []), replaceIgnoredDiagnostics: replaceIgnored },
    globalLexicon: { list: vi.fn(async () => []), replace: replaceGlobal },
    connectionProfiles: { list: vi.fn(async () => []), create: vi.fn(), replace: vi.fn(), delete: vi.fn() }
  };
  return { client, replace, remove, replaceGlobal, updatePacing };
}

afterEach(cleanup);

describe("Persistence Lab", () => {
  it("shows the migration ledger and reloads a persisted project", async () => {
    const { client } = clientFixture();
    render(<PersistenceLabPage client={client} />);
    const ledger = await screen.findByRole("region", { name: "Migration ledger" });
    expect(within(ledger).getByText("2 / 2")).toBeInTheDocument();
    expect(within(ledger).getByText("/tmp/gates/G04/studynarrator.sqlite")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Restart study/u }));
    expect(screen.getByLabelText("Exact script source")).toHaveValue("Résumé\n\nSQL");
    expect(screen.getByText("Loaded Restart study from SQLite.")).toBeInTheDocument();
  });

  it("retains invalid JSON drafts and saves a complete aggregate only after all editors validate", async () => {
    const user = userEvent.setup();
    const { client, replace } = clientFixture();
    render(<PersistenceLabPage client={client} />);
    await user.click(await screen.findByRole("button", { name: /Restart study/u }));
    const speakers = screen.getByLabelText("Speaker mappings JSON");
    fireEvent.change(speakers, { target: { value: "{" } });
    await user.click(screen.getByRole("button", { name: "Save project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Speaker mappings $: Invalid JSON syntax.");
    expect(speakers).toHaveValue("{");
    expect(replace).not.toHaveBeenCalled();

    fireEvent.change(speakers, { target: { value: "[]" } });
    await user.clear(screen.getByLabelText("Exact script source"));
    await user.type(screen.getByLabelText("Exact script source"), "Exact CRLF source");
    await user.click(screen.getByRole("button", { name: "Save project" }));
    expect(await screen.findByText("Project aggregate saved atomically.")).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith(project.id, expect.objectContaining({ scriptSource: "Exact CRLF source", speakerMappings: [] }));
  });

  it("requires explicit confirmation before deleting a project", async () => {
    const user = userEvent.setup();
    const { client, remove } = clientFixture();
    render(<PersistenceLabPage client={client} />);
    await user.click(await screen.findByRole("button", { name: /Restart study/u }));
    await user.click(screen.getByRole("button", { name: "Delete project…" }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByText("Project and its owned records were deleted.")).toBeInTheDocument();
    expect(remove).toHaveBeenCalledWith(project.id);
  });

  it("validates installation JSON atomically and persists system defaults independently", async () => {
    const user = userEvent.setup();
    const { client, replaceGlobal, updatePacing } = clientFixture();
    render(<PersistenceLabPage client={client} />);
    const global = await screen.findByLabelText("Global lexicon JSON");
    fireEvent.change(global, { target: { value: "{}" } });
    await user.click(screen.getByRole("button", { name: "Replace global lexicon" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Global lexicon $:");
    expect(replaceGlobal).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText("Pause at paragraph breaks by default"));
    const duration = screen.getByLabelText("Paragraph duration (ms)");
    await user.clear(duration);
    await user.type(duration, "1200");
    await user.click(screen.getByRole("button", { name: "Save system defaults" }));
    expect(updatePacing).toHaveBeenCalledWith({ enabled: false, durationMs: 1200 });
  });
});
