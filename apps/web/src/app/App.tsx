import type { SpeachesConnectionClient, PersistenceClient, ProjectPreviewClient, RenderClient, RenderPlanClient, ScratchpadClient, ScriptGenerationClient, SpeechCacheClient, SystemClient, VoiceCatalogClient } from "@studynarrator/shared-types";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";
import { ScratchpadSessionProvider } from "@/features/scratchpad/ScratchpadSessionProvider.js";
import { AppRoutes } from "./routes.js";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import "./styles/global.css";

interface AppProps {
  client: SystemClient;
  persistence: PersistenceClient;
  connection: SpeachesConnectionClient;
  voiceCatalog: VoiceCatalogClient;
  scratchpad: ScratchpadClient;
  projectPreview: ProjectPreviewClient;
  speechCache: SpeechCacheClient;
  renderPlans: RenderPlanClient;
  renders?: RenderClient;
  scriptGeneration: ScriptGenerationClient;
  analyzer: ScriptAnalyzer;
}

export function App({ analyzer, client, persistence, connection, voiceCatalog, scratchpad, projectPreview, speechCache, renderPlans, renders, scriptGeneration }: AppProps) {
  return <ConnectionProvider connectionClient={connection} voiceCatalog={voiceCatalog}><ScratchpadSessionProvider><AppRoutes analyzer={analyzer} client={client} persistence={persistence} scratchpad={scratchpad} projectPreview={projectPreview} speechCache={speechCache} renderPlans={renderPlans} scriptGeneration={scriptGeneration} {...(renders ? { renders } : {})} /></ScratchpadSessionProvider></ConnectionProvider>;
}
