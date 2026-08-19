import { z } from "zod";

const TimestampSchema = z.iso.datetime({ offset: true });
const NullableTimestampSchema = TimestampSchema.nullable();

export const CONNECTION_DIAGNOSTIC_SCHEMA_VERSION = 1;
const CONNECTION_DEFAULT_TIMEOUT_SECONDS = 120;
const CONNECTION_DEFAULT_RETRY_COUNT = 2;

export const CONNECTION_CHANNELS = Object.freeze({
  get: "connection.get",
  update: "connection.update",
  test: "connection.test",
  speechCatalogDiscover: "connection.discover-speech-catalog",
  exportDiagnostics: "connection.export-diagnostics",
  setupGet: "setup.get",
  setupComplete: "setup.complete",
  voiceCatalogGet: "voice-catalog.get",
  voiceCatalogReplace: "voice-catalog.replace",
} as const);

const ConnectionTestOverallSchema = z.enum([
  "connected",
  "configurationError",
  "disconnected",
  "authenticationRequired",
  "modelUnavailable",
  "voiceUnavailable",
  "invalidAudio",
]);
export type ConnectionTestOverall = z.infer<typeof ConnectionTestOverallSchema>;

const ConnectionDiagnosticStageNameSchema = z.enum([
  "url",
  "dns",
  "tcp",
  "http",
  "authentication",
  "model",
  "voice",
  "audio",
]);

