import {
  DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
  DEFAULT_PARAGRAPH_PAUSE_ID,
  IgnoredDiagnosticSchema,
  LexiconEntryAuthoringSchema,
  LexiconEntrySchema,
  ParagraphPauseConfigurationSchema,
  PauseIdSchema,
  SpeakerIdSchema
} from "@studynarrator/core";
import { z } from "zod";
import {
  ConnectionProfileAuthoringSchema,
  ConnectionProfileCollectionSchema,
  ConnectionProfileIdInputSchema,
  type ConnectionProfile,
  type ConnectionProfileAuthoring
} from "./connections.js";

export const DATABASE_SCHEMA_VERSION = 3;
export const PERSISTENCE_CONTRACT_VERSION = 3;
export const PERSISTENCE_CHANNELS = Object.freeze({
  status: "persistence.status",
  projectsList: "projects.list",
  projectsCreate: "projects.create",
  projectsGet: "projects.get",
  projectsReplace: "projects.replace",
  projectsDuplicate: "projects.duplicate",
  projectsDelete: "projects.delete",
  pacingGet: "settings.pacing.get",
  pacingUpdate: "settings.pacing.update",
  ignoredGet: "preferences.ignored.get",
  ignoredReplace: "preferences.ignored.replace",
  globalLexiconList: "lexicon.global.list",
  globalLexiconReplace: "lexicon.global.replace",
  connectionProfilesList: "connection-profiles.list",
  connectionProfilesCreate: "connection-profiles.create",
  connectionProfilesReplace: "connection-profiles.replace",
  connectionProfilesDelete: "connection-profiles.delete"
} as const);

export const ProjectIdSchema = z.uuid();
export const DurableIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u);
const TimestampSchema = z.iso.datetime({ offset: true });

export const SpeakerMappingSchema = z.object({
  speakerId: SpeakerIdSchema,
  displayName: z.string().trim().min(1).max(200),
  voiceId: z.string().max(500).nullable(),
  speed: z.number().positive().max(4),
  gainDb: z.number().min(-60).max(24),
  roleDescription: z.string().max(5_000),
  sampleText: z.string().max(5_000)
}).strict();
export type SpeakerMapping = z.infer<typeof SpeakerMappingSchema>;

export const PausePresetSchema = z.object({
  pauseId: PauseIdSchema,
  durationMs: z.number().int().min(0).max(30_000),
  description: z.string().max(500)
}).strict();
export type PausePreset = z.infer<typeof PausePresetSchema>;

export const SystemPacingDefaultsSchema = z.object({
  enabled: z.boolean(),
  durationMs: z.number().int().min(0).max(30_000)
}).strict();
export type SystemPacingDefaults = z.infer<typeof SystemPacingDefaultsSchema>;

export const DEFAULT_SYSTEM_PACING: SystemPacingDefaults = Object.freeze({
  enabled: true,
  durationMs: DEFAULT_PARAGRAPH_PAUSE_DURATION_MS
});

const ProjectLexiconAuthoringSchema = LexiconEntryAuthoringSchema.superRefine((entry, context) => {
  if (entry.scope !== "project") {
    context.addIssue({ code: "custom", message: "Project lexicon entries must use project scope.", path: ["scope"] });
  }
});

const GlobalLexiconAuthoringSchema = LexiconEntryAuthoringSchema.superRefine((entry, context) => {
  if (entry.scope !== "global") {
    context.addIssue({ code: "custom", message: "Global lexicon entries must use global scope.", path: ["scope"] });
  }
});

export const SpeakerMappingCollectionSchema = z.array(SpeakerMappingSchema).superRefine((items, context) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.speakerId)) context.addIssue({ code: "custom", message: `Duplicate speaker ID: ${item.speakerId}.`, path: [index, "speakerId"] });
    seen.add(item.speakerId);
  });
});

export const PausePresetCollectionSchema = z.array(PausePresetSchema).superRefine((items, context) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.pauseId)) context.addIssue({ code: "custom", message: `Duplicate pause ID: ${item.pauseId}.`, path: [index, "pauseId"] });
    seen.add(item.pauseId);
  });
});

function enforceUniqueOptionalIds(
  items: readonly { id?: string | undefined }[],
  context: z.RefinementCtx,
  label: string
) {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (!item.id) return;
    if (seen.has(item.id)) context.addIssue({ code: "custom", message: `Duplicate ${label} ID: ${item.id}.`, path: [index, "id"] });
    seen.add(item.id);
  });
}

