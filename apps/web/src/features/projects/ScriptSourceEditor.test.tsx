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

afterEach(cleanup);

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

  it("exposes focus and selection operations through its imperative handle", () => {
    const ref = createRef<ScriptSourceEditorHandle>();
    render(<ScriptSourceEditor ref={ref} value={"First\nSecond"} onChange={() => undefined} />);

    ref.current?.focus();
    expect(screen.getByRole("textbox", { name: "Script source" })).toHaveFocus();

    ref.current?.setSelection(6, 12, { scrollIntoView: true });
    expect(ref.current?.getSelection()).toEqual({ from: 6, to: 12 });
  });
});
