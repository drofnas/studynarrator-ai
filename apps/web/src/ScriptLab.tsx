import { useRef, useState, type ReactNode } from "react";
import type { CirNode, IgnoredDiagnostic, ParseScriptResult } from "@studynarrator/core";
import type { ScriptParser } from "./parser-client.js";

interface ScriptLabProps {
  parser: ScriptParser;
}

type LabState =
  | { phase: "idle" }
  | { phase: "parsing" }
  | { phase: "parsed"; result: ParseScriptResult }
  | { phase: "stale" }
  | { phase: "error"; message: string };

function nodeContent(node: CirNode): ReactNode {
  switch (node.type) {
    case "speech": return (
      <span className="speech-node-content">
        <span className="speaker-chip" aria-label={`Speaker ${node.speakerId}`}>
          <span className="speaker-chip-label" aria-hidden="true">speaker</span>
          <span className="speaker-chip-name" aria-hidden="true">{node.speakerId}</span>
        </span>
        <span className="speech-copy">{node.readableText}</span>
      </span>
    );
    case "pause": return node.pauseId;
    case "section": return node.title;
    case "paragraphBreak": return `${String(node.lineCount)} blank line${node.lineCount === 1 ? "" : "s"}`;
  }
}

export function ScriptLab({ parser }: ScriptLabProps) {
  const [source, setSource] = useState("");
  const [defaultSpeakerId, setDefaultSpeakerId] = useState("");
  const [ignoredDiagnostics, setIgnoredDiagnostics] = useState<IgnoredDiagnostic[]>([]);
  const [state, setState] = useState<LabState>({ phase: "idle" });
  const currentInput = useRef({ source, defaultSpeakerId });
  const parseRevision = useRef(0);
  currentInput.current = { source, defaultSpeakerId };

  async function runParser(nextIgnoredDiagnostics = ignoredDiagnostics) {
    const submitted = { source, defaultSpeakerId };
    const submittedRevision = parseRevision.current + 1;
    parseRevision.current = submittedRevision;
    setState({ phase: "parsing" });
    try {
      const result = await parser.parse({
        source: submitted.source,
        ...(submitted.defaultSpeakerId.trim() ? { defaultSpeakerId: submitted.defaultSpeakerId.trim() } : {}),
        ...(nextIgnoredDiagnostics.length > 0 ? { ignoredDiagnostics: nextIgnoredDiagnostics } : {})
      });
      if (parseRevision.current !== submittedRevision) return;
      if (currentInput.current.source !== submitted.source || currentInput.current.defaultSpeakerId !== submitted.defaultSpeakerId) {
        setState({ phase: "stale" });
        return;
      }
      setState({ phase: "parsed", result });
    } catch (error) {
      if (parseRevision.current !== submittedRevision) return;
      setState({ phase: "error", message: error instanceof Error ? error.message : "The script could not be parsed." });
    }
  }

  function ignoreDiagnostic(item: IgnoredDiagnostic): void {
    const next = ignoredDiagnostics.some((candidate) => candidate.code === item.code && candidate.pattern === item.pattern)
      ? ignoredDiagnostics
      : [...ignoredDiagnostics, item];
    setIgnoredDiagnostics(next);
    void runParser(next);
  }

  function restoreDiagnostic(item: IgnoredDiagnostic): void {
    const next = ignoredDiagnostics.filter((candidate) =>
      candidate.code !== item.code || candidate.pattern !== item.pattern
    );
    setIgnoredDiagnostics(next);
    void runParser(next);
  }

  const result = state.phase === "parsed" ? state.result : undefined;
  return (
    <section className="console script-lab" aria-labelledby="script-lab-title">
      <div className="console-heading">
        <div>
          <p className="console-kicker">G02 · Deterministic core</p>
          <h2 id="script-lab-title">Script Lab</h2>
        </div>
        <button type="button" onClick={() => void runParser()} disabled={state.phase === "parsing"}>
          {state.phase === "parsing" ? "Parsing…" : "Parse"}
        </button>
      </div>

      <div className="editor-grid">
        <label htmlFor="script-source">Script source</label>
        <textarea id="script-source" value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} />
        <label htmlFor="default-speaker">Default speaker ID <span>(optional, in memory only)</span></label>
        <input id="default-speaker" value={defaultSpeakerId} onChange={(event) => setDefaultSpeakerId(event.target.value)} placeholder="narrator" />
      </div>

      <div className="parse-status" aria-live="polite" aria-busy={state.phase === "parsing"}>
        {state.phase === "idle" ? "Paste a script, then parse it without changing the source." : null}
        {state.phase === "parsing" ? "Parsing in a browser worker…" : null}
        {state.phase === "stale" ? "Source changed while parsing. The stale result was discarded; parse again." : null}
      </div>
      {state.phase === "error" ? <div className="failure-panel" role="alert"><strong>Parser worker failed.</strong><span>{state.message} Your source is unchanged; try again.</span></div> : null}

      {result ? (
        <>
          <div className="summary-grid" aria-label="Discovery summary">
            <article><strong>{result.summary.speakerCount}</strong><span>Speakers</span></article>
            <article><strong>{result.summary.pauseIdCount}</strong><span>Pause IDs</span></article>
            <article><strong>{result.summary.sectionCount}</strong><span>Sections</span></article>
            <article><strong>{result.summary.speechSegmentCount}</strong><span>Speech segments</span></article>
            <article><strong>{result.summary.explicitPauseSegmentCount}</strong><span>Explicit pauses</span></article>
            <article><strong>{result.summary.pronunciationAnnotationCount}</strong><span>Annotations</span></article>
          </div>

          {result.errors.length > 0 ? <section className="diagnostic-list errors" aria-labelledby="parse-errors" role="alert"><h3 id="parse-errors">Blocking errors ({result.errors.length})</h3>{result.errors.map((item) => <article key={`${item.line}:${item.column}:${item.code}`}><strong>Line {item.line}, column {item.column} · {item.code}</strong><span>{item.message}</span><code>{item.offendingText}</code>{item.ignorePattern !== item.offendingText ? <span>Ignore pattern: <code>{item.ignorePattern}</code></span> : null}<em>{item.suggestion}</em><button type="button" onClick={() => ignoreDiagnostic({ code: item.code, pattern: item.ignorePattern })}>Ignore this pattern</button></article>)}</section> : null}
          {result.warnings.length > 0 ? <section className="diagnostic-list warnings" aria-labelledby="parse-warnings"><h3 id="parse-warnings">Warnings ({result.warnings.length})</h3>{result.warnings.map((item) => <article key={`${item.line}:${item.column}:${item.code}`}><strong>Line {item.line}, column {item.column} · {item.code}</strong><span>{item.message}</span><em>{item.suggestion}</em></article>)}</section> : null}

          {ignoredDiagnostics.length > 0 ? <section className="diagnostic-list ignored" aria-labelledby="ignored-errors"><h3 id="ignored-errors">Ignored error patterns ({ignoredDiagnostics.length})</h3><p>Every matching pattern is ignored for this Script Lab session, regardless of its surrounding sentence. Durable personal preferences arrive in G04.</p>{ignoredDiagnostics.map((item) => <article key={`${item.code}:${item.pattern}`}><strong>{item.code}</strong><code>{item.pattern}</code><button type="button" onClick={() => restoreDiagnostic(item)}>Restore this pattern</button></article>)}</section> : null}

          <div className="node-table-wrap">
            <table>
              <caption>Ordered canonical nodes</caption>
              <thead><tr><th scope="col">#</th><th scope="col">Type</th><th scope="col">Source line</th><th scope="col">Content</th></tr></thead>
              <tbody>{result.nodes.map((node) => <tr key={node.ordinal}><td>{node.ordinal}</td><td>{node.type}</td><td>{node.range.start.line}</td><td>{nodeContent(node)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
