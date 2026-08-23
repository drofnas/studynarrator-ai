import { lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import type {
  PersistenceClient,
  ProjectPreviewClient,
  RenderClient,
  ScratchpadClient,
  ScriptGenerationClient,
  SpeechCacheClient,
  SystemClient,
} from "@studynarrator/shared-types";
import { OnboardingPage } from "@/pages/onboarding/OnboardingPage.js";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import { AppShell } from "./AppShell.js";
import { useConnections } from "@/features/connections/ConnectionProvider.js";

const DiagnosticsPage = lazy(async () => ({
  default: (await import("@/pages/diagnostics/DiagnosticsPage.js"))
    .DiagnosticsPage,
}));
const ProjectsPage = lazy(async () => ({
  default: (await import("@/pages/projects/ProjectsPage.js")).ProjectsPage,
}));
const GeneralSettingsPage = lazy(async () => ({
  default: (await import("@/pages/settings/GeneralSettingsPage.js"))
    .GeneralSettingsPage,
}));
const LexiconSettingsPage = lazy(async () => ({
  default: (await import("@/pages/settings/LexiconSettingsPage.js"))
    .LexiconSettingsPage,
}));
const TimingsSettingsPage = lazy(async () => ({
  default: (await import("@/pages/settings/TimingsSettingsPage.js"))
    .TimingsSettingsPage,
}));
const RetentionSettingsPage = lazy(async () => ({
  default: (await import("@/pages/settings/RetentionSettingsPage.js"))
    .RetentionSettingsPage,
}));
const VoicesSettingsPage = lazy(async () => ({
  default: (await import("@/pages/settings/VoicesSettingsPage.js"))
    .VoicesSettingsPage,
}));
const ScratchpadPage = lazy(async () => ({
  default: (await import("@/pages/scratchpad/ScratchpadPage.js"))
    .ScratchpadPage,
}));
const ScriptGenerationPage = lazy(async () => ({
  default: (await import("@/pages/scriptGeneration/ScriptGenerationPage.js"))
    .ScriptGenerationPage,
}));

export const APP_PATHS = {
  projects: "/projects",
  settings: "/settings",
  settingsGeneral: "/settings/general",
  settingsVoices: "/settings/voices",
  settingsLexicon: "/settings/lexicon",
  settingsTimings: "/settings/timings",
  settingsRetention: "/settings/retention",
  diagnostics: "/diagnostics",
  onboarding: "/onboarding",
  scratchpad: "/scratchpad",
  scriptPrompts: "/script-prompts",
} as const;

interface AppRoutesProps {
  analyzer: ScriptAnalyzer;
  client: SystemClient;
  persistence: PersistenceClient;
  scratchpad: ScratchpadClient;
  projectPreview: ProjectPreviewClient;
  speechCache: SpeechCacheClient;
  renders?: RenderClient;
  scriptGeneration: ScriptGenerationClient;
}

export function AppRoutes({
  analyzer,
  client,
  persistence,
  scratchpad,
  projectPreview,
  speechCache,
  renders,
  scriptGeneration,
}: AppRoutesProps) {
  const location = useLocation();
  const connections = useConnections();
  if (
    !connections.loading &&
    connections.setup?.onboardingCompletedAt === null &&
    location.pathname !== APP_PATHS.onboarding
  ) {
    return <Navigate to={APP_PATHS.onboarding} replace />;
  }
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={APP_PATHS.projects} replace />} />
        <Route path={APP_PATHS.onboarding} element={<OnboardingPage />} />
        <Route
          path={APP_PATHS.projects}
          element={
            <ProjectsPage
              analyzer={analyzer}
              client={persistence}
              previewClient={projectPreview}
              {...(renders ? { renderClient: renders } : {})}
            />
          }
        />
        <Route
          path={`${APP_PATHS.projects}/:projectId`}
          element={
            <ProjectsPage
              analyzer={analyzer}
              client={persistence}
              previewClient={projectPreview}
              {...(renders ? { renderClient: renders } : {})}
            />
          }
        />
        <Route
          path={`${APP_PATHS.projects}/:projectId/script-generation`}
          element={
            <ScriptGenerationPage
              persistence={persistence}
              generation={scriptGeneration}
            />
          }
        />
        <Route
          path={APP_PATHS.scriptPrompts}
          element={
            <ScriptGenerationPage
              persistence={persistence}
              generation={scriptGeneration}
            />
          }
        />
        <Route
          path={APP_PATHS.settings}
          element={<Navigate to={APP_PATHS.settingsGeneral} replace />}
        />
        <Route
          path={APP_PATHS.settingsGeneral}
          element={<GeneralSettingsPage cacheClient={speechCache} />}
        />
        <Route
          path={APP_PATHS.settingsVoices}
          element={<VoicesSettingsPage scratchpadClient={scratchpad} />}
        />
        <Route
          path={APP_PATHS.settingsLexicon}
          element={<LexiconSettingsPage client={persistence} />}
        />
        <Route
          path={APP_PATHS.settingsTimings}
          element={<TimingsSettingsPage client={persistence} />}
        />
        <Route
          path={APP_PATHS.settingsRetention}
          element={<RetentionSettingsPage client={persistence} />}
        />
        <Route
          path={APP_PATHS.scratchpad}
          element={
            <ScratchpadPage client={scratchpad} persistence={persistence} />
          }
        />
        <Route
          path={APP_PATHS.diagnostics}
          element={<DiagnosticsPage client={client} />}
        />
        <Route
          path="*"
          element={<Navigate to={APP_PATHS.projects} replace />}
        />
      </Route>
    </Routes>
  );
}
