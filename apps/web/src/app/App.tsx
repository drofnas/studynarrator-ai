import type { SystemClient } from "@studynarrator/shared-types";
import { AppRoutes } from "./routes.js";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import "./styles/global.css";

export interface AppProps {
  client: SystemClient;
  analyzer: ScriptAnalyzer;
}

export function App({ analyzer, client }: AppProps) {
  return <AppRoutes analyzer={analyzer} client={client} />;
}
