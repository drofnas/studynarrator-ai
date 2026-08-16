// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "@/test/domGeometry.js";
import { EditorView } from "@codemirror/view";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptSourceEditor, type ScriptSourceEditorHandle } from "./ScriptSourceEditor.js";

function editorView(): EditorView {
  const content = screen.getByRole("textbox", { name: "Script source" });
  const view = EditorView.findFromDOM(content.closest(".cm-editor") as HTMLElement);
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
    const result = render(<ScriptSourceEditor value="First line" onChange={onChange} />);
    const view = editorView();

    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    expect(onChange).toHaveBeenLastCalledWith("First line!");

    result.rerender(<ScriptSourceEditor value={"Replacement\nvalue"} onChange={onChange} />);
    expect(editorView().state.doc.toString()).toBe("Replacement\nvalue");
  });

  it("supports a contextual accessible label while preserving the project-editor default", () => {
    const result = render(<ScriptSourceEditor value="Prompt" onChange={() => undefined} ariaLabel="Create a script prompt editor" />);
    expect(screen.getByRole("textbox", { name: "Create a script prompt editor" })).toBeInTheDocument();

    result.rerender(<ScriptSourceEditor value="Prompt" onChange={() => undefined} />);
    expect(screen.getByRole("textbox", { name: "Script source" })).toBeInTheDocument();
  });

  it("exposes focus and selection operations through its imperative handle", () => {
    const ref = createRef<ScriptSourceEditorHandle>();
    render(<ScriptSourceEditor ref={ref} value={"First\nSecond"} onChange={() => undefined} />);

    ref.current?.focus();
    expect(screen.getByRole("textbox", { name: "Script source" })).toHaveFocus();

    ref.current?.setSelection(6, 12, { scrollIntoView: true });
    expect(editorView().state.selection.main).toMatchObject({ from: 6, to: 12 });
  });

  it("hands vertical wheel deltas to the page", () => {
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    render(<ScriptSourceEditor value="First line" onChange={() => undefined} />);
    const content = screen.getByRole("textbox", { name: "Script source" });
    const lineHeight = editorView().defaultLineHeight;

    const pixels = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    content.dispatchEvent(pixels);
    const lines = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      deltaY: -3
    });
    content.dispatchEvent(lines);
    const pages = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PAGE,
      deltaY: 1
    });
    content.dispatchEvent(pages);

    expect(pixels.defaultPrevented).toBe(true);
    expect(lines.defaultPrevented).toBe(true);
    expect(pages.defaultPrevented).toBe(true);
    expect(scrollBy.mock.calls).toEqual([
      [{ top: 120, behavior: "auto" }],
      [{ top: -3 * lineHeight, behavior: "auto" }],
      [{ top: window.innerHeight, behavior: "auto" }]
    ]);
  });

  it("leaves browser zoom and horizontal-only wheel gestures untouched", () => {
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    render(<ScriptSourceEditor value="First line" onChange={() => undefined} />);
    const content = screen.getByRole("textbox", { name: "Script source" });
    const gestures = [
      new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 120 }),
      new WheelEvent("wheel", { bubbles: true, cancelable: true, metaKey: true, deltaY: 120 }),
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 120, deltaY: 0 })
    ];

    for (const gesture of gestures) content.dispatchEvent(gesture);

    expect(gestures.every(({ defaultPrevented }) => !defaultPrevented)).toBe(true);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
