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
        {state.phase === "idle" ? "Paste a script, then parse it without changing the source." : null}
        {state.phase === "parsing" ? "Parsing in a browser worker…" : null}
        {state.phase === "stale" ? "Source changed while parsing. The stale result was discarded; parse again." : null}
      </div>
      {state.phase === "error" ? <ErrorNotice title="Parser worker failed.">{state.message} Your source is unchanged; try again.</ErrorNotice> : null}
    </>
  );
}
