import { Navigate, Route, Routes, useLocation } from "react-router";
import type { PersistenceClient, ProjectPreviewClient, RenderClient, RenderPlanClient, ScratchpadClient, ScriptGenerationClient, SpeechCacheClient, SystemClient } from "@studynarrator/shared-types";
import { DiagnosticsPage } from "@/pages/diagnostics/DiagnosticsPage.js";
import { ProjectsPage } from "@/pages/projects/ProjectsPage.js";
import { OnboardingPage } from "@/pages/onboarding/OnboardingPage.js";
import { SettingsPage } from "@/pages/settings/SettingsPage.js";
import { ScratchpadPage } from "@/pages/scratchpad/ScratchpadPage.js";
import { ScriptGenerationPage } from "@/pages/scriptGeneration/ScriptGenerationPage.js";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import { AppShell } from "./AppShell.js";
import { useConnections } from "@/features/connections/ConnectionProvider.js";

export const APP_PATHS = {
  projects: "/projects",
  settings: "/settings",
  diagnostics: "/diagnostics",
  onboarding: "/onboarding",
  scratchpad: "/scratchpad",
  scriptPrompts: "/script-prompts"
} as const;

interface AppRoutesProps {
  analyzer: ScriptAnalyzer;
  client: SystemClient;
  persistence: PersistenceClient;
  scratchpad: ScratchpadClient;
  projectPreview: ProjectPreviewClient;
  speechCache: SpeechCacheClient;
  renderPlans: RenderPlanClient;
  renders?: RenderClient;
  scriptGeneration: ScriptGenerationClient;
}

export function AppRoutes({ analyzer, client, persistence, scratchpad, projectPreview, speechCache, renderPlans, renders, scriptGeneration }: AppRoutesProps) {
  const location = useLocation();
  const connections = useConnections();
  if (!connections.loading && connections.setup?.onboardingCompletedAt === null && location.pathname !== APP_PATHS.onboarding) {
    return <Navigate to={APP_PATHS.onboarding} replace />;
  }
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={APP_PATHS.projects} replace />} />
        <Route path={APP_PATHS.onboarding} element={<OnboardingPage />} />
        <Route path={APP_PATHS.projects} element={<ProjectsPage analyzer={analyzer} client={persistence} previewClient={projectPreview} renderPlanClient={renderPlans} {...(renders ? { renderClient: renders } : {})} />} />
        <Route path={`${APP_PATHS.projects}/:projectId`} element={<ProjectsPage analyzer={analyzer} client={persistence} previewClient={projectPreview} renderPlanClient={renderPlans} {...(renders ? { renderClient: renders } : {})} />} />
        <Route path={`${APP_PATHS.projects}/:projectId/script-generation`} element={<ScriptGenerationPage persistence={persistence} generation={scriptGeneration} />} />
        <Route path={APP_PATHS.scriptPrompts} element={<ScriptGenerationPage persistence={persistence} generation={scriptGeneration} />} />
        <Route path={APP_PATHS.settings} element={<SettingsPage client={persistence} cacheClient={speechCache} scratchpadClient={scratchpad} />} />
        <Route path={APP_PATHS.scratchpad} element={<ScratchpadPage client={scratchpad} persistence={persistence} />} />
        <Route path={APP_PATHS.diagnostics} element={<DiagnosticsPage client={client} />} />
        <Route path="*" element={<Navigate to={APP_PATHS.projects} replace />} />
      </Route>
    </Routes>
  );
}
