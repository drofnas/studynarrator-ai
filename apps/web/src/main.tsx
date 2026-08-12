import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { App } from "@/app/App.js";
import { resolveSystemClient } from "@/client.js";
import { createScriptParserWorkerClient } from "@/parser-client.js";

const root = document.getElementById("root");
if (!root) throw new Error("StudyNarrator root element is missing");

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <App client={resolveSystemClient()} parser={createScriptParserWorkerClient()} />
    </HashRouter>
  </StrictMode>
);
