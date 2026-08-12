import { useRef, useState } from "react";
import type { IgnoredDiagnostic, ParseScriptResult } from "@studynarrator/core";
import type { ScriptParser } from "@/workers/parser/parserClient.js";

export type ScriptLabState =
  | { phase: "idle" }
  | { phase: "parsing" }
  | { phase: "parsed"; result: ParseScriptResult }
  | { phase: "stale" }
  | { phase: "error"; message: string };

export function useScriptLab(parser: ScriptParser) {
  const [source, setSource] = useState("");
  const [defaultSpeakerId, setDefaultSpeakerId] = useState("");
  const [ignoredDiagnostics, setIgnoredDiagnostics] = useState<IgnoredDiagnostic[]>([]);
  const [state, setState] = useState<ScriptLabState>({ phase: "idle" });
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

  return {
    defaultSpeakerId,
    ignoreDiagnostic,
    ignoredDiagnostics,
    result: state.phase === "parsed" ? state.result : undefined,
    restoreDiagnostic,
    runParser,
    setDefaultSpeakerId,
    setSource,
    source,
    state
  };
}
