import { isIP } from "node:net";
import {
  APPLICATION_VERSION,
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
  RedactedConnectionDiagnosticsSchema,
  SpeachesCatalogDiscoveryInputSchema,
  SpeachesConnectionAuthoringSchema,
  SpeechCatalogSchema,
  VoiceCatalogSchema,
  type ConnectionSetupState,
  type ConnectionTestSummary,
  type RedactedConnectionDiagnostics,
  type SpeachesConnection,
  type SpeachesConnectionAuthoring,
  type SpeachesConnectionClient,
  type SpeechCatalog,
  type VoiceCatalog,
  type VoiceCatalogAuthoring,
  type VoiceCatalogClient
} from "@studynarrator/shared-types";
import {
  SpeachesCatalogError,
  diagnoseSpeaches,
  discoverSpeachesSpeechCatalog,
  normalizeSpeachesUrl,
  type SpeachesCatalogInput,
  type SpeachesDiagnosticResult
} from "@studynarrator/speaches-adapter";

export interface ConnectionRepository {
  getSpeachesConnection(): SpeachesConnection;
  replaceSpeachesConnection(input: SpeachesConnectionAuthoring, suppliedUrlForm: "root" | "v1" | "unconfigured"): SpeachesConnection;
  recordConnectionTest(summary: ConnectionTestSummary): SpeachesConnection;
  getConnectionSetup(): { onboardingCompletedAt: string | null };
  completeConnectionOnboarding(): { onboardingCompletedAt: string | null };
  getVoiceCatalogOverrides(modelId: string): VoiceCatalog;
  replaceVoiceCatalogOverrides(input: VoiceCatalogAuthoring): VoiceCatalog;
}

export interface ConnectionRuntimeContext {
  client: "web" | "electron";
  nodeVersion: string;
  electronVersion: string | null;
}

export interface ConnectionDiagnosticRunner { (input: Parameters<typeof diagnoseSpeaches>[0]): Promise<SpeachesDiagnosticResult> }
export interface ConnectionCatalogRunner { (input: SpeachesCatalogInput): Promise<SpeechCatalog> }

export class ConnectionConfigurationError extends Error { readonly code = "CONNECTION_CONFIGURATION" }
export type ConnectionCatalogErrorCode =
  | "CONNECTION_CATALOG_ABORTED"
  | "CONNECTION_CATALOG_AUTHENTICATION"
  | "CONNECTION_CATALOG_CONFIGURATION"
  | "CONNECTION_CATALOG_EMPTY"
  | "CONNECTION_CATALOG_INVALID_RESPONSE"
  | "CONNECTION_CATALOG_UNAVAILABLE";

export class ConnectionCatalogError extends Error {
  constructor(readonly code: ConnectionCatalogErrorCode, message: string) { super(message); }
}

function safeCatalogError(error: unknown): ConnectionCatalogError {
  if (error instanceof ConnectionCatalogError) return error;
  if (error instanceof SpeachesCatalogError) {
    switch (error.code) {
      case "aborted": return new ConnectionCatalogError("CONNECTION_CATALOG_ABORTED", "Speech catalog discovery was cancelled.");
      case "authenticationRequired": return new ConnectionCatalogError("CONNECTION_CATALOG_AUTHENTICATION", "This Speaches server requires authentication, which StudyNarrator does not support.");
      case "configurationError": return new ConnectionCatalogError("CONNECTION_CATALOG_CONFIGURATION", "Enter a valid HTTP(S) Speaches address.");
      case "invalidResponse": return new ConnectionCatalogError("CONNECTION_CATALOG_INVALID_RESPONSE", "Speaches returned invalid speech-model metadata.");
      case "unavailable": return new ConnectionCatalogError("CONNECTION_CATALOG_UNAVAILABLE", "The Speaches server is unavailable. Check its address and try again.");
    }
  }
  return new ConnectionCatalogError("CONNECTION_CATALOG_UNAVAILABLE", "StudyNarrator could not load speech models and voices from this server.");
}

function normalizeAuthoring(inputValue: SpeachesConnectionAuthoring) {
  const input = SpeachesConnectionAuthoringSchema.parse(inputValue);
  const normalized = input.baseUrl === null ? null : normalizeSpeachesUrl(input.baseUrl);
  return {
    connection: {
      baseUrl: normalized?.rootUrl ?? null,
      defaultModelId: input.defaultModelId,
      defaultVoiceId: input.defaultVoiceId,
      timeoutSeconds: input.timeoutSeconds,
      retryCount: input.retryCount,
      responseFormat: input.responseFormat
    },
    suppliedUrlForm: normalized?.suppliedForm ?? "unconfigured"
  } as const;
}

function setupState(state: { onboardingCompletedAt: string | null }, context: ConnectionRuntimeContext): ConnectionSetupState {
  return ConnectionSetupStateSchema.parse({ ...state, client: context.client });
}

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first = -1, second = -1] = parts;
  return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168) || (first === 169 && second === 254);
}

