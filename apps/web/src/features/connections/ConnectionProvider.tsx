import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ConnectionProfile,
  ConnectionProfileMutation,
  ConnectionSetupState,
  ConnectionTestOverall,
  ConnectionTestSummary,
  ConnectionsClient,
  RedactedConnectionDiagnostics,
  SpeechCatalog,
  VoiceCatalog,
  VoiceCatalogClient
} from "@studynarrator/shared-types";

export type ShellConnectionState = ConnectionTestOverall | "testing";
export type SpeechCatalogLoadState =
  | { status: "idle" | "loading"; catalog: null; error: "" }
  | { status: "ready"; catalog: SpeechCatalog; error: "" }
  | { status: "failed"; catalog: null; error: string };

const idleSpeechCatalog: SpeechCatalogLoadState = { status: "idle", catalog: null, error: "" };

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
  speechCatalog(profileId: string): SpeechCatalogLoadState;
  loadSpeechCatalog(this: void, profileId: string, force?: boolean): Promise<SpeechCatalog>;
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
  const [speechCatalogs, setSpeechCatalogs] = useState<Record<string, SpeechCatalogLoadState>>({});
  const speechCatalogCache = useRef(new Map<string, SpeechCatalog>());
  const speechCatalogPending = useRef(new Map<string, Promise<SpeechCatalog>>());
  const speechCatalogGeneration = useRef(new Map<string, number>());

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

  const loadSpeechCatalog = useCallback(async (profileId: string, force = false): Promise<SpeechCatalog> => {
    const cached = speechCatalogCache.current.get(profileId);
    if (!force && cached) return cached;
    const pending = speechCatalogPending.current.get(profileId);
    if (!force && pending) return await pending;
    const generation = (speechCatalogGeneration.current.get(profileId) ?? 0) + 1;
    speechCatalogGeneration.current.set(profileId, generation);
    if (force) speechCatalogCache.current.delete(profileId);
    setSpeechCatalogs((current) => ({ ...current, [profileId]: { status: "loading", catalog: null, error: "" } }));
    const request = connections.discoverSpeechCatalog(profileId);
    speechCatalogPending.current.set(profileId, request);
    try {
      const catalog = await request;
      if (speechCatalogGeneration.current.get(profileId) === generation) {
        speechCatalogCache.current.set(profileId, catalog);
        setSpeechCatalogs((current) => ({ ...current, [profileId]: { status: "ready", catalog, error: "" } }));
      }
      return catalog;
    } catch (reason) {
      if (speechCatalogGeneration.current.get(profileId) === generation) {
        const error = reason instanceof Error ? reason.message : "Supported voices could not be loaded.";
        setSpeechCatalogs((current) => ({ ...current, [profileId]: { status: "failed", catalog: null, error } }));
      }
      throw reason;
    } finally {
      if (speechCatalogPending.current.get(profileId) === request) speechCatalogPending.current.delete(profileId);
    }
  }, [connections]);

  useEffect(() => {
    if (loading || !setup?.activeProfileId) return;
    void loadSpeechCatalog(setup.activeProfileId).catch(() => undefined);
  }, [loadSpeechCatalog, loading, setup?.activeProfileId]);

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
        void loadSpeechCatalog(created.id, true).catch(() => undefined);
        return created;
      },
      async replace(profileId, input) {
        const replaced = await connections.replace(profileId, input);
        await refresh();
        void loadSpeechCatalog(profileId, true).catch(() => undefined);
        return replaced;
      },
      async delete(profileId) {
        await connections.delete(profileId);
        speechCatalogCache.current.delete(profileId);
        speechCatalogPending.current.delete(profileId);
        speechCatalogGeneration.current.set(profileId, (speechCatalogGeneration.current.get(profileId) ?? 0) + 1);
        setSpeechCatalogs((current) => {
          const remaining = { ...current };
          delete remaining[profileId];
          return remaining;
        });
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
          void loadSpeechCatalog(profileId, true).catch(() => undefined);
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
      speechCatalog: (profileId) => speechCatalogs[profileId] ?? idleSpeechCatalog,
      loadSpeechCatalog,
      getCatalog: async (modelId) => await voiceCatalog.get(modelId),
      async replaceCatalog(input) {
        return await voiceCatalog.replace(input);
      }
    };
  }, [connections, error, loadSpeechCatalog, loading, profiles, refresh, setup, speechCatalogs, testingProfileId, voiceCatalog]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConnections(): ConnectionWorkspace {
  const value = useContext(Context);
  if (!value) throw new Error("ConnectionProvider is missing.");
  return value;
}
