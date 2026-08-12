import { useState } from "react";
import type { TransformScriptResult } from "@studynarrator/core";
import styles from "./TranscriptTabs.module.css";

type TabId = "source" | "readable" | "tts" | "matches";

interface TranscriptTabsProps {
  result: TransformScriptResult;
}

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "source", label: "Source" },
  { id: "readable", label: "Readable transcript" },
  { id: "tts", label: "TTS transcript" },
  { id: "matches", label: "Lexicon matches" }
];

export function TranscriptTabs({ result }: TranscriptTabsProps) {
  const [active, setActive] = useState<TabId>("source");
  return (
    <section className={styles.container} aria-labelledby="transcript-views-heading">
      <div className={styles.heading}><h3 id="transcript-views-heading">Transcript views</h3><strong className={result.synthesisReady ? styles.ready : styles.blocked}>{result.synthesisReady ? "Synthesis ready" : "Blocking issues"}</strong></div>
      <div className={styles.tabs} role="tablist" aria-label="Transcript views">
        {tabs.map((tab) => <button type="button" role="tab" aria-selected={active === tab.id} aria-controls={`panel-${tab.id}`} id={`tab-${tab.id}`} key={tab.id} onClick={() => setActive(tab.id)}>{tab.label}</button>)}
      </div>
      <div className={styles.panel} role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
        {active === "source" ? <pre aria-label="Original source">{result.source}</pre> : null}
        {active === "readable" ? <pre aria-label="Readable transcript">{result.readableTranscript}</pre> : null}
        {active === "tts" ? <pre aria-label="TTS transcript">{result.ttsTranscript}</pre> : null}
        {active === "matches" ? (
          result.matches.length === 0 ? <p>No lexicon replacements matched.</p> : (
            <table aria-label="Lexicon match audit">
              <thead><tr><th>Source</th><th>Entry</th><th>Rule</th><th>Change</th></tr></thead>
              <tbody>{result.matches.map((match) => <tr key={`${match.nodeOrdinal}:${match.sourceStartOffset}:${match.entryId}`}><td>Line {match.range.start.line}, column {match.range.start.column}<small>{match.sourceStartOffset}–{match.sourceEndOffset}</small></td><td><code>{match.entryId}</code><small>{match.scope}</small></td><td>{match.entryType}{match.senseId ? <small>Sense {match.senseId}</small> : null}</td><td>{match.originalText} → {match.replacement}</td></tr>)}</tbody>
            </table>
          )
        ) : null}
      </div>
    </section>
  );
}
