import { z } from "zod";

function hasCredentialControlLineBreak(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code === 0 || code === 10 || code === 13;
  });
}

const TimestampSchema = z.iso.datetime({ offset: true });
const NullableTimestampSchema = TimestampSchema.nullable();

export const CONNECTION_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const CONNECTION_PROFILE_DEFAULT_TIMEOUT_SECONDS = 120;
export const CONNECTION_PROFILE_DEFAULT_RETRY_COUNT = 2;
export const ENVIRONMENT_CONNECTION_PROFILE_ID = "environment-speaches";

export const ConnectionProfileSourceSchema = z.enum(["saved", "environment"]);
export type ConnectionProfileSource = z.infer<typeof ConnectionProfileSourceSchema>;

export const ConnectionTestOverallSchema = z.enum([
  "connected",
  "configurationError",
  "disconnected",
  "authenticationRequired",
  "modelUnavailable",
  "voiceUnavailable",
  "invalidAudio"
]);
export type ConnectionTestOverall = z.infer<typeof ConnectionTestOverallSchema>;

export const ConnectionDiagnosticStageNameSchema = z.enum([
  "url",
  "dns",
  "tcp",
  "http",
  "authentication",
  "model",
  "voice",
  "audio"
]);

export const ConnectionDiagnosticStageSchema = z.object({
  stage: ConnectionDiagnosticStageNameSchema,
  status: z.enum(["pass", "fail", "skipped"]),
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(1_000),
  durationMs: z.number().int().nonnegative()
}).strict();
export type ConnectionDiagnosticStage = z.infer<typeof ConnectionDiagnosticStageSchema>;

export const ConnectionTestSummarySchema = z.object({
  schemaVersion: z.literal(CONNECTION_DIAGNOSTIC_SCHEMA_VERSION),
  overall: ConnectionTestOverallSchema,
  testedAt: TimestampSchema,
  httpStatus: z.number().int().min(100).max(599).nullable(),
  stages: z.array(ConnectionDiagnosticStageSchema).length(8),
  availableModelIds: z.array(z.string().min(1).max(500)).max(2_000),
  availableVoiceIds: z.array(z.string().min(1).max(500)).max(10_000).nullable()
}).strict();
export type ConnectionTestSummary = z.infer<typeof ConnectionTestSummarySchema>;

export const ConnectionProfileAuthoringSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u).optional(),
  name: z.string().trim().min(1).max(200),
  baseUrl: z.url({ protocol: /^https?$/u }).nullable(),
  defaultModelId: z.string().trim().min(1).max(500).nullable(),
  defaultVoiceId: z.string().trim().min(1).max(500).nullable(),
  timeoutSeconds: z.number().int().min(1).max(600).default(CONNECTION_PROFILE_DEFAULT_TIMEOUT_SECONDS),
  retryCount: z.number().int().min(0).max(5).default(CONNECTION_PROFILE_DEFAULT_RETRY_COUNT),
  responseFormat: z.literal("wav").default("wav")
}).strict();
export type ConnectionProfileAuthoring = z.input<typeof ConnectionProfileAuthoringSchema>;

export const CredentialMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }).strict(),
  z.object({ action: z.literal("clear") }).strict(),
  z.object({
    action: z.literal("replace"),
    apiKey: z.string().min(1).max(8_192).refine((value) => !hasCredentialControlLineBreak(value), "API keys cannot contain control line breaks.")
  }).strict()
]);
export type CredentialMutation = z.infer<typeof CredentialMutationSchema>;

export const ConnectionProfileMutationSchema = z.object({
  profile: ConnectionProfileAuthoringSchema,
  credential: CredentialMutationSchema.default({ action: "keep" })
}).strict();
export type ConnectionProfileMutation = z.input<typeof ConnectionProfileMutationSchema>;

