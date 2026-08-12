// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseScript, transformScript, type LexiconEntry } from "@studynarrator/core";
import type { ScriptAnalysisInput, ScriptAnalysisResult } from "@/workers/parser/parserWorkerProtocol.js";
import { ScriptLabPage } from "./ScriptLabPage.js";

afterEach(cleanup);

function analyze(input: ScriptAnalysisInput): ScriptAnalysisResult {
  const { entries, ...parseInput } = input;
  const parseResult = parseScript(parseInput);
  return { parseResult, transformResult: transformScript({ parsedScript: parseResult, entries }) };
}

function analyzer() {
  return { analyze: vi.fn(async (input: ScriptAnalysisInput) => analyze(input)) };
}

async function addEntry(
  user: ReturnType<typeof userEvent.setup>,
  values: { scope?: LexiconEntry["scope"]; type?: LexiconEntry["entryType"]; display: string; sense?: string; spoken: string }
): Promise<void> {
  if (values.scope) await user.selectOptions(screen.getByLabelText("Lexicon scope"), values.scope);
  if (values.type) await user.selectOptions(screen.getByLabelText("Entry type"), values.type);
  await user.type(screen.getByLabelText("Display text"), values.display);
  if (values.sense) await user.type(screen.getByLabelText("Sense ID"), values.sense);
  await user.type(screen.getByLabelText("Spoken text"), values.spoken);
  await user.click(screen.getByRole("button", { name: "Add entry" }));
}

