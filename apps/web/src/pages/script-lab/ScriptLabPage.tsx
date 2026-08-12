import { CanonicalNodeTable } from "@/features/script-lab/components/CanonicalNodeTable.js";
import { DiscoverySummary } from "@/features/script-lab/components/DiscoverySummary.js";
import { IgnoredDiagnostics } from "@/features/script-lab/components/IgnoredDiagnostics.js";
import { LexiconEditor } from "@/features/script-lab/components/LexiconEditor.js";
import { ParseDiagnostics } from "@/features/script-lab/components/ParseDiagnostics.js";
import { ParseStatus } from "@/features/script-lab/components/ParseStatus.js";
import { ScriptEditor } from "@/features/script-lab/components/ScriptEditor.js";
import { TranscriptTabs } from "@/features/script-lab/components/TranscriptTabs.js";
import { TransformDiagnostics } from "@/features/script-lab/components/TransformDiagnostics.js";
import { useScriptLab } from "@/features/script-lab/useScriptLab.js";
import { ContentPanel } from "@/shared/ui/ContentPanel.js";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";

interface ScriptLabPageProps {
  analyzer: ScriptAnalyzer;
}

export function ScriptLabPage({ analyzer }: ScriptLabPageProps) {
  const lab = useScriptLab(analyzer);
  return (
    <ContentPanel
      action={<button type="button" onClick={() => void lab.runParser()} disabled={lab.state.phase === "parsing"}>{lab.state.phase === "parsing" ? "Analyzing…" : "Analyze"}</button>}
      kicker="G03 · Deterministic transformation"
      title="Script Lab"
      titleId="script-lab-title"
    >
      <ScriptEditor
        defaultSpeakerId={lab.defaultSpeakerId}
        onDefaultSpeakerIdChange={lab.setDefaultSpeakerId}
        onSourceChange={lab.setSource}
        source={lab.source}
      />
      <LexiconEditor entries={lab.entries} {...(lab.lexiconError ? { error: lab.lexiconError } : {})} onAdd={lab.addEntry} onRemove={lab.removeEntry} onReplaceFromJson={lab.replaceEntriesFromJson} onRestore={lab.restoreEntry} removedEntries={lab.removedEntries} />
      <ParseStatus state={lab.state} />
      {lab.parseResult && lab.transformResult ? (
        <>
          <DiscoverySummary summary={lab.parseResult.summary} />
          <ParseDiagnostics errors={lab.parseResult.errors} onIgnore={lab.ignoreDiagnostic} warnings={lab.parseResult.warnings} />
          <IgnoredDiagnostics items={lab.ignoredDiagnostics} onRestore={lab.restoreDiagnostic} />
          <TransformDiagnostics errors={lab.transformResult.errors} warnings={lab.transformResult.warnings} />
          <TranscriptTabs result={lab.transformResult} />
          <CanonicalNodeTable nodes={lab.parseResult.nodes} />
        </>
      ) : null}
    </ContentPanel>
  );
}
