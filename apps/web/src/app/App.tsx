import type { SystemClient } from "@studynarrator/shared-types";
import { AppRoutes } from "./routes.js";
import type { ScriptParser } from "@/parser-client.js";
import "@/styles.css";

export interface AppProps {
  client: SystemClient;
  parser: ScriptParser;
}

export function App({ client, parser }: AppProps) {
  return <AppRoutes client={client} parser={parser} />;
}
