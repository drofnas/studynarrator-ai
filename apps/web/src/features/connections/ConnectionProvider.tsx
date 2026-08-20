import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ConnectionSetupState,
  ConnectionTestOverall,
  ConnectionTestSummary,
  RedactedConnectionDiagnostics,
  SpeechCatalogDiscoveryInput,
  SpeechBackendConnection,
  SpeechBackendConnectionAuthoring,
  SpeechBackendConnectionClient,
  SpeechCatalog,
  VoiceCatalog,
  VoiceCatalogClient,
} from "@studynarrator/shared-types";

export type ShellConnectionState = ConnectionTestOverall | "testing";
type SpeechCatalogLoadState =
  | { status: "idle" | "loading"; catalog: null; error: "" }
  | { status: "ready"; catalog: SpeechCatalog; error: "" }
  | { status: "failed"; catalog: null; error: string };

const idleSpeechCatalog: SpeechCatalogLoadState = {
  status: "idle",
  catalog: null,
  error: "",
};
const recoveryDelays = [250, 500, 1_000, 2_000, 5_000] as const;

interface ConnectionWorkspace {
  connection: SpeechBackendConnection | null;
  setup: ConnectionSetupState | null;
  loading: boolean;
  error: string;
  testing: boolean;
  shellState: ShellConnectionState;
  catalog: SpeechCatalogLoadState;
  refresh(): Promise<void>;
  update(
    input: SpeechBackendConnectionAuthoring,
  ): Promise<SpeechBackendConnection>;
  test(): Promise<ConnectionTestSummary>;
  discover(input: SpeechCatalogDiscoveryInput): Promise<SpeechCatalog>;
  exportDiagnostics(): Promise<RedactedConnectionDiagnostics>;
  completeOnboarding(): Promise<void>;
  getCatalog(modelId: string): Promise<VoiceCatalog>;
  replaceCatalog(input: VoiceCatalog): Promise<VoiceCatalog>;
}

const Context = createContext<ConnectionWorkspace | null>(null);

function stateFor(
  connection: SpeechBackendConnection | null,
  testing: boolean,
): ShellConnectionState {
  if (testing) return "testing";
  if (!connection?.configured) return "configurationError";
  return connection.lastTestSummary?.overall ?? "disconnected";
}

