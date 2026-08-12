import { useState, type ReactNode } from "react";
import type { CheckStatus, SystemClient, SystemDiagnostics } from "@studynarrator/shared-types";

interface DiagnosticsViewProps {
  client: SystemClient;
}

type ViewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "loaded"; diagnostics: SystemDiagnostics }
  | { phase: "error"; message: string };

function StatusValue({ status, children }: { status: CheckStatus | undefined; children: ReactNode }) {
  return (
    <span className={`status-value status-${status ?? "idle"}`}>
      <span className="status-lamp" aria-hidden="true" />
      {children}
    </span>
  );
}

function statusLabel(status?: CheckStatus) {
  if (!status) return "NOT RUN";
  return status.toUpperCase();
}

export function DiagnosticsView({ client }: DiagnosticsViewProps) {
  const [state, setState] = useState<ViewState>({ phase: "idle" });
  const diagnostics = state.phase === "loaded" ? state.diagnostics : undefined;
  const loading = state.phase === "loading";

  async function runDiagnostics() {
    setState({ phase: "loading" });
    try {
      setState({ phase: "loaded", diagnostics: await client.diagnostics() });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Diagnostics could not be completed."
      });
    }
  }

  const sharedStatus = diagnostics?.checks.sharedCore.status;
  const storageStatus = diagnostics?.checks.storage.status;
  const ffmpegStatus = diagnostics?.checks.ffmpeg.status;

  return (
    <section className="console" aria-labelledby="console-title">
      <div className="console-heading">
        <div>
          <p className="console-kicker">G01 · Live path</p>
          <h2 id="console-title">Runtime self-test</h2>
        </div>
        <button type="button" onClick={() => void runDiagnostics()} disabled={loading}>
          {loading ? "Checking signal…" : diagnostics ? "Run again" : "Run self-test"}
        </button>
      </div>

      <div className="signal-rail" aria-live="polite" aria-busy={loading}>
        <div className="signal-row"><span>Shared core</span><StatusValue status={sharedStatus}>{loading ? "CHECKING" : statusLabel(sharedStatus)}</StatusValue></div>
        <div className="signal-row"><span>Storage write/read</span><StatusValue status={storageStatus}>{loading ? "CHECKING" : statusLabel(storageStatus)}</StatusValue></div>
        <div className="signal-row"><span>FFmpeg</span><StatusValue status={ffmpegStatus}>{loading ? "CHECKING" : statusLabel(ffmpegStatus)}</StatusValue></div>
        <div className="signal-row metadata-row"><span>Transport</span><strong>{diagnostics?.transport.toUpperCase() ?? "—"}</strong></div>
        <div className="signal-row metadata-row"><span>Client</span><strong>{diagnostics ? (diagnostics.client === "web" ? "Web" : "Electron") : "—"}</strong></div>
      </div>

      {state.phase === "error" ? (
        <div className="failure-panel" role="alert">
          <strong>The diagnostic boundary did not respond.</strong>
          <span>{state.message} Check the local application process, then run the self-test again.</span>
        </div>
      ) : null}

      {diagnostics ? (
        <div className="evidence-grid">
          <article><p>Data directory</p><code>{diagnostics.runtime.dataDirectory}</code></article>
          <article><p>Runtime</p><code>{diagnostics.runtime.runtimeName} {diagnostics.runtime.runtimeVersion}{diagnostics.runtime.electronVersion ? ` · Electron ${diagnostics.runtime.electronVersion}` : ""}</code></article>
          <article><p>Persistent marker</p><code>{diagnostics.checks.storage.status === "pass" ? `${diagnostics.checks.storage.markerValue} · ${diagnostics.checks.storage.createdAt}` : diagnostics.checks.storage.message}</code></article>
          <article><p>Native tools</p><code>{diagnostics.checks.storage.status === "pass" ? `SQLite ${diagnostics.checks.storage.sqliteVersion}` : "SQLite unavailable"}{" · "}{diagnostics.checks.ffmpeg.status === "pass" ? diagnostics.checks.ffmpeg.version : diagnostics.checks.ffmpeg.message}</code></article>
        </div>
      ) : <p className="empty-note">Run the self-test to create the disposable persistence marker and inspect the complete path.</p>}
    </section>
  );
}
