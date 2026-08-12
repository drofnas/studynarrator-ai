// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseScript, type ParseScriptResult } from "@studynarrator/core";
import { App } from "./App.js";
import { ScriptLab } from "./ScriptLab.js";

afterEach(cleanup);

describe("G02 Script Lab", () => {
  it("is the default view and parses without calling diagnostics", async () => {
    const user = userEvent.setup();
    const diagnostics = vi.fn();
    const parser = { parse: vi.fn(async (input: { source: string; defaultSpeakerId?: string }) => parseScript(input)) };
    render(<App client={{ diagnostics }} parser={parser} />);

    expect(screen.getByRole("heading", { name: "Script Lab" })).toBeInTheDocument();
    const source = "[section: Topic]\n\n[speaker_teacher] Read {{resume|cv}}.\n[pause_short]";
    const editor = screen.getByLabelText("Script source");
    fireEvent.change(editor, { target: { value: source } });
    await user.click(screen.getByRole("button", { name: "Parse" }));

    expect(await screen.findByLabelText("Discovery summary")).toHaveTextContent("1Speakers");
    expect(screen.getByLabelText("Discovery summary")).toHaveTextContent("1Pause IDs");
    expect(screen.getByLabelText("Speaker teacher")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("Read resume.");
    expect(editor).toHaveValue(source);
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it("uses an optional default speaker without persisting or mutating source", async () => {
    const user = userEvent.setup();
    const parser = { parse: vi.fn(async (input: { source: string; defaultSpeakerId?: string }) => parseScript(input)) };
    render(<ScriptLab parser={parser} />);
    fireEvent.change(screen.getByLabelText("Script source"), { target: { value: "Opening narration." } });
    await user.type(screen.getByLabelText(/Default speaker ID/u), "narrator");
    await user.click(screen.getByRole("button", { name: "Parse" }));
    expect(await screen.findByLabelText("Speaker narrator")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("Opening narration.");
    expect(parser.parse).toHaveBeenCalledWith({ source: "Opening narration.", defaultSpeakerId: "narrator" });
  });

  it("shows ordered errors while retaining malformed text as speech", async () => {
    const user = userEvent.setup();
    const parser = { parse: vi.fn(async (input: { source: string }) => parseScript(input)) };
    render(<ScriptLab parser={parser} />);
    fireEvent.change(screen.getByLabelText("Script source"), { target: { value: "[speaker_1bad] Valid.\n[section Database indexes]" } });
    await user.click(screen.getByRole("button", { name: "Parse" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Line 2, column 1");
    expect(alert).toHaveTextContent("MALFORMED_SECTION_DIRECTIVE");
    const table = screen.getByRole("table");
    expect(screen.getAllByLabelText("Speaker 1bad")).toHaveLength(2);
    expect(table).toHaveTextContent("Valid.");
    expect(table).toHaveTextContent("[section Database indexes]");
  });

  it("ignores and restores every occurrence of a malformed token pattern", async () => {
    const user = userEvent.setup();
    const parser = { parse: vi.fn(async (input: Parameters<typeof parseScript>[0]) => parseScript(input)) };
    render(<ScriptLab parser={parser} />);
    fireEvent.change(screen.getByLabelText("Script source"), { target: { value: "[speaker_teacher] First {{resume|cv sentence.\nSecond {{resume|cv" } });
    await user.click(screen.getByRole("button", { name: "Parse" }));
    expect(await screen.findByRole("heading", { name: "Blocking errors (2)" })).toBeInTheDocument();
    await user.click((await screen.findAllByRole("button", { name: "Ignore this pattern" }))[0]!);
    expect(await screen.findByRole("heading", { name: "Ignored error patterns (1)" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Blocking errors/u })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ignored error patterns (1)" }).parentElement).toHaveTextContent("{{resume|cv");
    expect(parser.parse).toHaveBeenLastCalledWith(expect.objectContaining({
      ignoredDiagnostics: [{ code: "UNCLOSED_PRONUNCIATION_ANNOTATION", pattern: "{{resume|cv" }]
    }));
    await user.click(screen.getByRole("button", { name: "Restore this pattern" }));
    expect(await screen.findByRole("heading", { name: "Blocking errors (2)" })).toBeInTheDocument();
  });

  it("shows inline pauses and speaker switches in canonical order", async () => {
    const user = userEvent.setup();
    const parser = { parse: vi.fn(async (input: Parameters<typeof parseScript>[0]) => parseScript(input)) };
    render(<ScriptLab parser={parser} />);
    fireEvent.change(screen.getByLabelText("Script source"), {
      target: { value: "[speaker_1bad] Before [pause_short] after [speaker_teacher] changed.\nStill teacher." }
    });
    await user.click(screen.getByRole("button", { name: "Parse" }));

    const rows = within(await screen.findByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByLabelText("Speaker 1bad")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("Before");
    expect(rows[1]).toHaveTextContent("pause_short");
    expect(within(rows[2]!).getByLabelText("Speaker 1bad")).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("after");
    expect(within(rows[3]!).getByLabelText("Speaker teacher")).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent("changed.");
    expect(within(rows[4]!).getByLabelText("Speaker teacher")).toBeInTheDocument();
    expect(rows[4]).toHaveTextContent("Still teacher.");
  });

  it("discards a stale worker response when source changes", async () => {
    const user = userEvent.setup();
    let resolveParse: ((result: ParseScriptResult) => void) | undefined;
    const parser = { parse: vi.fn(async () => await new Promise<ParseScriptResult>((resolve) => { resolveParse = resolve; })) };
    render(<ScriptLab parser={parser} />);
    const editor = screen.getByLabelText("Script source");
    fireEvent.change(editor, { target: { value: "[speaker_teacher] First." } });
    await user.click(screen.getByRole("button", { name: "Parse" }));
    await user.type(editor, " changed");
    resolveParse?.(parseScript({ source: "[speaker_teacher] First." }));
    expect(await screen.findByText(/stale result was discarded/u)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(editor).toHaveValue("[speaker_teacher] First. changed");
  });

  it("preserves source and gives recovery guidance after worker failure", async () => {
    const user = userEvent.setup();
    render(<ScriptLab parser={{ parse: vi.fn(async () => { throw new Error("Worker unavailable."); }) }} />);
    const editor = screen.getByLabelText("Script source");
    fireEvent.change(editor, { target: { value: "[speaker_teacher] Keep me." } });
    await user.click(screen.getByRole("button", { name: "Parse" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Worker unavailable.");
    expect(screen.getByRole("alert")).toHaveTextContent("Your source is unchanged");
    expect(editor).toHaveValue("[speaker_teacher] Keep me.");
  });

  it("preserves the G01 diagnostics screen behind navigation", async () => {
    const user = userEvent.setup();
    render(<App client={{ diagnostics: vi.fn() }} parser={{ parse: vi.fn() }} />);
    await user.click(screen.getByRole("button", { name: "Runtime diagnostics" }));
    expect(screen.getByRole("heading", { name: "Runtime self-test" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation")).getByRole("button", { name: "Runtime diagnostics" })).toHaveAttribute("aria-current", "page");
  });
});