export const ConnectionProfileSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  baseUrl: z.url({ protocol: /^https?$/u }).nullable(),
  source: ConnectionProfileSourceSchema,
  editable: z.boolean(),
  credentialEntryAllowed: z.boolean(),
  configured: z.boolean(),
  apiKeyConfigured: z.boolean(),
  defaultModelId: z.string().min(1).max(500).nullable(),
  defaultVoiceId: z.string().min(1).max(500).nullable(),
  timeoutSeconds: z.number().int().min(1).max(600),
  retryCount: z.number().int().min(0).max(5),
  responseFormat: z.literal("wav"),
  lastTestedAt: NullableTimestampSchema,
  lastSuccessfulTestAt: NullableTimestampSchema,
  lastTestSummary: ConnectionTestSummarySchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
}).strict();
export type ConnectionProfile = z.infer<typeof ConnectionProfileSchema>;
export const ConnectionProfileCollectionSchema = z.array(ConnectionProfileSchema);

export const ConnectionSetupStateSchema = z.object({
  activeProfileId: z.string().min(1).max(128).nullable(),
  activeProfileLocked: z.boolean(),
  onboardingCompletedAt: NullableTimestampSchema,
  client: z.enum(["web", "electron"])
}).strict();
export type ConnectionSetupState = z.infer<typeof ConnectionSetupStateSchema>;

export const ConnectionProfileIdInputSchema = z.object({ profileId: z.string().min(1).max(128) }).strict();
export const ConnectionProfileMutationRequestSchema = z.object({
  profileId: z.string().min(1).max(128),
  mutation: ConnectionProfileMutationSchema
}).strict();

export const RedactedConnectionDiagnosticsSchema = z.object({
  schemaVersion: z.literal(CONNECTION_DIAGNOSTIC_SCHEMA_VERSION),
  applicationVersion: z.string().min(1),
  profileId: z.string().min(1),
  profileSource: ConnectionProfileSourceSchema,
  endpointClass: z.enum(["loopback", "private", "public", "unconfigured"]),
  suppliedUrlForm: z.enum(["root", "v1", "unconfigured"]),
  modelId: z.string().nullable(),
  voiceId: z.string().nullable(),
  apiKeyConfigured: z.boolean(),
  result: ConnectionTestSummarySchema
}).strict();
export type RedactedConnectionDiagnostics = z.infer<typeof RedactedConnectionDiagnosticsSchema>;

export interface ConnectionsClient {
  list(): Promise<ConnectionProfile[]>;
  create(input: ConnectionProfileMutation): Promise<ConnectionProfile>;
  replace(profileId: string, input: ConnectionProfileMutation): Promise<ConnectionProfile>;
  delete(profileId: string): Promise<void>;
  test(profileId: string): Promise<ConnectionTestSummary>;
  exportDiagnostics(profileId: string): Promise<RedactedConnectionDiagnostics>;
  getSetupState(): Promise<ConnectionSetupState>;
  setActiveProfile(profileId: string | null): Promise<ConnectionSetupState>;
  completeOnboarding(): Promise<ConnectionSetupState>;
}

export const VoiceCatalogEntrySchema = z.object({
  voiceId: z.string().trim().min(1).max(500),
  label: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(true),
  language: z.string().trim().min(1).max(100).nullable().default(null),
  locale: z.string().trim().min(1).max(50).nullable().default(null),
  accent: z.string().trim().min(1).max(100).nullable().default(null),
  category: z.string().trim().min(1).max(100).nullable().default(null),
  style: z.string().trim().min(1).max(200).nullable().default(null),
  sampleText: z.string().max(2_000).nullable().default(null)
}).strict();
export type VoiceCatalogEntry = z.infer<typeof VoiceCatalogEntrySchema>;

export const VoiceCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  modelId: z.string().trim().min(1).max(500),
  entries: z.array(VoiceCatalogEntrySchema).max(10_000)
}).strict().superRefine((catalog, context) => {
  const seen = new Set<string>();
  catalog.entries.forEach((entry, index) => {
    if (seen.has(entry.voiceId)) context.addIssue({ code: "custom", message: `Duplicate voice ID: ${entry.voiceId}.`, path: ["entries", index, "voiceId"] });
    seen.add(entry.voiceId);
  });
});
export type VoiceCatalog = z.infer<typeof VoiceCatalogSchema>;
export type VoiceCatalogAuthoring = z.input<typeof VoiceCatalogSchema>;

export interface VoiceCatalogClient {
  get(modelId: string): Promise<VoiceCatalog>;
  replace(input: VoiceCatalog): Promise<VoiceCatalog>;
}
