import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { resolveSystemClient } from "./client.js";
import { createScriptParserWorkerClient } from "./parser-client.js";

const root = document.getElementById("root");
if (!root) throw new Error("StudyNarrator root element is missing");

createRoot(root).render(
  <StrictMode>
    <App client={resolveSystemClient()} parser={createScriptParserWorkerClient()} />
  </StrictMode>
);
