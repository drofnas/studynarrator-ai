import { useState } from "react";
import type { SystemClient } from "@studynarrator/shared-types";
import { DiagnosticsView } from "./DiagnosticsView.js";
import type { ScriptParser } from "./parser-client.js";
import { ScriptLab } from "./ScriptLab.js";
import "./styles.css";

interface AppProps {
  client: SystemClient;
  parser: ScriptParser;
  initialView?: "script-lab" | "diagnostics";
}

export function App({ client, parser, initialView = "script-lab" }: AppProps) {
  const [view, setView] = useState(initialView);
  return (
    <main className="shell">
      <header className="masthead">
        <div><p className="eyebrow">Gate G02 · Grammar before audio</p><h1>See exactly what the script means.</h1></div>
        <p className="lede">Parse speakers, pauses, sections, and pronunciation annotations without persistence or synthesis.</p>
      </header>
      <nav className="view-nav" aria-label="StudyNarrator tools">
        <button type="button" aria-current={view === "script-lab" ? "page" : undefined} onClick={() => setView("script-lab")}>Script Lab</button>
        <button type="button" aria-current={view === "diagnostics" ? "page" : undefined} onClick={() => setView("diagnostics")}>Runtime diagnostics</button>
      </nav>
      {view === "script-lab" ? <ScriptLab parser={parser} /> : <DiagnosticsView client={client} />}
      <footer><span>StudyNarrator 0.1.0</span><span>Parser output is local, deterministic, and never sent to Speaches.</span></footer>
    </main>
  );
}
