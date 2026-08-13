import type { ConnectionsClient, PersistenceClient, ScratchpadClient, SystemClient, VoiceCatalogClient } from "@studynarrator/shared-types";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";
import { ScratchpadSessionProvider } from "@/features/scratchpad/ScratchpadSessionProvider.js";
import { AppRoutes } from "./routes.js";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import "./styles/global.css";

export interface AppProps {
  client: SystemClient;
  persistence: PersistenceClient;
  connections: ConnectionsClient;
  voiceCatalog: VoiceCatalogClient;
  scratchpad: ScratchpadClient;
  analyzer: ScriptAnalyzer;
}

export function App({ analyzer, client, persistence, connections, voiceCatalog, scratchpad }: AppProps) {
  return <ConnectionProvider connections={connections} voiceCatalog={voiceCatalog}><ScratchpadSessionProvider><AppRoutes analyzer={analyzer} client={client} persistence={persistence} scratchpad={scratchpad} /></ScratchpadSessionProvider></ConnectionProvider>;
}
