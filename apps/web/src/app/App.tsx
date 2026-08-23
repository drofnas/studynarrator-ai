import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type {
  SpeechBackendConnectionClient,
  PersistenceClient,
  ProjectPreviewClient,
  RenderClient,
  ScratchpadClient,
  ScriptGenerationClient,
  SpeechCacheClient,
  SystemClient,
  VoiceCatalogClient,
} from "@studynarrator/shared-types";
import { ConnectionProvider } from "@/features/connections/ConnectionProvider.js";
import { PersistenceGate } from "@/features/persistence/persistenceGate.js";
import { AppRoutes } from "./routes.js";
import type { ScriptAnalyzer } from "@/workers/parser/parserClient.js";
import "./styles/global.css";

interface AppProps {
  client: SystemClient;
  persistence: PersistenceClient;
  connection: SpeechBackendConnectionClient;
  voiceCatalog: VoiceCatalogClient;
  scratchpad: ScratchpadClient;
  projectPreview: ProjectPreviewClient;
  speechCache: SpeechCacheClient;
  renders?: RenderClient;
  scriptGeneration: ScriptGenerationClient;
  analyzer: ScriptAnalyzer;
}

export function App({
  analyzer,
  client,
  persistence,
  connection,
  voiceCatalog,
  scratchpad,
  projectPreview,
  speechCache,
  renders,
  scriptGeneration,
}: AppProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <PersistenceGate persistence={persistence}>
        <ConnectionProvider
          connectionClient={connection}
          voiceCatalog={voiceCatalog}
        >
          <AppRoutes
            analyzer={analyzer}
            client={client}
            persistence={persistence}
            scratchpad={scratchpad}
            projectPreview={projectPreview}
            speechCache={speechCache}
            scriptGeneration={scriptGeneration}
            {...(renders ? { renders } : {})}
          />
        </ConnectionProvider>
      </PersistenceGate>
    </QueryClientProvider>
  );
}
