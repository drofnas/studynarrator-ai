import { useState } from "react";
import type { SystemClient, SystemDiagnostics } from "@studynarrator/shared-types";

type DiagnosticsState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "loaded"; diagnostics: SystemDiagnostics }
  | { phase: "error"; message: string };

export function useDiagnostics(client: SystemClient) {
  const [state, setState] = useState<DiagnosticsState>({ phase: "idle" });
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

  return { diagnostics, loading, runDiagnostics, state };
}