export function ConnectionProvider({
  connectionClient,
  voiceCatalog,
  children,
}: {
  connectionClient: SpeechBackendConnectionClient;
  voiceCatalog: VoiceCatalogClient;
  children: ReactNode;
}) {
  const [connection, setConnection] = useState<SpeechBackendConnection | null>(
    null,
  );
  const [setup, setSetup] = useState<ConnectionSetupState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [catalog, setCatalog] =
    useState<SpeechCatalogLoadState>(idleSpeechCatalog);
  const mountedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const connectionLoadedRef = useRef(false);
  const setupLoadedRef = useRef(false);
  const needsRecoveryRef = useRef(true);
  const inFlightRef = useRef<Promise<boolean> | undefined>(undefined);
  const recoveryTimerRef = useRef<number | undefined>(undefined);
  const scheduleRecoveryRef = useRef<(() => void) | undefined>(undefined);

  const loadPersistedState = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return await inFlightRef.current;
    const lifecycle = lifecycleRef.current;
    const request = Promise.allSettled([
      connectionClient.get(),
      connectionClient.getSetupState(),
    ]).then(([connectionResult, setupResult]) => {
      if (!mountedRef.current || lifecycleRef.current !== lifecycle)
        return false;
      const failures: unknown[] = [];
      if (connectionResult.status === "fulfilled") {
        connectionLoadedRef.current = true;
        setConnection(connectionResult.value);
      } else failures.push(connectionResult.reason);
      if (setupResult.status === "fulfilled") {
        setupLoadedRef.current = true;
        setSetup(setupResult.value);
      } else failures.push(setupResult.reason);

      const completeAttempt = failures.length === 0;
      const hasPersistedState =
        connectionLoadedRef.current && setupLoadedRef.current;
      needsRecoveryRef.current = !completeAttempt;
      setLoading(!hasPersistedState);
      if (completeAttempt) {
        if (recoveryTimerRef.current !== undefined)
          window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = undefined;
        setError("");
      } else {
        const reason = failures[0];
        setError(
          reason instanceof Error
            ? reason.message
            : "Connection settings could not be loaded.",
        );
      }
      return completeAttempt;
    });
    inFlightRef.current = request;
    void request.finally(() => {
      if (inFlightRef.current === request) inFlightRef.current = undefined;
    });
    return await request;
  }, [connectionClient]);

  const refresh = useCallback(async () => {
    if (!(await loadPersistedState())) scheduleRecoveryRef.current?.();
  }, [loadPersistedState]);

  useEffect(() => {
    const lifecycle = lifecycleRef.current + 1;
    lifecycleRef.current = lifecycle;
    mountedRef.current = true;
    let stopped = false;
    let recoveryAttempt = 0;

    const clearRecoveryTimer = () => {
      if (recoveryTimerRef.current !== undefined)
        window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = undefined;
    };
    const attemptRecovery = async () => {
      const complete = await loadPersistedState();
      if (stopped || lifecycleRef.current !== lifecycle || complete) return;
      clearRecoveryTimer();
      const delay =
        recoveryDelays[Math.min(recoveryAttempt, recoveryDelays.length - 1)]!;
      recoveryAttempt += 1;
      recoveryTimerRef.current = window.setTimeout(() => {
        void attemptRecovery();
      }, delay);
    };
    const scheduleRecovery = () => {
      if (
        stopped ||
        !needsRecoveryRef.current ||
        recoveryTimerRef.current !== undefined
      )
        return;
      const delay =
        recoveryDelays[Math.min(recoveryAttempt, recoveryDelays.length - 1)]!;
      recoveryAttempt += 1;
      recoveryTimerRef.current = window.setTimeout(() => {
        void attemptRecovery();
      }, delay);
    };
    const retryNow = () => {
      if (!needsRecoveryRef.current) return;
      clearRecoveryTimer();
      void attemptRecovery();
    };

    scheduleRecoveryRef.current = scheduleRecovery;
    window.addEventListener("online", retryNow);
    window.addEventListener("focus", retryNow);
    void attemptRecovery();
    return () => {
      stopped = true;
      mountedRef.current = false;
      lifecycleRef.current += 1;
      inFlightRef.current = undefined;
      scheduleRecoveryRef.current = undefined;
      clearRecoveryTimer();
      window.removeEventListener("online", retryNow);
      window.removeEventListener("focus", retryNow);
    };
  }, [loadPersistedState]);

  const value = useMemo<ConnectionWorkspace>(
    () => ({
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
        connectionLoadedRef.current = true;
        setConnection(updated);
        setError("");
        return updated;
      },
      async test() {
        setTesting(true);
        try {
          const result = await connectionClient.test();
          if (
            result.overall === "connected" &&
            setup?.onboardingCompletedAt === null
          ) {
            const nextSetup = await connectionClient.completeOnboarding();
            setupLoadedRef.current = true;
            setSetup(nextSetup);
          }
          await refresh();
          return result;
        } finally {
          setTesting(false);
        }
      },
      async discover(input) {
        setCatalog({ status: "loading", catalog: null, error: "" });
        try {
          const discovered =
            await connectionClient.discoverSpeechCatalog(input);
          setCatalog({ status: "ready", catalog: discovered, error: "" });
          return discovered;
        } catch (reason) {
          const message =
            reason instanceof Error
              ? reason.message
              : "Supported models and voices could not be loaded.";
          setCatalog({ status: "failed", catalog: null, error: message });
          throw reason;
        }
      },
      exportDiagnostics: async () => await connectionClient.exportDiagnostics(),
      async completeOnboarding() {
        const nextSetup = await connectionClient.completeOnboarding();
        setupLoadedRef.current = true;
        setSetup(nextSetup);
      },
      getCatalog: async (modelId) => await voiceCatalog.get(modelId),
      replaceCatalog: async (input) => await voiceCatalog.replace(input),
    }),
    [
      catalog,
      connection,
      connectionClient,
      error,
      loading,
      refresh,
      setup,
      testing,
      voiceCatalog,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConnections(): ConnectionWorkspace {
  const value = useContext(Context);
  if (!value) throw new Error("ConnectionProvider is missing.");
  return value;
}
