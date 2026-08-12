import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { App } from "@/app/App.js";
import { resolveSystemClient } from "@/services/system/systemClient.js";
import { resolvePersistenceClient } from "@/services/persistence/persistenceClient.js";
import { createScriptAnalysisWorkerClient } from "@/workers/parser/parserClient.js";

const root = document.getElementById("root");
if (!root) throw new Error("StudyNarrator root element is missing");

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <App analyzer={createScriptAnalysisWorkerClient()} client={resolveSystemClient()} persistence={resolvePersistenceClient()} />
    </HashRouter>
  </StrictMode>
);