describe("G02 and G03 Script Lab", () => {
  it("analyzes a script and preserves its source", async () => {
    const user = userEvent.setup();
    const worker = analyzer();
    render(<ScriptLabPage analyzer={worker} />);

    const source = "[section: Topic]\n\n[speaker_teacher] Read {{resume|cv}}.\n[pause_short]";
    const editor = screen.getByLabelText("Script source");
    fireEvent.change(editor, { target: { value: source } });
    await user.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByLabelText("Discovery summary")).toHaveTextContent("1Speakers");
    expect(screen.getByLabelText("Discovery summary")).toHaveTextContent("1Pause IDs");
    expect(screen.getByLabelText("Speaker teacher")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Ordered canonical nodes" })).toHaveTextContent("Read resume.");
    expect(editor).toHaveValue(source);
  });

  it("uses an optional default speaker without persisting or mutating source", async () => {
    const user = userEvent.setup();
    const worker = analyzer();
    render(<ScriptLabPage analyzer={worker} />);
    fireEvent.change(screen.getByLabelText("Script source"), { target: { value: "Opening narration." } });
    await user.type(screen.getByLabelText(/Default speaker ID/u), "narrator");
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByLabelText("Speaker narrator")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Ordered canonical nodes" })).toHaveTextContent("Opening narration.");
    expect(worker.analyze).toHaveBeenCalledWith({ source: "Opening narration.", defaultSpeakerId: "narrator", entries: [] });
  });

  it("shows ordered parse errors while retaining malformed text as speech", async () => {
    const user = userEvent.setup();
    render(<ScriptLabPage analyzer={analyzer()} />);
    fireEvent.change(screen.getByLabelText("Script source"), { target: { value: "[speaker_1bad] Valid.\n[section Database indexes]" } });
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Line 2, column 1");
    expect(alert).toHaveTextContent("MALFORMED_SECTION_DIRECTIVE");
    const table = screen.getByRole("table", { name: "Ordered canonical nodes" });
    expect(screen.getAllByLabelText("Speaker 1bad")).toHaveLength(2);
    expect(table).toHaveTextContent("Valid.");
    expect(table).toHaveTextContent("[section Database indexes]");
  });

  it("ignores and restores every occurrence of a malformed token pattern", async () => {
    const user = userEvent.setup();
    const worker = analyzer();
    render(<ScriptLabPage analyzer={worker} />);
    fireEvent.change(screen.getByLabelText("Script source"), { target: { value: "[speaker_teacher] First {{resume|cv sentence.\nSecond {{resume|cv" } });
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByRole("heading", { name: "Blocking errors (2)" })).toBeInTheDocument();
    await user.click((await screen.findAllByRole("button", { name: "Ignore this pattern" }))[0]!);
    expect(await screen.findByRole("heading", { name: "Ignored error patterns (1)" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Blocking errors/u })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ignored error patterns (1)" }).parentElement).toHaveTextContent("{{resume|cv");
    expect(worker.analyze).toHaveBeenLastCalledWith(expect.objectContaining({
      ignoredDiagnostics: [{ code: "UNCLOSED_PRONUNCIATION_ANNOTATION", pattern: "{{resume|cv" }],
      entries: []
    }));
    await user.click(screen.getByRole("button", { name: "Restore this pattern" }));
    expect(await screen.findByRole("heading", { name: "Blocking errors (2)" })).toBeInTheDocument();
  });

  it("shows inline pauses and speaker switches in canonical order", async () => {
    const user = userEvent.setup();
    render(<ScriptLabPage analyzer={analyzer()} />);
    fireEvent.change(screen.getByLabelText("Script source"), {
      target: { value: "[speaker_1bad] Before [pause_short] after [speaker_teacher] changed.\nStill teacher." }
    });
    await user.click(screen.getByRole("button", { name: "Analyze" }));

    const rows = within(await screen.findByRole("table", { name: "Ordered canonical nodes" })).getAllByRole("row").slice(1);
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
    let resolveAnalysis: ((result: ScriptAnalysisResult) => void) | undefined;
    const worker = { analyze: vi.fn(async () => await new Promise<ScriptAnalysisResult>((resolve) => { resolveAnalysis = resolve; })) };
    render(<ScriptLabPage analyzer={worker} />);
    const editor = screen.getByLabelText("Script source");
    fireEvent.change(editor, { target: { value: "[speaker_teacher] First." } });
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    await user.type(editor, " changed");
    expect(await screen.findByText(/stale result was discarded/u)).toBeInTheDocument();
    resolveAnalysis?.(analyze({ source: "[speaker_teacher] First.", entries: [] }));
    expect(screen.queryByRole("table", { name: "Ordered canonical nodes" })).not.toBeInTheDocument();
    expect(editor).toHaveValue("[speaker_teacher] First. changed");
  });

  it("preserves inputs and gives recovery guidance after worker failure", async () => {
    const user = userEvent.setup();
    render(<ScriptLabPage analyzer={{ analyze: vi.fn(async () => { throw new Error("Worker unavailable."); }) }} />);
    const editor = screen.getByLabelText("Script source");
    fireEvent.change(editor, { target: { value: "[speaker_teacher] Keep me." } });
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Worker unavailable.");
    expect(screen.getByRole("alert")).toHaveTextContent("source and lexicon are unchanged");
    expect(editor).toHaveValue("[speaker_teacher] Keep me.");
  });

  it("adds, audits, removes, and restores in-memory lexicon entries across all transcript tabs", async () => {
    const user = userEvent.setup();
    render(<ScriptLabPage analyzer={analyzer()} />);
    const source = "[speaker_teacher] Update {{resume|cv}}. SQL can {{resume|continue}}.";
    fireEvent.change(screen.getByLabelText("Script source"), { target: { value: source } });
    await addEntry(user, { display: "SQL", spoken: "sequel" });
    await addEntry(user, { scope: "project", type: "namedSense", display: "resume", sense: "cv", spoken: "rez-oo-may" });
    await addEntry(user, { scope: "project", type: "namedSense", display: "resume", sense: "continue", spoken: "ree-zoom" });
    await user.click(screen.getByRole("button", { name: "Analyze" }));

    await user.click(await screen.findByRole("tab", { name: "Readable transcript" }));
    expect(screen.getByRole("tabpanel", { name: "Readable transcript" })).toHaveTextContent("Update resume. SQL can resume.");
    await user.click(screen.getByRole("tab", { name: "TTS transcript" }));
    expect(screen.getByRole("tabpanel", { name: "TTS transcript" })).toHaveTextContent("Update rez-oo-may. sequel can ree-zoom.");
    await user.click(screen.getByRole("tab", { name: "Lexicon matches" }));
    const audit = screen.getByRole("table", { name: "Lexicon match audit" });
    expect(audit).toHaveTextContent("g03-project-002");
    expect(audit).toHaveTextContent("resume → rez-oo-may");
    expect(audit).toHaveTextContent("SQL → sequel");

    const cvEntry = screen.getByText("resume + cv").closest("article");
    expect(cvEntry).not.toBeNull();
    await user.click(within(cvEntry!).getByRole("button", { name: "Delete entry" }));
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByRole("heading", { name: "Transformation errors (1)" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("UNRESOLVED_NAMED_SENSE");
    await user.click(screen.getByRole("button", { name: "Restore resume + cv" }));
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(screen.queryByRole("heading", { name: /Transformation errors/u })).not.toBeInTheDocument();
    expect(screen.getByText("Synthesis ready")).toBeInTheDocument();
    expect(screen.getByLabelText("Script source")).toHaveValue(source);
  });
});
