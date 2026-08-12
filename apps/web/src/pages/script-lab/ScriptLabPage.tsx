import { CanonicalNodeTable } from "@/features/script-lab/components/CanonicalNodeTable.js";
import { DiscoverySummary } from "@/features/script-lab/components/DiscoverySummary.js";
import { IgnoredDiagnostics } from "@/features/script-lab/components/IgnoredDiagnostics.js";
import { ParseDiagnostics } from "@/features/script-lab/components/ParseDiagnostics.js";
import { ParseStatus } from "@/features/script-lab/components/ParseStatus.js";
import { ScriptEditor } from "@/features/script-lab/components/ScriptEditor.js";
import { useScriptLab } from "@/features/script-lab/useScriptLab.js";
import { ContentPanel } from "@/shared/ui/ContentPanel.js";
import type { ScriptParser } from "@/workers/parser/parserClient.js";

interface ScriptLabPageProps {
  parser: ScriptParser;
}

export function ScriptLabPage({ parser }: ScriptLabPageProps) {
  const lab = useScriptLab(parser);
  return (
    <ContentPanel
      action={<button type="button" onClick={() => void lab.runParser()} disabled={lab.state.phase === "parsing"}>{lab.state.phase === "parsing" ? "Parsing…" : "Parse"}</button>}
      kicker="G02 · Deterministic core"
      title="Script Lab"
      titleId="script-lab-title"
    >
      <ScriptEditor
        defaultSpeakerId={lab.defaultSpeakerId}
        onDefaultSpeakerIdChange={lab.setDefaultSpeakerId}
        onSourceChange={lab.setSource}
        source={lab.source}
      />
      <ParseStatus state={lab.state} />
      {lab.result ? (
        <>
          <DiscoverySummary summary={lab.result.summary} />
          <ParseDiagnostics errors={lab.result.errors} onIgnore={lab.ignoreDiagnostic} warnings={lab.result.warnings} />
          <IgnoredDiagnostics items={lab.ignoredDiagnostics} onRestore={lab.restoreDiagnostic} />
          <CanonicalNodeTable nodes={lab.result.nodes} />
        </>
      ) : null}
    </ContentPanel>
  );
}
