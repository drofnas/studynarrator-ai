// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "@/test/domGeometry.js";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ScriptSourceEditor,
  type ScriptSourceEditorHandle,
} from "./ScriptSourceEditor.js";

function editorView(): EditorView {
  const content = screen.getByRole("textbox", { name: "Script source" });
  const view = EditorView.findFromDOM(
    content.closest(".cm-editor") as HTMLElement,
  );
  if (!view) throw new Error("Expected a CodeMirror editor view.");
  return view;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ScriptSourceEditor", () => {
  it("reports edits and synchronizes externally replaced content", () => {
    const onChange = vi.fn();
    const result = render(
      <ScriptSourceEditor value="First line" onChange={onChange} />,
    );
    const view = editorView();

    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    expect(onChange).toHaveBeenLastCalledWith("First line!");

    result.rerender(
      <ScriptSourceEditor value={"Replacement\nvalue"} onChange={onChange} />,
    );
    expect(editorView().state.doc.toString()).toBe("Replacement\nvalue");
  });

  it("supports a contextual accessible label while preserving the project-editor default", () => {
    const result = render(
      <ScriptSourceEditor
        value="Prompt"
        onChange={() => undefined}
        ariaLabel="Create a script prompt editor"
      />,
    );
    expect(
      screen.getByRole("textbox", { name: "Create a script prompt editor" }),
    ).toBeInTheDocument();

    result.rerender(
      <ScriptSourceEditor value="Prompt" onChange={() => undefined} />,
    );
    expect(
      screen.getByRole("textbox", { name: "Script source" }),
    ).toBeInTheDocument();
  });

  it("exposes focus and selection operations through its imperative handle", () => {
    const ref = createRef<ScriptSourceEditorHandle>();
    render(
      <ScriptSourceEditor
        ref={ref}
        value={"First\nSecond"}
        onChange={() => undefined}
      />,
    );

    ref.current?.focus();
    expect(
      screen.getByRole("textbox", { name: "Script source" }),
    ).toHaveFocus();

    ref.current?.setSelection(6, 12, { scrollIntoView: true });
    expect(editorView().state.selection.main).toMatchObject({
      from: 6,
      to: 12,
    });
  });

  it("searches the complete document with repeated keyboard navigation", () => {
    const onChange = vi.fn();
    const source = "First distant target\nSecond distant target";
    render(<ScriptSourceEditor value={source} onChange={onChange} />);
    const content = screen.getByRole("textbox", { name: "Script source" });

    fireEvent.keyDown(content, { key: "f", code: "KeyF", ctrlKey: true });
    const panel = screen.getByRole("search", { name: "Search script" });
    const input = screen.getByRole("textbox", { name: "Find in script" });
    fireEvent.input(input, { target: { value: "distant target" } });
    expect(panel).toHaveTextContent("Matches found.");

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    const firstMatch = editorView().state.selection.main;
    expect(editorView().state.sliceDoc(firstMatch.from, firstMatch.to)).toBe(
      "distant target",
    );
    expect(editorView().state.selection.main.from).toBe(
      source.indexOf("distant target"),
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(editorView().state.selection.main.from).toBe(
      source.lastIndexOf("distant target"),
    );
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(editorView().state.selection.main.from).toBe(
      source.indexOf("distant target"),
    );
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      screen.queryByRole("search", { name: "Search script" }),
    ).not.toBeInTheDocument();
    expect(content).toHaveFocus();
  });

  it("updates the no-match result when the script changes", () => {
    const onChange = vi.fn();
    const ref = createRef<ScriptSourceEditorHandle>();
    render(
      <ScriptSourceEditor
        ref={ref}
        value="Original script"
        onChange={onChange}
      />,
    );
    ref.current?.openSearch();
    const input = screen.getByRole("textbox", { name: "Find in script" });
    fireEvent.input(input, { target: { value: "new match" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matches.");

    const view = editorView();
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\nNew match" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Matches found.");
    expect(onChange).toHaveBeenLastCalledWith("Original script\nNew match");
  });

  it("hands vertical wheel deltas to the page", () => {
    const scrollBy = vi
      .spyOn(window, "scrollBy")
      .mockImplementation(() => undefined);
    render(
      <ScriptSourceEditor value="First line" onChange={() => undefined} />,
    );
    const content = screen.getByRole("textbox", { name: "Script source" });
    const lineHeight = editorView().defaultLineHeight;

    const pixels = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    content.dispatchEvent(pixels);
    const lines = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      deltaY: -3,
    });
    content.dispatchEvent(lines);
    const pages = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PAGE,
      deltaY: 1,
    });
    content.dispatchEvent(pages);

    expect(pixels.defaultPrevented).toBe(true);
    expect(lines.defaultPrevented).toBe(true);
    expect(pages.defaultPrevented).toBe(true);
    expect(scrollBy.mock.calls).toEqual([
      [{ top: 120, behavior: "auto" }],
      [{ top: -3 * lineHeight, behavior: "auto" }],
      [{ top: window.innerHeight, behavior: "auto" }],
    ]);
  });

  it("leaves browser zoom and horizontal-only wheel gestures untouched", () => {
    const scrollBy = vi
      .spyOn(window, "scrollBy")
      .mockImplementation(() => undefined);
    render(
      <ScriptSourceEditor value="First line" onChange={() => undefined} />,
    );
    const content = screen.getByRole("textbox", { name: "Script source" });
    const gestures = [
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: 120,
      }),
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
        deltaY: 120,
      }),
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: 120,
        deltaY: 0,
      }),
    ];

    for (const gesture of gestures) content.dispatchEvent(gesture);

    expect(gestures.every(({ defaultPrevented }) => !defaultPrevented)).toBe(
      true,
    );
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
