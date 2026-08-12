import type { ScriptLabState } from "../useScriptLab.js";
import { ErrorNotice } from "@/shared/ui/ErrorNotice.js";
import styles from "./ParseStatus.module.css";

interface ParseStatusProps {
  state: ScriptLabState;
}

export function ParseStatus({ state }: ParseStatusProps) {
  return (
    <>
      <div className={styles.status} aria-live="polite" aria-busy={state.phase === "parsing"}>
        {state.phase === "idle" ? "Paste a script, configure the in-memory lexicon, then analyze it without changing the source." : null}
        {state.phase === "parsing" ? "Parsing and transforming in a browser worker…" : null}
        {state.phase === "stale" ? "Source, speaker, or lexicon input changed. The stale result was discarded; analyze again." : null}
      </div>
      {state.phase === "error" ? <ErrorNotice title="Analysis worker failed.">{state.message} Your source and lexicon are unchanged; try again.</ErrorNotice> : null}
    </>
  );
}
