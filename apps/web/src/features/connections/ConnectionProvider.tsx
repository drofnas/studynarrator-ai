import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  ConnectionSetupState,
  ConnectionTestOverall,
  ConnectionTestSummary,
  RedactedConnectionDiagnostics,
  SpeachesCatalogDiscoveryInput,
  SpeachesConnection,
  SpeachesConnectionAuthoring,
  SpeachesConnectionClient,
  SpeechCatalog,
  VoiceCatalog,
  VoiceCatalogClient
} from "@studynarrator/shared-types";

export type ShellConnectionState = ConnectionTestOverall | "testing";
type SpeechCatalogLoadState =
  | { status: "idle" | "loading"; catalog: null; error: "" }
  | { status: "ready"; catalog: SpeechCatalog; error: "" }
  | { status: "failed"; catalog: null; error: string };

const idleSpeechCatalog: SpeechCatalogLoadState = { status: "idle", catalog: null, error: "" };

interface ConnectionWorkspace {
  connection: SpeachesConnection | null;
  setup: ConnectionSetupState | null;
  loading: boolean;
  error: string;
  testing: boolean;
  shellState: ShellConnectionState;
  catalog: SpeechCatalogLoadState;
  refresh(): Promise<void>;
  update(input: SpeachesConnectionAuthoring): Promise<SpeachesConnection>;
  test(): Promise<ConnectionTestSummary>;
  discover(input: SpeachesCatalogDiscoveryInput): Promise<SpeechCatalog>;
  exportDiagnostics(): Promise<RedactedConnectionDiagnostics>;
  completeOnboarding(): Promise<void>;
  getCatalog(modelId: string): Promise<VoiceCatalog>;
  replaceCatalog(input: VoiceCatalog): Promise<VoiceCatalog>;
}

const Context = createContext<ConnectionWorkspace | null>(null);

function stateFor(connection: SpeachesConnection | null, testing: boolean): ShellConnectionState {
  if (testing) return "testing";
  if (!connection?.configured) return "configurationError";
  return connection.lastTestSummary?.overall ?? "disconnected";
}

export function ConnectionProvider({ connectionClient, voiceCatalog, children }: {
  connectionClient: SpeachesConnectionClient;
  voiceCatalog: VoiceCatalogClient;
  children: ReactNode;
}) {
  const [connection, setConnection] = useState<SpeachesConnection | null>(null);
  const [setup, setSetup] = useState<ConnectionSetupState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [catalog, setCatalog] = useState<SpeechCatalogLoadState>(idleSpeechCatalog);

  const refresh = useCallback(async () => {
    try {
      const [nextConnection, nextSetup] = await Promise.all([connectionClient.get(), connectionClient.getSetupState()]);
      setConnection(nextConnection);
      setSetup(nextSetup);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection settings could not be loaded.");
    } finally { setLoading(false); }
  }, [connectionClient]);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<ConnectionWorkspace>(() => ({
    connection,
    setup,
    loading,
    error,
    testing,
    shellState: stateFor(connection, testing),
    catalog,
    refresh,
    async update(input) {
      const updated = await connectionClient.update(input);
      setConnection(updated);
      return updated;
    },
    async test() {
      setTesting(true);
      try {
        const result = await connectionClient.test();
        if (result.overall === "connected" && setup?.onboardingCompletedAt === null) {
          setSetup(await connectionClient.completeOnboarding());
        }
        await refresh();
        return result;
      } finally { setTesting(false); }
    },
    async discover(input) {
      setCatalog({ status: "loading", catalog: null, error: "" });
      try {
        const discovered = await connectionClient.discoverSpeechCatalog(input);
        setCatalog({ status: "ready", catalog: discovered, error: "" });
        return discovered;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Supported models and voices could not be loaded.";
        setCatalog({ status: "failed", catalog: null, error: message });
        throw reason;
      }
    },
    exportDiagnostics: async () => await connectionClient.exportDiagnostics(),
    async completeOnboarding() { setSetup(await connectionClient.completeOnboarding()); },
    getCatalog: async (modelId) => await voiceCatalog.get(modelId),
    replaceCatalog: async (input) => await voiceCatalog.replace(input)
  }), [catalog, connection, connectionClient, error, loading, refresh, setup, testing, voiceCatalog]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConnections(): ConnectionWorkspace {
  const value = useContext(Context);
  if (!value) throw new Error("ConnectionProvider is missing.");
  return value;
}
