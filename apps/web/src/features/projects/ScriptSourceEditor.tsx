import { EditorState } from "@codemirror/state";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  searchKeymap,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { EditorView, keymap, lineNumbers, type Panel } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import styles from "./ScriptSourceEditor.module.css";

function createSearchPanel(view: EditorView): Panel {
  const ownerDocument = view.dom.ownerDocument;
  const dom = ownerDocument.createElement("div");
  dom.className = "cm-search";
  dom.setAttribute("role", "search");
  dom.setAttribute("aria-label", "Search script");

  const input = ownerDocument.createElement("input");
  input.className = "cm-textfield";
  input.placeholder = "Find in script";
  input.setAttribute("aria-label", "Find in script");
  input.setAttribute("main-field", "true");
  input.value = getSearchQuery(view.state).search;

  const previous = ownerDocument.createElement("button");
  previous.className = "cm-button";
  previous.type = "button";
  previous.textContent = "Previous";
  previous.setAttribute("aria-label", "Previous match");

  const next = ownerDocument.createElement("button");
  next.className = "cm-button";
  next.type = "button";
  next.textContent = "Next";
  next.setAttribute("aria-label", "Next match");

  const status = ownerDocument.createElement("span");
  status.className = "cm-searchStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const close = ownerDocument.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close search");

  const updateStatus = () => {
    const query = getSearchQuery(view.state);
    status.textContent = !query.valid
      ? "Enter text to search."
      : query.getCursor(view.state).next().done
        ? "No matches."
        : "Matches found.";
  };
  const commit = () => {
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: input.value })),
    });
  };

  input.addEventListener("input", commit);
  previous.addEventListener("click", () => findPrevious(view));
  next.addEventListener("click", () => findNext(view));
  close.addEventListener("click", () => closeSearchPanel(view));
  dom.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
    } else if (event.key === "Enter" && event.target === input) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(view);
    } else if (
      event.key.toLowerCase() === "f" &&
      (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      input.select();
    }
  });
  dom.append(input, previous, next, status, close);

  return {
    dom,
    top: true,
    mount() {
      input.focus();
      input.select();
      updateStatus();
    },
    update() {
      const query = getSearchQuery(view.state);
      if (input.value !== query.search) input.value = query.search;
      updateStatus();
    },
  };
}

export interface ScriptSourceEditorHandle {
  focus(): void;
  openSearch(): void;
  setSelection(
    from: number,
    to?: number,
    options?: { scrollIntoView?: boolean },
  ): void;
}

export const ScriptSourceEditor = forwardRef<
  ScriptSourceEditorHandle,
  {
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }
>(function ScriptSourceEditor(
  { value, onChange, ariaLabel = "Script source" },
  ref,
) {
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
        search({ createPanel: createSearchPanel }),
        keymap.of(searchKeymap),
        lineNumbers(),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
          "aria-multiline": "true",
          spellcheck: "false",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !synchronizingRef.current)
            onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    viewRef.current = view;

    const scrollPageFromEditorWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.deltaY === 0) return;
      const pageWindow = host.ownerDocument.defaultView;
      if (!pageWindow) return;
      const deltaScale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? view.defaultLineHeight
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? pageWindow.innerHeight
            : 1;
      event.preventDefault();
      event.stopPropagation();
      pageWindow.scrollBy({ top: event.deltaY * deltaScale, behavior: "auto" });
    };
    host.addEventListener("wheel", scrollPageFromEditorWheel, {
      capture: true,
      passive: false,
    });

    return () => {
      host.removeEventListener("wheel", scrollPageFromEditorWheel, {
        capture: true,
      });
      viewRef.current = undefined;
      view.destroy();
    };
  }, [ariaLabel]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    synchronizingRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    } finally {
      synchronizingRef.current = false;
    }
  }, [value]);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        viewRef.current?.focus();
      },
      openSearch() {
        const view = viewRef.current;
        if (view) openSearchPanel(view);
      },
      setSelection(from, to = from, options = {}) {
        const view = viewRef.current;
        if (!view) return;
        const anchor = Math.max(0, Math.min(from, view.state.doc.length));
        const head = Math.max(0, Math.min(to, view.state.doc.length));
        view.dispatch({
          selection: { anchor, head },
          ...(options.scrollIntoView
            ? { effects: EditorView.scrollIntoView(anchor, { y: "center" }) }
            : {}),
        });
      },
    }),
    [],
  );

  return <div className={styles.root} ref={hostRef} />;
});