export const ProjectLexiconAuthoringCollectionSchema = z.array(ProjectLexiconAuthoringSchema)
  .superRefine((items, context) => enforceUniqueOptionalIds(items, context, "lexicon entry"));

export const GlobalLexiconAuthoringCollectionSchema = z.array(GlobalLexiconAuthoringSchema)
  .superRefine((items, context) => enforceUniqueOptionalIds(items, context, "lexicon entry"));

const ProjectLexiconEntrySchema = LexiconEntrySchema.superRefine((entry, context) => {
  if (entry.scope !== "project") context.addIssue({ code: "custom", message: "Project lexicon entries must use project scope.", path: ["scope"] });
});
const GlobalLexiconEntrySchema = LexiconEntrySchema.superRefine((entry, context) => {
  if (entry.scope !== "global") context.addIssue({ code: "custom", message: "Global lexicon entries must use global scope.", path: ["scope"] });
});

export const ProjectCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).default("")
}).strict();
export type ProjectCreateInput = z.input<typeof ProjectCreateInputSchema>;

export const ProjectDuplicateInputSchema = z.object({
  name: z.string().trim().min(1).max(200)
}).strict();
export type ProjectDuplicateInput = z.input<typeof ProjectDuplicateInputSchema>;

const ProjectAggregateShape = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  scriptSource: z.string().max(5_000_000),
  connectionProfileId: DurableIdSchema.nullable(),
  modelId: z.string().trim().min(1).max(500).nullable().default(null),
  speakerMappings: SpeakerMappingCollectionSchema,
  pausePresets: PausePresetCollectionSchema,
  paragraphPause: ParagraphPauseConfigurationSchema
} as const;

function validateParagraphPreset(
  project: { pausePresets: PausePreset[]; paragraphPause: z.infer<typeof ParagraphPauseConfigurationSchema> },
  context: z.RefinementCtx
) {
  const preset = project.pausePresets.find((candidate) => candidate.pauseId === project.paragraphPause.pauseId);
  if (!preset) {
    context.addIssue({ code: "custom", message: "Paragraph pacing must reference a project pause preset.", path: ["paragraphPause", "pauseId"] });
  } else if (preset.durationMs !== project.paragraphPause.durationMs) {
    context.addIssue({ code: "custom", message: "Paragraph pacing duration must match its referenced pause preset.", path: ["paragraphPause", "durationMs"] });
  }
}

export const ProjectReplaceInputSchema = z.object({
  ...ProjectAggregateShape,
  lexiconEntries: ProjectLexiconAuthoringCollectionSchema
}).strict().superRefine(validateParagraphPreset);
export type ProjectReplaceInput = z.input<typeof ProjectReplaceInputSchema>;

