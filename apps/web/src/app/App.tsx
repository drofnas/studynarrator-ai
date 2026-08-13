import type { ConnectionsClient, PersistenceClient, SystemClient, VoiceCatalogClient } from "@studynarrator/shared-types";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";
import { AppRoutes } from "./routes.js";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import "./styles/global.css";

export interface AppProps {
  client: SystemClient;
  persistence: PersistenceClient;
  connections: ConnectionsClient;
  voiceCatalog: VoiceCatalogClient;
  analyzer: ScriptAnalyzer;
}

export function App({ analyzer, client, persistence, connections, voiceCatalog }: AppProps) {
  return <ConnectionProvider connections={connections} voiceCatalog={voiceCatalog}><AppRoutes analyzer={analyzer} client={client} persistence={persistence} /></ConnectionProvider>;
}