export function classifyEndpoint(baseUrl: string | null): "loopback" | "private" | "public" | "unconfigured" {
  if (!baseUrl) return "unconfigured";
  const hostname = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")) return "loopback";
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return privateIpv4(hostname) ? "private" : "public";
  if (ipVersion === 6) return /^(fc|fd|fe8|fe9|fea|feb)/u.test(hostname) ? "private" : "public";
  return hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa") ? "private" : "public";
}

function requestCounts(summary: ConnectionTestSummary) {
  const status = (name: ConnectionTestSummary["stages"][number]["stage"]) => summary.stages.find((candidate) => candidate.stage === name)?.status;
  return {
    health: status("http") === "skipped" ? 0 : 1,
    models: status("authentication") === "skipped" ? 0 : 1,
    voices: status("voice") === "skipped" && summary.stages.find((candidate) => candidate.stage === "voice")?.code === "not-run" ? 0 : 1,
    speech: status("audio") === "skipped" ? 0 : 1
  };
}

export function createConnectionService(dependencies: {
  repository: ConnectionRepository;
  context: ConnectionRuntimeContext;
  diagnose?: ConnectionDiagnosticRunner;
  discoverCatalog?: ConnectionCatalogRunner;
}): SpeachesConnectionClient {
  const diagnose = dependencies.diagnose ?? ((input) => diagnoseSpeaches(input));
  const discoverCatalog = dependencies.discoverCatalog ?? ((input) => discoverSpeachesSpeechCatalog(input));
  return {
    get: () => Promise.resolve(dependencies.repository.getSpeachesConnection()),
    update(inputValue) {
      return Promise.resolve().then(() => {
        const normalized = normalizeAuthoring(inputValue);
        return dependencies.repository.replaceSpeachesConnection(normalized.connection, normalized.suppliedUrlForm);
      });
    },
    async test() {
      const connection = dependencies.repository.getSpeachesConnection();
      const diagnostic = await diagnose({
        baseUrl: connection.baseUrl ?? "",
        modelId: connection.defaultModelId,
        voiceId: connection.defaultVoiceId,
        timeoutSeconds: connection.timeoutSeconds
      });
      const summary = ConnectionTestSummarySchema.parse(diagnostic.summary);
      dependencies.repository.recordConnectionTest(summary);
      return summary;
    },
    async discoverSpeechCatalog(inputValue, signal) {
      try {
        const input = SpeachesCatalogDiscoveryInputSchema.parse(inputValue);
        const normalized = normalizeSpeachesUrl(input.baseUrl);
        const catalog = SpeechCatalogSchema.parse(await discoverCatalog({
          baseUrl: normalized.rootUrl,
          timeoutSeconds: input.timeoutSeconds,
          retryCount: input.retryCount,
          ...(signal === undefined ? {} : { signal })
        }));
        if (catalog.models.length === 0) throw new ConnectionCatalogError("CONNECTION_CATALOG_EMPTY", "This Speaches server did not report any speech models.");
        return catalog;
      } catch (error) { throw safeCatalogError(error); }
    },
    exportDiagnostics(): Promise<RedactedConnectionDiagnostics> {
      return Promise.resolve().then(() => {
        const connection = dependencies.repository.getSpeachesConnection();
        if (!connection.lastTestSummary) throw new ConnectionConfigurationError("Test this connection before exporting diagnostics.");
        return RedactedConnectionDiagnosticsSchema.parse({
          schemaVersion: 1,
          applicationVersion: APPLICATION_VERSION,
          runtimeVersions: { node: dependencies.context.nodeVersion, electron: dependencies.context.electronVersion },
          endpointClass: classifyEndpoint(connection.baseUrl),
          suppliedUrlForm: connection.suppliedUrlForm,
          modelId: connection.defaultModelId,
          voiceId: connection.defaultVoiceId,
          requestCounts: requestCounts(connection.lastTestSummary),
          result: connection.lastTestSummary
        });
      });
    },
    getSetupState: () => Promise.resolve(setupState(dependencies.repository.getConnectionSetup(), dependencies.context)),
    completeOnboarding() {
      return Promise.resolve(setupState(dependencies.repository.completeConnectionOnboarding(), dependencies.context));
    }
  };
}

export function createVoiceCatalogService(dependencies: {
  repository: ConnectionRepository;
  bundledCatalogs: ReadonlyMap<string, VoiceCatalog>;
}): VoiceCatalogClient {
  const merge = (modelId: string): VoiceCatalog => {
    const bundled = dependencies.bundledCatalogs.get(modelId) ?? VoiceCatalogSchema.parse({ schemaVersion: 1, modelId, entries: [] });
    const overrides = dependencies.repository.getVoiceCatalogOverrides(modelId);
    const entries = new Map(bundled.entries.map((entry) => [entry.voiceId, entry]));
    for (const entry of overrides.entries) entries.set(entry.voiceId, entry);
    return VoiceCatalogSchema.parse({ schemaVersion: 1, modelId, entries: [...entries.values()] });
  };
  return {
    get(modelId) { return Promise.resolve(merge(modelId)); },
    replace(inputValue) {
      const input = VoiceCatalogSchema.parse(inputValue);
      dependencies.repository.replaceVoiceCatalogOverrides(input);
      return Promise.resolve(merge(input.modelId));
    }
  };
}
