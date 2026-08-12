import { Navigate, Route, Routes } from "react-router";
import type { SystemClient } from "@studynarrator/shared-types";
import { DiagnosticsPage } from "@/pages/diagnostics/DiagnosticsPage.js";
import { ScriptLabPage } from "@/pages/script-lab/ScriptLabPage.js";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import { AppShell } from "./AppShell.js";

export const APP_PATHS = {
  scriptLab: "/script-lab",
  diagnostics: "/diagnostics"
} as const;

interface AppRoutesProps {
  analyzer: ScriptAnalyzer;
  client: SystemClient;
}

export function AppRoutes({ analyzer, client }: AppRoutesProps) {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={APP_PATHS.scriptLab} replace />} />
        <Route path={APP_PATHS.scriptLab} element={<ScriptLabPage analyzer={analyzer} />} />
        <Route path={APP_PATHS.diagnostics} element={<DiagnosticsPage client={client} />} />
        <Route path="*" element={<Navigate to={APP_PATHS.scriptLab} replace />} />
      </Route>
    </Routes>
  );
}
