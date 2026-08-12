import { Navigate, Route, Routes } from "react-router";
import type { SystemClient } from "@studynarrator/shared-types";
import { DiagnosticsView } from "@/DiagnosticsView.js";
import { ScriptLab } from "@/ScriptLab.js";
import type { ScriptParser } from "@/workers/parser/parserClient.js";
import { AppShell } from "./AppShell.js";

export const APP_PATHS = {
  scriptLab: "/script-lab",
  diagnostics: "/diagnostics"
} as const;

interface AppRoutesProps {
  client: SystemClient;
  parser: ScriptParser;
}

export function AppRoutes({ client, parser }: AppRoutesProps) {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={APP_PATHS.scriptLab} replace />} />
        <Route path={APP_PATHS.scriptLab} element={<ScriptLab parser={parser} />} />
        <Route path={APP_PATHS.diagnostics} element={<DiagnosticsView client={client} />} />
        <Route path="*" element={<Navigate to={APP_PATHS.scriptLab} replace />} />
      </Route>
    </Routes>
  );
}
