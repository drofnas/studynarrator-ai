import { Navigate, Route, Routes } from "react-router";
import type { PersistenceClient, SystemClient } from "@studynarrator/shared-types";
import { DiagnosticsPage } from "@/pages/diagnostics/DiagnosticsPage.js";
import { PersistenceLabPage } from "@/pages/persistence-lab/PersistenceLabPage.js";
import { ScriptLabPage } from "@/pages/script-lab/ScriptLabPage.js";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import { AppShell } from "./AppShell.js";

export const APP_PATHS = {
  scriptLab: "/script-lab",
  persistenceLab: "/persistence-lab",
  diagnostics: "/diagnostics"
} as const;

interface AppRoutesProps {
  analyzer: ScriptAnalyzer;
  client: SystemClient;
  persistence: PersistenceClient;
}

export function AppRoutes({ analyzer, client, persistence }: AppRoutesProps) {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={APP_PATHS.scriptLab} replace />} />
        <Route path={APP_PATHS.scriptLab} element={<ScriptLabPage analyzer={analyzer} />} />
        <Route path={APP_PATHS.persistenceLab} element={<PersistenceLabPage client={persistence} />} />
        <Route path={APP_PATHS.diagnostics} element={<DiagnosticsPage client={client} />} />
        <Route path="*" element={<Navigate to={APP_PATHS.scriptLab} replace />} />
      </Route>
    </Routes>
  );
}
