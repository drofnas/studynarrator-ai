import { isIP } from "node:net";
import {
  APPLICATION_VERSION,
  ConnectionProfileAuthoringSchema,
  ConnectionProfileCollectionSchema,
  ConnectionProfileMutationSchema,
  ConnectionProfileSchema,
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
  ENVIRONMENT_CONNECTION_PROFILE_ID,
  RedactedConnectionDiagnosticsSchema,
  SpeechCatalogSchema,
  VoiceCatalogSchema,
  type ConnectionProfile,
  type ConnectionProfileAuthoring,
  type ConnectionProfileMutation,
  type ConnectionSetupState,
  type ConnectionTestSummary,
  type ConnectionsClient,
  type RedactedConnectionDiagnostics,
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

export const ENVIRONMENT_CREDENTIAL_REFERENCE = "environment:SPEACHES_API_KEY";
const DEFAULT_MODEL_ID = "speaches-ai/Kokoro-82M-v1.0-ONNX";
const DEFAULT_VOICE_ID = "af_heart";

export interface ConnectionRepository {
  listConnectionProfiles(): ConnectionProfile[];
  getConnectionProfile(profileId: string): ConnectionProfile;
  createConnectionProfile(input: ConnectionProfileAuthoring): ConnectionProfile;
  replaceConnectionProfile(profileId: string, input: ConnectionProfileAuthoring): ConnectionProfile;
  deleteConnectionProfile(profileId: string): void;
  getConnectionCredentialReference(profileId: string): string | null;
  setConnectionCredentialReference(profileId: string, reference: string | null): ConnectionProfile;
  setConnectionSuppliedUrlForm(profileId: string, suppliedUrlForm: "root" | "v1" | "unconfigured"): ConnectionProfile;
  upsertEnvironmentConnectionProfile(input: ConnectionProfileAuthoring, credentialReference: string | null): ConnectionProfile;
  recordConnectionTest(profileId: string, summary: ConnectionTestSummary): ConnectionProfile;
  getConnectionSetup(): { activeProfileId: string | null; onboardingCompletedAt: string | null };
  setActiveConnectionProfile(profileId: string | null): { activeProfileId: string | null; onboardingCompletedAt: string | null };
  completeConnectionOnboarding(): { activeProfileId: string | null; onboardingCompletedAt: string | null };
  getVoiceCatalogOverrides(modelId: string): VoiceCatalog;
  replaceVoiceCatalogOverrides(input: VoiceCatalogAuthoring): VoiceCatalog;
}

export interface CredentialStore {
  readonly replacementAllowed: boolean;
  read(reference: string): Promise<string | null>;
  write(profileId: string, apiKey: string): Promise<string>;
  delete(reference: string): Promise<void>;
}

export interface ConnectionRuntimeContext {
  client: "web" | "electron";
  nodeVersion: string;
  electronVersion: string | null;
  activeProfileLocked: boolean;
}

export interface ConnectionDiagnosticRunner {
  (input: Parameters<typeof diagnoseSpeaches>[0]): Promise<SpeachesDiagnosticResult>;
}

export interface ConnectionCatalogRunner {
  (input: SpeachesCatalogInput): Promise<SpeechCatalog>;
}

export class ConnectionPolicyError extends Error {
  readonly code = "CONNECTION_POLICY";
}

export class ConnectionConfigurationError extends Error {
  readonly code = "CONNECTION_CONFIGURATION";
}

export type ConnectionCatalogErrorCode =
  | "CONNECTION_CATALOG_ABORTED"
  | "CONNECTION_CATALOG_AUTHENTICATION"
  | "CONNECTION_CATALOG_CONFIGURATION"
  | "CONNECTION_CATALOG_INVALID_RESPONSE"
  | "CONNECTION_CATALOG_UNAVAILABLE";

export class ConnectionCatalogError extends Error {
  constructor(readonly code: ConnectionCatalogErrorCode, message: string) {
    super(message);
  }
}

function safeCatalogError(error: unknown): ConnectionCatalogError {
  if (error instanceof ConnectionCatalogError) return error;
  if (error instanceof SpeachesCatalogError) {
    switch (error.code) {
      case "aborted": return new ConnectionCatalogError("CONNECTION_CATALOG_ABORTED", "Speech catalog discovery was cancelled.");
      case "authenticationRequired": return new ConnectionCatalogError("CONNECTION_CATALOG_AUTHENTICATION", "Speaches rejected authentication. Test the profile and update its API key.");
      case "configurationError": return new ConnectionCatalogError("CONNECTION_CATALOG_CONFIGURATION", "The selected connection profile needs a valid Speaches URL.");
      case "invalidResponse": return new ConnectionCatalogError("CONNECTION_CATALOG_INVALID_RESPONSE", "Speaches returned invalid speech-model metadata.");
      case "unavailable": return new ConnectionCatalogError("CONNECTION_CATALOG_UNAVAILABLE", "The configured Speaches service is unavailable. Check the connection and retry.");
    }
  }
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "PERSISTENCE_NOT_FOUND") {
    return new ConnectionCatalogError("CONNECTION_CATALOG_CONFIGURATION", "The selected connection profile no longer exists.");
  }
  return new ConnectionCatalogError("CONNECTION_CATALOG_UNAVAILABLE", "StudyNarrator could not discover supported speech models and voices.");
}