const ConnectionDiagnosticStageSchema = z
  .object({
    stage: ConnectionDiagnosticStageNameSchema,
    status: z.enum(["pass", "fail", "skipped"]),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(1_000),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();
export type ConnectionDiagnosticStage = z.infer<
  typeof ConnectionDiagnosticStageSchema
>;

export const ConnectionTestSummarySchema = z
  .object({
    schemaVersion: z.literal(CONNECTION_DIAGNOSTIC_SCHEMA_VERSION),
    overall: ConnectionTestOverallSchema,
    testedAt: TimestampSchema,
    httpStatus: z.number().int().min(100).max(599).nullable(),
    stages: z.array(ConnectionDiagnosticStageSchema).length(8),
    availableModelIds: z.array(z.string().min(1).max(500)).max(2_000),
    availableVoiceIds: z
      .array(z.string().min(1).max(500))
      .max(10_000)
      .nullable(),
  })
  .strict();
export type ConnectionTestSummary = z.infer<typeof ConnectionTestSummarySchema>;

export const SpeachesConnectionAuthoringSchema = z
  .object({
    baseUrl: z.url({ protocol: /^https?$/u }).nullable(),
    defaultModelId: z.string().trim().min(1).max(500).nullable(),
    defaultVoiceId: z.string().trim().min(1).max(500).nullable(),
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(600)
      .default(CONNECTION_DEFAULT_TIMEOUT_SECONDS),
    retryCount: z
      .number()
      .int()
      .min(0)
      .max(5)
      .default(CONNECTION_DEFAULT_RETRY_COUNT),
    responseFormat: z.literal("wav").default("wav"),
  })
  .strict();
export type SpeachesConnectionAuthoring = z.input<
  typeof SpeachesConnectionAuthoringSchema
>;

export const SpeachesCatalogDiscoveryInputSchema = z
  .object({
    baseUrl: z.url({ protocol: /^https?$/u }),
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(600)
      .default(CONNECTION_DEFAULT_TIMEOUT_SECONDS),
    retryCount: z
      .number()
      .int()
      .min(0)
      .max(5)
      .default(CONNECTION_DEFAULT_RETRY_COUNT),
  })
  .strict();
export type SpeachesCatalogDiscoveryInput = z.input<
  typeof SpeachesCatalogDiscoveryInputSchema
>;

export const SpeachesConnectionSchema = z
  .object({
    baseUrl: z.url({ protocol: /^https?$/u }).nullable(),
    suppliedUrlForm: z.enum(["root", "v1", "unconfigured"]),
    configured: z.boolean(),
    defaultModelId: z.string().min(1).max(500).nullable(),
    defaultVoiceId: z.string().min(1).max(500).nullable(),
    timeoutSeconds: z.number().int().min(1).max(600),
    retryCount: z.number().int().min(0).max(5),
    responseFormat: z.literal("wav"),
    lastTestedAt: NullableTimestampSchema,
    lastSuccessfulTestAt: NullableTimestampSchema,
    lastTestSummary: ConnectionTestSummarySchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type SpeachesConnection = z.infer<typeof SpeachesConnectionSchema>;

export const ConnectionSetupStateSchema = z
  .object({
    onboardingCompletedAt: NullableTimestampSchema,
    client: z.enum(["web", "electron"]),
  })
  .strict();
export type ConnectionSetupState = z.infer<typeof ConnectionSetupStateSchema>;

const SpeechCatalogVoiceSchema = z
  .object({
    voiceId: z.string().trim().min(1).max(500),
    name: z.string().trim().min(1).max(200).nullable(),
    language: z.string().trim().min(1).max(100).nullable(),
    gender: z.string().trim().min(1).max(50).nullable(),
  })
  .strict();
export type SpeechCatalogVoice = z.infer<typeof SpeechCatalogVoiceSchema>;

const SpeechCatalogModelSchema = z
  .object({
    modelId: z.string().trim().min(1).max(500),
    voices: z.array(SpeechCatalogVoiceSchema).max(10_000),
  })
  .strict()
  .superRefine((model, context) => {
    const seen = new Set<string>();
    model.voices.forEach((voice, index) => {
      if (seen.has(voice.voiceId))
        context.addIssue({
          code: "custom",
          message: `Duplicate voice ID: ${voice.voiceId}.`,
          path: ["voices", index, "voiceId"],
        });
      seen.add(voice.voiceId);
    });
  });

export const SpeechCatalogSchema = z
  .object({
    schemaVersion: z.literal(CONNECTION_DIAGNOSTIC_SCHEMA_VERSION),
    models: z.array(SpeechCatalogModelSchema).max(2_000),
  })
  .strict()
  .superRefine((catalog, context) => {
    const seen = new Set<string>();
    catalog.models.forEach((model, index) => {
      if (seen.has(model.modelId))
        context.addIssue({
          code: "custom",
          message: `Duplicate model ID: ${model.modelId}.`,
          path: ["models", index, "modelId"],
        });
      seen.add(model.modelId);
    });
  });
export type SpeechCatalog = z.infer<typeof SpeechCatalogSchema>;

export const RedactedConnectionDiagnosticsSchema = z
  .object({
    schemaVersion: z.literal(CONNECTION_DIAGNOSTIC_SCHEMA_VERSION),
    applicationVersion: z.string().min(1),
    runtimeVersions: z
      .object({
        node: z.string().min(1),
        electron: z.string().min(1).nullable(),
      })
      .strict(),
    endpointClass: z.enum(["loopback", "private", "public", "unconfigured"]),
    suppliedUrlForm: z.enum(["root", "v1", "unconfigured"]),
    modelId: z.string().nullable(),
    voiceId: z.string().nullable(),
    requestCounts: z
      .object({
        health: z.number().int().nonnegative(),
        models: z.number().int().nonnegative(),
        voices: z.number().int().nonnegative(),
        speech: z.number().int().nonnegative(),
      })
      .strict(),
    result: ConnectionTestSummarySchema,
  })
  .strict();
export type RedactedConnectionDiagnostics = z.infer<
  typeof RedactedConnectionDiagnosticsSchema
>;

export interface SpeachesConnectionClient {
  get(): Promise<SpeachesConnection>;
  update(input: SpeachesConnectionAuthoring): Promise<SpeachesConnection>;
  test(): Promise<ConnectionTestSummary>;
  discoverSpeechCatalog(
    input: SpeachesCatalogDiscoveryInput,
    signal?: AbortSignal,
  ): Promise<SpeechCatalog>;
  exportDiagnostics(): Promise<RedactedConnectionDiagnostics>;
  getSetupState(): Promise<ConnectionSetupState>;
  completeOnboarding(): Promise<ConnectionSetupState>;
}

export const VoiceCatalogModelInputSchema = z
  .object({ modelId: z.string().trim().min(1).max(500) })
  .strict();

const VoiceCatalogEntrySchema = z
  .object({
    voiceId: z.string().trim().min(1).max(500),
    label: z.string().trim().min(1).max(200),
    enabled: z.boolean().default(true),
    favorite: z.boolean().default(false),
    language: z.string().trim().min(1).max(100).nullable().default(null),
    locale: z.string().trim().min(1).max(50).nullable().default(null),
    accent: z.string().trim().min(1).max(100).nullable().default(null),
    category: z.string().trim().min(1).max(100).nullable().default(null),
    style: z.string().trim().min(1).max(200).nullable().default(null),
    sampleText: z.string().max(2_000).nullable().default(null),
  })
  .strict();
export type VoiceCatalogEntry = z.infer<typeof VoiceCatalogEntrySchema>;

export const VoiceCatalogSchema = z
  .object({
    schemaVersion: z.literal(CONNECTION_DIAGNOSTIC_SCHEMA_VERSION),
    modelId: z.string().trim().min(1).max(500),
    entries: z.array(VoiceCatalogEntrySchema).max(10_000),
  })
  .strict()
  .superRefine((catalog, context) => {
    const seen = new Set<string>();
    catalog.entries.forEach((entry, index) => {
      if (seen.has(entry.voiceId))
        context.addIssue({
          code: "custom",
          message: `Duplicate voice ID: ${entry.voiceId}.`,
          path: ["entries", index, "voiceId"],
        });
      seen.add(entry.voiceId);
    });
  });
export type VoiceCatalog = z.infer<typeof VoiceCatalogSchema>;
export type VoiceCatalogAuthoring = z.input<typeof VoiceCatalogSchema>;

export interface VoiceCatalogClient {
  get(modelId: string): Promise<VoiceCatalog>;
  replace(input: VoiceCatalog): Promise<VoiceCatalog>;
}
