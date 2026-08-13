import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  ConnectionProfile,
  ConnectionProfileMutation,
  ConnectionSetupState,
  ConnectionTestOverall,
  ConnectionTestSummary,
  ConnectionsClient,
  RedactedConnectionDiagnostics,
  VoiceCatalog,
  VoiceCatalogClient
} from "@studynarrator/shared-types";

export type ShellConnectionState = ConnectionTestOverall | "testing";

interface ConnectionWorkspace {
  profiles: ConnectionProfile[];
  setup: ConnectionSetupState | null;
  loading: boolean;
  error: string;
  testingProfileId: string | null;
  activeProfile: ConnectionProfile | null;
  shellState: ShellConnectionState;
  refresh(): Promise<void>;
  create(input: ConnectionProfileMutation): Promise<ConnectionProfile>;
  replace(profileId: string, input: ConnectionProfileMutation): Promise<ConnectionProfile>;
  delete(profileId: string): Promise<void>;
  test(profileId: string): Promise<ConnectionTestSummary>;
  exportDiagnostics(profileId: string): Promise<RedactedConnectionDiagnostics>;
  setActive(profileId: string | null): Promise<void>;
  completeOnboarding(): Promise<void>;
  getCatalog(modelId: string): Promise<VoiceCatalog>;
  replaceCatalog(input: VoiceCatalog): Promise<VoiceCatalog>;
}

const Context = createContext<ConnectionWorkspace | null>(null);

function stateFor(profile: ConnectionProfile | null, testingProfileId: string | null): ShellConnectionState {
  if (profile && testingProfileId === profile.id) return "testing";
  if (!profile || !profile.configured) return "configurationError";
  return profile.lastTestSummary?.overall ?? "disconnected";
}

export function ConnectionProvider({
  connections,
  voiceCatalog,
  children
}: {
  connections: ConnectionsClient;
  voiceCatalog: VoiceCatalogClient;
  children: ReactNode;
}) {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [setup, setSetup] = useState<ConnectionSetupState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextProfiles, nextSetup] = await Promise.all([connections.list(), connections.getSetupState()]);
      setProfiles(nextProfiles);
      setSetup(nextSetup);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [connections]);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<ConnectionWorkspace>(() => {
    const activeProfile = profiles.find(({ id }) => id === setup?.activeProfileId) ?? null;
    return {
      profiles,
      setup,
      loading,
      error,
      testingProfileId,
      activeProfile,
      shellState: stateFor(activeProfile, testingProfileId),
      refresh,
      async create(input) {
        const created = await connections.create(input);
        await refresh();
        return created;
      },
      async replace(profileId, input) {
        const replaced = await connections.replace(profileId, input);
        await refresh();
        return replaced;
      },
      async delete(profileId) {
        await connections.delete(profileId);
        await refresh();
      },
      async test(profileId) {
        setTestingProfileId(profileId);
        try {
          const result = await connections.test(profileId);
          if (result.overall === "connected" && setup?.onboardingCompletedAt === null) {
            setSetup(await connections.completeOnboarding());
          }
          await refresh();
          return result;
        } finally {
          setTestingProfileId(null);
        }
      },
      exportDiagnostics: async (profileId) => await connections.exportDiagnostics(profileId),
      async setActive(profileId) {
        setSetup(await connections.setActiveProfile(profileId));
        await refresh();
      },
      async completeOnboarding() {
        setSetup(await connections.completeOnboarding());
      },
      getCatalog: async (modelId) => await voiceCatalog.get(modelId),
      async replaceCatalog(input) {
        return await voiceCatalog.replace(input);
      }
    };
  }, [connections, error, loading, profiles, refresh, setup, testingProfileId, voiceCatalog]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConnections(): ConnectionWorkspace {
  const value = useContext(Context);
  if (!value) throw new Error("ConnectionProvider is missing.");
  return value;
}
