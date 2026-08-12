import type { SystemClient } from "@studynarrator/shared-types";
import { DiagnosticsEvidence } from "@/features/diagnostics/components/DiagnosticsEvidence.js";
import { DiagnosticsStatusRail } from "@/features/diagnostics/components/DiagnosticsStatusRail.js";
import { useDiagnostics } from "@/features/diagnostics/useDiagnostics.js";
import { ContentPanel } from "@/shared/ui/ContentPanel.js";
import { ErrorNotice } from "@/shared/ui/ErrorNotice.js";
import styles from "./DiagnosticsPage.module.css";

interface DiagnosticsPageProps {
  client: SystemClient;
}

export function DiagnosticsPage({ client }: DiagnosticsPageProps) {
  const { diagnostics, loading, runDiagnostics, state } = useDiagnostics(client);

  return (
    <ContentPanel
      action={<button type="button" onClick={() => void runDiagnostics()} disabled={loading}>{loading ? "Checking signal…" : diagnostics ? "Run again" : "Run self-test"}</button>}
      kicker="G01 · Live path"
      title="Runtime self-test"
      titleId="console-title"
    >
      <DiagnosticsStatusRail diagnostics={diagnostics} loading={loading} />
      {state.phase === "error" ? <ErrorNotice title="The diagnostic boundary did not respond.">{state.message} Check the local application process, then run the self-test again.</ErrorNotice> : null}
      {diagnostics ? <DiagnosticsEvidence diagnostics={diagnostics} /> : <p className={styles.emptyNote}>Run the self-test to create the disposable persistence marker and inspect the complete path.</p>}
    </ContentPanel>
  );
}
