// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LexiconEditor, type LexiconEditorChange, type LexiconEditorValue } from "./LexiconEditor.js";

const initial: LexiconEditorValue[] = [
  { id: "api", displayText: "API", spokenText: "A P I", enabled: true },
  { id: "sql", displayText: "SQL", spokenText: "S Q L", enabled: false }
];

describe("LexiconEditor", () => {
  it("emits complete JSON values for add, inline edit, toggle, blur, and delete", async () => {
    const changes: Array<{ value: LexiconEditorValue[]; change: LexiconEditorChange }> = [];
    function Harness() {
      const [value, setValue] = useState(initial);
      return <LexiconEditor value={value} searchLabel="Search lexicon" emptyMessage="No entries." onChange={(next, change) => {
        changes.push({ value: next, change });
        setValue(next);
        return true;
      }} />;
    }
    render(<Harness />);
    const user = userEvent.setup();

    const scriptInputs = screen.getAllByLabelText("Script Text");
    const spokenInputs = screen.getAllByLabelText("Spoken Text");
    await user.type(scriptInputs[0]!, "URL");
    await user.type(spokenInputs[0]!, "U R L");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(changes.at(-1)?.change.kind).toBe("add");
    expect(changes.at(-1)?.value.at(-1)).toMatchObject({ displayText: "URL", spokenText: "U R L", enabled: true });

    const apiRow = screen.getByRole("article", { name: "Lexicon entry API" });
    await user.clear(within(apiRow).getByLabelText("Spoken Text"));
    await user.type(within(apiRow).getByLabelText("Spoken Text"), "application programming interface");
    await user.tab();
    expect(changes.some(({ change }) => change.kind === "commit" && change.id === "api")).toBe(true);
    await user.click(within(apiRow).getByLabelText("Enabled"));
    expect(changes.at(-1)).toMatchObject({ change: { kind: "toggle", id: "api" } });
    await user.click(within(apiRow).getByRole("button", { name: "Delete" }));
    expect(changes.at(-1)?.value.some(({ id }) => id === "api")).toBe(false);
  });

  it("searches both fields, rejects blanks and case-insensitive duplicates, and renders row errors", async () => {
    const onChange = vi.fn(() => true);
    render(<LexiconEditor value={initial} onChange={onChange} searchLabel="Search lexicon" emptyMessage="No entries." rowErrors={{ sql: "Not saved — edit or blur to retry" }} />);
    const user = userEvent.setup();

    expect(screen.getByText("Not saved — edit or blur to retry")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search lexicon"), "S Q L");
    expect(screen.getByRole("article", { name: "Lexicon entry SQL" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Lexicon entry API" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search lexicon"));

    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Script Text and Spoken Text are required.")).toBeInTheDocument();
    await user.type(screen.getAllByLabelText("Script Text")[0]!, "api");
    await user.type(screen.getAllByLabelText("Spoken Text")[0]!, "duplicate");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Script Text must be unique regardless of capitalization.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses Alias language without changing the emitted editor shape", async () => {
    const onChange = vi.fn(() => true);
    render(<LexiconEditor
      value={[{ id: "resume-cv", displayText: "resume/cv", spokenText: "rez oo may", enabled: true }]}
      onChange={onChange}
      searchLabel="Search aliases"
      emptyMessage="No aliases."
      displayTextLabel="Alias"
    />);
    const user = userEvent.setup();

    expect(screen.getAllByLabelText("Alias")).toHaveLength(2);
    expect(screen.getByPlaceholderText("Search Alias or Spoken Text")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Alias and Spoken Text are required.")).toBeInTheDocument();
    await user.type(screen.getAllByLabelText("Alias")[0]!, "RESUME/CV");
    await user.type(screen.getAllByLabelText("Spoken Text")[0]!, "duplicate");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Alias must be unique regardless of capitalization.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports JSON entries without IDs", async () => {
    function Harness() {
      const [value, setValue] = useState<LexiconEditorValue[]>([
        { displayText: "HTTP", spokenText: "H T T P", enabled: true }
      ]);
      return <LexiconEditor value={value} searchLabel="Search lexicon" emptyMessage="No entries." onChange={(next) => setValue(next)} />;
    }
    render(<Harness />);
    const user = userEvent.setup();
    const row = screen.getByRole("article", { name: "Lexicon entry HTTP" });

    await user.clear(within(row).getByLabelText("Spoken Text"));
    await user.type(within(row).getByLabelText("Spoken Text"), "hypertext transfer protocol");
    expect(within(row).getByLabelText("Spoken Text")).toHaveValue("hypertext transfer protocol");
    await user.click(within(row).getByLabelText("Enabled"));
    expect(within(row).getByLabelText("Enabled")).not.toBeChecked();
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    expect(screen.getByText("No entries.")).toBeInTheDocument();
  });

  it("can hide search while empty and restore that state after the last deletion", async () => {
    function Harness() {
      const [value, setValue] = useState<LexiconEditorValue[]>([]);
      return <LexiconEditor value={value} hideSearchWhenEmpty searchLabel="Search project lexicon" emptyMessage="No entries." onChange={(next) => setValue(next)} />;
    }
    render(<Harness />);
    const user = userEvent.setup();
    expect(screen.queryByLabelText("Search project lexicon")).not.toBeInTheDocument();
    await user.type(screen.getAllByLabelText("Script Text")[0]!, "API");
    await user.type(screen.getAllByLabelText("Spoken Text")[0]!, "A P I");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByLabelText("Search project lexicon")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByLabelText("Search project lexicon")).not.toBeInTheDocument();
  });
});
