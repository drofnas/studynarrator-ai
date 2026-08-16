import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import styles from "./ScriptSourceEditor.module.css";

interface ScriptSourceSelection {
  from: number;
  to: number;
}

export interface ScriptSourceEditorHandle {
  focus(): void;
  getSelection(): ScriptSourceSelection;
  setSelection(from: number, to?: number, options?: { scrollIntoView?: boolean }): void;
}

export const ScriptSourceEditor = forwardRef<ScriptSourceEditorHandle, {
  value: string;
  onChange: (value: string) => void;
}>(function ScriptSourceEditor({ value, onChange }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const synchronizingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      doc: value,
      parent: host,
      extensions: [
        minimalSetup,
        lineNumbers(),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        EditorView.contentAttributes.of({
          "aria-label": "Script source",
          "aria-multiline": "true",
          spellcheck: "false"
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !synchronizingRef.current) onChangeRef.current(update.state.doc.toString());
        })
      ]
    });
    viewRef.current = view;

    const scrollPageFromEditorWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.deltaY === 0) return;
      const pageWindow = host.ownerDocument.defaultView;
      if (!pageWindow) return;
      const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? view.defaultLineHeight
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? pageWindow.innerHeight : 1;
      event.preventDefault();
      event.stopPropagation();
      pageWindow.scrollBy({ top: event.deltaY * deltaScale, behavior: "auto" });
    };
    host.addEventListener("wheel", scrollPageFromEditorWheel, { capture: true, passive: false });

    return () => {
      host.removeEventListener("wheel", scrollPageFromEditorWheel, { capture: true });
      viewRef.current = undefined;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    synchronizingRef.current = true;
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    } finally {
      synchronizingRef.current = false;
    }
  }, [value]);

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus();
    },
    getSelection() {
      const selection = viewRef.current?.state.selection.main;
      return selection ? { from: selection.from, to: selection.to } : { from: 0, to: 0 };
    },
    setSelection(from, to = from, options = {}) {
      const view = viewRef.current;
      if (!view) return;
      const anchor = Math.max(0, Math.min(from, view.state.doc.length));
      const head = Math.max(0, Math.min(to, view.state.doc.length));
      view.dispatch({
        selection: { anchor, head },
        ...(options.scrollIntoView ? { effects: EditorView.scrollIntoView(anchor, { y: "center" }) } : {})
      });
    }
  }), []);

  return <div className={styles.root} ref={hostRef} />;
});
