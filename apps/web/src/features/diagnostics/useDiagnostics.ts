import { useQuery } from "@tanstack/react-query";
import type {
  SystemClient,
  SystemDiagnostics,
} from "@studynarrator/shared-types";
import { queryKeys } from "@/app/queryKeys.js";

type DiagnosticsState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "loaded"; diagnostics: SystemDiagnostics }
  | { phase: "error"; message: string };

export function useDiagnostics(client: SystemClient) {
  const diagnosticsQuery = useQuery({
    queryKey: queryKeys.system.diagnostics(),
    queryFn: () => client.diagnostics(),
    enabled: false,
    retry: false,
  });
  const loading = diagnosticsQuery.isFetching;
  const state: DiagnosticsState = loading
    ? { phase: "loading" }
    : diagnosticsQuery.isError
      ? {
          phase: "error",
          message:
            diagnosticsQuery.error instanceof Error
              ? diagnosticsQuery.error.message
              : "Diagnostics could not be completed.",
        }
      : diagnosticsQuery.data
        ? { phase: "loaded", diagnostics: diagnosticsQuery.data }
        : { phase: "idle" };
  const diagnostics = state.phase === "loaded" ? state.diagnostics : undefined;

  return {
    diagnostics,
    loading,
    runDiagnostics: diagnosticsQuery.refetch,
    state,
  };
}