function authoring(profile: ConnectionProfile): ConnectionProfileAuthoring {
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    defaultModelId: profile.defaultModelId,
    defaultVoiceId: profile.defaultVoiceId,
    timeoutSeconds: profile.timeoutSeconds,
    retryCount: profile.retryCount,
    responseFormat: profile.responseFormat
  };
}

function normalizeAuthoring(inputValue: ConnectionProfileAuthoring): {
  profile: ConnectionProfileAuthoring;
  suppliedUrlForm: "root" | "v1" | "unconfigured";
} {
  const input = ConnectionProfileAuthoringSchema.parse(inputValue);
  const normalized = input.baseUrl === null ? null : normalizeSpeachesUrl(input.baseUrl);
  return { profile: {
    ...(input.id === undefined ? {} : { id: input.id }),
    name: input.name,
    baseUrl: normalized?.rootUrl ?? null,
    defaultModelId: input.defaultModelId,
    defaultVoiceId: input.defaultVoiceId,
    timeoutSeconds: input.timeoutSeconds,
    retryCount: input.retryCount,
    responseFormat: input.responseFormat
  }, suppliedUrlForm: normalized?.suppliedForm ?? "unconfigured" };
}

function publicProfile(profile: ConnectionProfile, context: ConnectionRuntimeContext): ConnectionProfile {
  const apiKeyConfigured = profile.apiKeyConfigured;
  return ConnectionProfileSchema.parse({
    ...profile,
    editable: profile.source === "saved",
    credentialEntryAllowed: profile.source === "saved" && context.client === "electron",
    configured: profile.baseUrl !== null && profile.defaultModelId !== null && profile.defaultVoiceId !== null,
    apiKeyConfigured
  });
}

function setupState(
  state: { activeProfileId: string | null; onboardingCompletedAt: string | null },
  context: ConnectionRuntimeContext
): ConnectionSetupState {
  return ConnectionSetupStateSchema.parse({ ...state, activeProfileLocked: context.activeProfileLocked, client: context.client });
}

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first = -1, second = -1] = parts;
  return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254);
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