export const ProjectSummarySchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1),
  description: z.string(),
  scriptHash: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
}).strict();
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectDetailSchema = z.object({
  contractVersion: z.literal(PERSISTENCE_CONTRACT_VERSION),
  id: ProjectIdSchema,
  ...ProjectAggregateShape,
  scriptHash: z.string().regex(/^[a-f0-9]{64}$/u),
  lexiconEntries: z.array(ProjectLexiconEntrySchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
}).strict().superRefine(validateParagraphPreset);
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const ProjectSummaryCollectionSchema = z.array(ProjectSummarySchema);
export const GlobalLexiconEntryCollectionSchema = z.array(GlobalLexiconEntrySchema);
export const GlobalLexiconReplaceInputSchema = GlobalLexiconAuthoringCollectionSchema;
export type GlobalLexiconReplaceInput = z.input<typeof GlobalLexiconReplaceInputSchema>;

export const IgnoredDiagnosticCollectionSchema = z.array(IgnoredDiagnosticSchema).superRefine((items, context) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.code}\u0000${item.pattern}`;
    if (seen.has(key)) context.addIssue({ code: "custom", message: "Duplicate ignored diagnostic pattern.", path: [index] });
    seen.add(key);
  });
});
export type IgnoredDiagnosticCollection = z.infer<typeof IgnoredDiagnosticCollectionSchema>;

export const ConnectionProfileAuthoringCollectionSchema = z.array(ConnectionProfileAuthoringSchema)
  .superRefine((items, context) => enforceUniqueOptionalIds(items, context, "connection profile"));
export const ConnectionProfilePlaceholderSchema = ConnectionProfileCollectionSchema.element;
export type ConnectionProfilePlaceholder = ConnectionProfile;
export const ProjectIdInputSchema = z.object({ projectId: ProjectIdSchema }).strict();
export const ProjectReplaceRequestSchema = z.object({ projectId: ProjectIdSchema, project: ProjectReplaceInputSchema }).strict();
export const ProjectDuplicateRequestSchema = z.object({ projectId: ProjectIdSchema, duplicate: ProjectDuplicateInputSchema }).strict();
export const ConnectionProfileReplaceRequestSchema = z.object({
  profileId: DurableIdSchema,
  profile: ConnectionProfileAuthoringSchema
}).strict();
export { ConnectionProfileAuthoringSchema, ConnectionProfileCollectionSchema, ConnectionProfileIdInputSchema };
export const EmptyResponseSchema = z.object({}).strict();

export const PersistenceReadyStatusSchema = z.object({
  contractVersion: z.literal(PERSISTENCE_CONTRACT_VERSION),
  state: z.literal("ready"),
  databaseSchemaVersion: z.literal(DATABASE_SCHEMA_VERSION),
  targetDatabaseSchemaVersion: z.literal(DATABASE_SCHEMA_VERSION),
  databasePath: z.string().min(1),
  latestBackupPath: z.string().min(1).nullable()
}).strict();

export const PersistenceUnavailableStatusSchema = z.object({
  contractVersion: z.literal(PERSISTENCE_CONTRACT_VERSION),
  state: z.literal("unavailable"),
  databaseSchemaVersion: z.number().int().nonnegative().nullable(),
  targetDatabaseSchemaVersion: z.literal(DATABASE_SCHEMA_VERSION),
  databasePath: z.string().min(1),
  latestBackupPath: z.string().min(1).nullable(),
  code: z.literal("MIGRATION_FAILED"),
  message: z.string().min(1)
}).strict();

export const PersistenceStatusSchema = z.discriminatedUnion("state", [PersistenceReadyStatusSchema, PersistenceUnavailableStatusSchema]);
export type PersistenceStatus = z.infer<typeof PersistenceStatusSchema>;

export interface ProjectsClient {
  list(): Promise<ProjectSummary[]>;
  create(input: ProjectCreateInput): Promise<ProjectDetail>;
  get(projectId: string): Promise<ProjectDetail>;
  replace(projectId: string, input: ProjectReplaceInput): Promise<ProjectDetail>;
  duplicate(projectId: string, input: ProjectDuplicateInput): Promise<ProjectDetail>;
  delete(projectId: string): Promise<void>;
}

export interface PersistenceSettingsClient {
  getPacing(): Promise<SystemPacingDefaults>;
  updatePacing(input: SystemPacingDefaults): Promise<SystemPacingDefaults>;
}

export interface PreferencesClient {
  getIgnoredDiagnostics(): Promise<IgnoredDiagnosticCollection>;
  replaceIgnoredDiagnostics(input: IgnoredDiagnosticCollection): Promise<IgnoredDiagnosticCollection>;
}

export interface GlobalLexiconClient {
  list(): Promise<z.infer<typeof GlobalLexiconEntryCollectionSchema>>;
  replace(input: GlobalLexiconReplaceInput): Promise<z.infer<typeof GlobalLexiconEntryCollectionSchema>>;
}

export interface ConnectionProfilesClient {
  list(): Promise<ConnectionProfilePlaceholder[]>;
  create(input: ConnectionProfileAuthoring): Promise<ConnectionProfilePlaceholder>;
  replace(profileId: string, input: ConnectionProfileAuthoring): Promise<ConnectionProfilePlaceholder>;
  delete(profileId: string): Promise<void>;
}

export interface PersistenceClient {
  status(): Promise<PersistenceStatus>;
  projects: ProjectsClient;
  settings: PersistenceSettingsClient;
  preferences: PreferencesClient;
  globalLexicon: GlobalLexiconClient;
  connectionProfiles: ConnectionProfilesClient;
}

export const DEFAULT_PROJECT_PARAGRAPH_PAUSE = Object.freeze({
  enabled: DEFAULT_SYSTEM_PACING.enabled,
  pauseId: DEFAULT_PARAGRAPH_PAUSE_ID,
  durationMs: DEFAULT_SYSTEM_PACING.durationMs
});
