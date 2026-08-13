import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { App } from "@/app/App.js";
import { resolveSystemClient } from "@/services/system/systemClient.js";
import { resolvePersistenceClient } from "@/services/persistence/persistenceClient.js";
import { resolveConnectionsClient, resolveVoiceCatalogClient } from "@/services/connections/connectionsClient.js";
import { createScriptAnalysisWorkerClient } from "@/workers/parser/parserClient.js";
import { resolveScratchpadClient } from "@/services/scratchpad/scratchpadClient.js";
import { resolveProjectPreviewClient, resolveSpeechCacheClient } from "@/services/preview/previewClient.js";
import { resolveRenderPlanClient } from "@/services/renderPlans/renderPlanClient.js";
import { resolveRenderClient } from "@/services/renders/renderClient.js";

const root = document.getElementById("root");
if (!root) throw new Error("StudyNarrator root element is missing");

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <App analyzer={createScriptAnalysisWorkerClient()} client={resolveSystemClient()} persistence={resolvePersistenceClient()} connections={resolveConnectionsClient()} voiceCatalog={resolveVoiceCatalogClient()} scratchpad={resolveScratchpadClient()} projectPreview={resolveProjectPreviewClient()} speechCache={resolveSpeechCacheClient()} renderPlans={resolveRenderPlanClient()} renders={resolveRenderClient()} />
    </HashRouter>
  </StrictMode>
);