export function createConnectionsService(dependencies: {
  repository: ConnectionRepository;
  credentials: CredentialStore;
  context: ConnectionRuntimeContext;
  diagnose?: ConnectionDiagnosticRunner;
  discoverCatalog?: ConnectionCatalogRunner;
}): ConnectionsClient {
  const diagnose = dependencies.diagnose ?? ((input) => diagnoseSpeaches(input));
  const discoverCatalog = dependencies.discoverCatalog ?? ((input) => discoverSpeachesSpeechCatalog(input));
  const get = (profileId: string) => dependencies.repository.getConnectionProfile(profileId);
  const decorate = (profile: ConnectionProfile) => publicProfile(profile, dependencies.context);

  async function rollbackProfile(profile: ConnectionProfile, reference: string | null, secret: string | null): Promise<void> {
    dependencies.repository.replaceConnectionProfile(profile.id, authoring(profile));
    dependencies.repository.setConnectionSuppliedUrlForm(profile.id, profile.suppliedUrlForm);
    const restoredReference = reference && secret ? await dependencies.credentials.write(profile.id, secret) : reference;
    dependencies.repository.setConnectionCredentialReference(profile.id, restoredReference);
  }

  return {
    list() {
      return Promise.resolve().then(() => ConnectionProfileCollectionSchema.parse(dependencies.repository.listConnectionProfiles().map(decorate)));
    },
    async create(inputValue: ConnectionProfileMutation) {
      const input = ConnectionProfileMutationSchema.parse(inputValue);
      if (input.credential.action === "replace" && !dependencies.credentials.replacementAllowed) {
        throw new ConnectionPolicyError("API keys cannot be entered through the Web client.");
      }
      const normalized = normalizeAuthoring(input.profile);
      const profile = dependencies.repository.createConnectionProfile(normalized.profile);
      let createdReference: string | null = null;
      try {
        dependencies.repository.setConnectionSuppliedUrlForm(profile.id, normalized.suppliedUrlForm);
        if (input.credential.action === "replace") {
          createdReference = await dependencies.credentials.write(profile.id, input.credential.apiKey);
          dependencies.repository.setConnectionCredentialReference(profile.id, createdReference);
        }
        return decorate(get(profile.id));
      } catch (error) {
        if (createdReference) {
          try { await dependencies.credentials.delete(createdReference); } catch { /* startup cleanup removes an orphan */ }
        }
        try { dependencies.repository.deleteConnectionProfile(profile.id); } catch { /* preserve the original safe error */ }
        throw error;
      }
    },
    async replace(profileId, inputValue) {
      const input = ConnectionProfileMutationSchema.parse(inputValue);
      const previous = get(profileId);
      if (!previous.editable || previous.source !== "saved") throw new ConnectionPolicyError("Environment-managed fields cannot be changed.");
      if (input.credential.action === "replace" && !dependencies.credentials.replacementAllowed) {
        throw new ConnectionPolicyError("API keys cannot be entered through the Web client.");
      }
      const previousReference = dependencies.repository.getConnectionCredentialReference(profileId);
      const previousSecret = previousReference ? await dependencies.credentials.read(previousReference) : null;
      const normalized = normalizeAuthoring({ ...input.profile, id: profileId });
      dependencies.repository.replaceConnectionProfile(profileId, normalized.profile);
      dependencies.repository.setConnectionSuppliedUrlForm(profileId, normalized.suppliedUrlForm);
      try {
        if (input.credential.action === "replace") {
          const reference = await dependencies.credentials.write(profileId, input.credential.apiKey);
          dependencies.repository.setConnectionCredentialReference(profileId, reference);
        } else if (input.credential.action === "clear" && previousReference) {
          await dependencies.credentials.delete(previousReference);
          dependencies.repository.setConnectionCredentialReference(profileId, null);
        }
        return decorate(get(profileId));
      } catch (error) {
        await rollbackProfile(previous, previousReference, previousSecret);
        throw error;
      }
    },
    async delete(profileId) {
      const profile = get(profileId);
      if (profile.source !== "saved") throw new ConnectionPolicyError("Environment-managed profiles cannot be deleted.");
      const reference = dependencies.repository.getConnectionCredentialReference(profileId);
      const secret = reference ? await dependencies.credentials.read(reference) : null;
      if (reference) await dependencies.credentials.delete(reference);
      try {
        dependencies.repository.deleteConnectionProfile(profileId);
      } catch (error) {
        if (reference && secret) {
          const restoredReference = await dependencies.credentials.write(profileId, secret);
          dependencies.repository.setConnectionCredentialReference(profileId, restoredReference);
        }
        throw error;
      }
    },
    async test(profileId) {
      const profile = get(profileId);
      const reference = dependencies.repository.getConnectionCredentialReference(profileId);
      const apiKey = reference ? await dependencies.credentials.read(reference) : null;
      const diagnostic = await diagnose({
        baseUrl: profile.baseUrl ?? "",
        modelId: profile.defaultModelId,
        voiceId: profile.defaultVoiceId,
        ...(apiKey === null ? {} : { apiKey }),
        timeoutSeconds: profile.timeoutSeconds
      });
      const summary = ConnectionTestSummarySchema.parse(diagnostic.summary);
      dependencies.repository.recordConnectionTest(profileId, summary);
      return summary;
    },
    async discoverSpeechCatalog(profileId, signal) {
      try {
        const profile = get(profileId);
        if (!profile.baseUrl) {
          throw new ConnectionCatalogError("CONNECTION_CATALOG_CONFIGURATION", "The selected connection profile needs a Speaches URL.");
        }
        const reference = dependencies.repository.getConnectionCredentialReference(profileId);
        const apiKey = reference ? await dependencies.credentials.read(reference) : null;
        return SpeechCatalogSchema.parse(await discoverCatalog({
          profileId,
          baseUrl: profile.baseUrl,
          ...(apiKey === null ? {} : { apiKey }),
          timeoutSeconds: profile.timeoutSeconds,
          retryCount: profile.retryCount,
          ...(signal === undefined ? {} : { signal })
        }));
      } catch (error) {
        throw safeCatalogError(error);
      }
    },
    exportDiagnostics(profileId): Promise<RedactedConnectionDiagnostics> {
      return Promise.resolve().then(() => {
        const profile = get(profileId);
        if (!profile.lastTestSummary) throw new ConnectionConfigurationError("Test this connection before exporting diagnostics.");
        const reference = dependencies.repository.getConnectionCredentialReference(profileId);
        return RedactedConnectionDiagnosticsSchema.parse({
          schemaVersion: 1,
          applicationVersion: APPLICATION_VERSION,
          runtimeVersions: { node: dependencies.context.nodeVersion, electron: dependencies.context.electronVersion },
          profileId,
          profileSource: profile.source,
          endpointClass: classifyEndpoint(profile.baseUrl),
          suppliedUrlForm: profile.suppliedUrlForm,
          modelId: profile.defaultModelId,
          voiceId: profile.defaultVoiceId,
          apiKeyConfigured: reference !== null,
          requestCounts: requestCounts(profile.lastTestSummary),
          result: profile.lastTestSummary
        });
      });
    },
    getSetupState() {
      return Promise.resolve(setupState(dependencies.repository.getConnectionSetup(), dependencies.context));
    },
    setActiveProfile(profileId) {
      return Promise.resolve().then(() => {
        if (dependencies.context.activeProfileLocked && profileId !== ENVIRONMENT_CONNECTION_PROFILE_ID) {
          throw new ConnectionPolicyError("The environment connection is locked by this installation.");
        }
        return setupState(dependencies.repository.setActiveConnectionProfile(profileId), dependencies.context);
      });
    },
    completeOnboarding() {
      return Promise.resolve(setupState(dependencies.repository.completeConnectionOnboarding(), dependencies.context));
    }
  };
}

function environmentInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function reconcileEnvironmentConnectionProfile(repository: ConnectionRepository, environment: NodeJS.ProcessEnv): {
  activeProfileLocked: boolean;
  apiKey: string | null;
} {
  let baseUrl: string | null = null;
  let suppliedUrlForm: "root" | "v1" | "unconfigured" = "unconfigured";
  if (environment.SPEACHES_BASE_URL) {
    try {
      const normalized = normalizeSpeachesUrl(environment.SPEACHES_BASE_URL);
      baseUrl = normalized.rootUrl;
      suppliedUrlForm = normalized.suppliedForm;
    } catch { baseUrl = null; }
  }
  const apiKey = environment.SPEACHES_API_KEY?.trim() || null;
  repository.upsertEnvironmentConnectionProfile({
    id: ENVIRONMENT_CONNECTION_PROFILE_ID,
    name: "Environment Speaches",
    baseUrl,
    defaultModelId: environment.SPEACHES_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
    defaultVoiceId: environment.SPEACHES_VOICE_ID?.trim() || DEFAULT_VOICE_ID,
    timeoutSeconds: environmentInteger(environment.SPEACHES_TIMEOUT_SECONDS, 120, 1, 600),
    retryCount: environmentInteger(environment.SPEACHES_RETRY_COUNT, 2, 0, 5),
    responseFormat: "wav"
  }, apiKey ? ENVIRONMENT_CREDENTIAL_REFERENCE : null);
  repository.setConnectionSuppliedUrlForm(ENVIRONMENT_CONNECTION_PROFILE_ID, suppliedUrlForm);
  const activeProfileLocked = environment.STUDYNARRATOR_LOCK_SPEACHES_SETTINGS === "true";
  const setup = repository.getConnectionSetup();
  if (setup.activeProfileId === null || activeProfileLocked) repository.setActiveConnectionProfile(ENVIRONMENT_CONNECTION_PROFILE_ID);
  return { activeProfileLocked, apiKey };
}

export function createRoutedCredentialStore(options: {
  environmentApiKey: string | null;
  vault?: CredentialStore | undefined;
}): CredentialStore {
  return {
    replacementAllowed: options.vault?.replacementAllowed ?? false,
    async read(reference) {
      if (reference === ENVIRONMENT_CREDENTIAL_REFERENCE) return options.environmentApiKey;
      return options.vault?.read(reference) ?? null;
    },
    async write(profileId, apiKey) {
      if (!options.vault) throw new ConnectionPolicyError("API keys cannot be entered through this client.");
      return await options.vault.write(profileId, apiKey);
    },
    async delete(reference) {
      if (reference === ENVIRONMENT_CREDENTIAL_REFERENCE) throw new ConnectionPolicyError("Environment credentials cannot be changed here.");
      if (options.vault) await options.vault.delete(reference);
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
