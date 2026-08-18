import {
  DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
  DEFAULT_PARAGRAPH_PAUSE_ID,
  IgnoredDiagnosticSchema,
  LexiconEntrySchema,
  SpeakerIdSchema,
  SupportedPauseIdSchema,
} from "@studynarrator/core";
import { z } from "zod";

export const DATABASE_SCHEMA_VERSION = 3;
export const PERSISTENCE_CONTRACT_VERSION = 1;
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
  backupsList: "persistence.backups.list",
  backupsRestore: "persistence.backups.restore",
} as const);

export const ProjectIdSchema = z.uuid();
const TimestampSchema = z.iso.datetime({ offset: true });

const SpeakerMappingSchema = z
  .object({
    speakerId: SpeakerIdSchema,
    displayName: z.string().trim().min(1).max(200),
    voiceId: z.string().max(500).nullable(),
    speed: z.number().positive().max(4),
    gainDb: z.number().min(-60).max(24),
    roleDescription: z.string().max(5_000),
    sampleText: z.string().max(5_000),
  })
  .strict();
const fixedPausePreset = <
  TId extends "pause_short" | "pause_medium" | "pause_long",
>(
  pauseId: TId,
) =>
  z
    .object({
      pauseId: z.literal(pauseId),
      durationMs: z.number().int().min(0).max(30_000),
      description: z.string().max(500),
    })
    .strict();

const SystemPausePresetCollectionSchema = z.tuple([
  fixedPausePreset("pause_short"),
  fixedPausePreset("pause_medium"),
  fixedPausePreset("pause_long"),
]);
const SystemTransitionPauseSettingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z
    .object({ mode: z.literal("preset"), pauseId: SupportedPauseIdSchema })
    .strict(),
  z
    .object({
      mode: z.literal("duration"),
      durationMs: z.number().int().min(0).max(30_000),
    })
    .strict(),
]);
export type SystemTransitionPauseSetting = z.infer<
  typeof SystemTransitionPauseSettingSchema
>;
const SystemTransitionPauseConfigurationSchema = z
  .object({
    paragraph: SystemTransitionPauseSettingSchema,
    speakerChange: SystemTransitionPauseSettingSchema,
    section: SystemTransitionPauseSettingSchema,
  })
  .strict();
export type SystemTransitionPauseConfiguration = z.infer<
  typeof SystemTransitionPauseConfigurationSchema
>;
export const SystemTimingConfigurationSchema = z
  .object({
    pausePresets: SystemPausePresetCollectionSchema,
    transitionPauses: SystemTransitionPauseConfigurationSchema,
  })
  .strict();
export type SystemTimingConfiguration = z.infer<
  typeof SystemTimingConfigurationSchema
>;

export const DEFAULT_SYSTEM_TIMING: SystemTimingConfiguration = Object.freeze({
  pausePresets: [
    {
      pauseId: "pause_short",
      durationMs: 350,
      description: "Brief thinking beat or speaker handoff.",
    },
    {
      pauseId: "pause_medium",
      durationMs: DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
      description: "Paragraph or subtopic separation.",
    },
    {
      pauseId: "pause_long",
      durationMs: 1_500,
      description: "Major subject or section separation.",
    },
  ],
  transitionPauses: {
    paragraph: { mode: "preset", pauseId: DEFAULT_PARAGRAPH_PAUSE_ID },
    speakerChange: { mode: "none" },
    section: { mode: "none" },
  },
});

function fixedLexiconAuthoringShape<TScope extends "global" | "project">(
  scope: TScope,
) {
  return {
    id: z.string().min(1).optional(),
    scope: z.literal(scope),
    displayText: z.string().trim().min(1),
    spokenText: z.string().trim().min(1),
    caseSensitive: z.literal(false).default(false),
    wholeWord: z.literal(true).default(true),
    priority: z.literal(0).default(0),
    enabled: z.boolean().default(true),
    notes: z.literal("").default(""),
  } as const;
}

const ProjectLexiconAuthoringSchema = z
  .object({
    ...fixedLexiconAuthoringShape("project"),
    entryType: z.literal("exactTerm").default("exactTerm"),
  })
  .strict();
const GlobalExactTermAuthoringSchema = z
  .object({
    ...fixedLexiconAuthoringShape("global"),
    entryType: z.literal("exactTerm").default("exactTerm"),
  })
  .strict();
const GlobalNamedSenseAuthoringSchema = z
  .object({
    ...fixedLexiconAuthoringShape("global"),
    entryType: z.literal("namedSense"),
    senseId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict();
const GlobalLexiconAuthoringSchema = z.union([
  GlobalExactTermAuthoringSchema,
  GlobalNamedSenseAuthoringSchema,
]);

export const SpeakerMappingCollectionSchema = z
  .array(SpeakerMappingSchema)
  .superRefine((items, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.speakerId))
        context.addIssue({
          code: "custom",
          message: `Duplicate speaker ID: ${item.speakerId}.`,
          path: [index, "speakerId"],
        });
      seen.add(item.speakerId);
    });
  });

function enforceUniqueOptionalIds(
  items: readonly { id?: string | undefined }[],
  context: z.RefinementCtx,
  label: string,
) {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (!item.id) return;
    if (seen.has(item.id))
      context.addIssue({
        code: "custom",
        message: `Duplicate ${label} ID: ${item.id}.`,
        path: [index, "id"],
      });
    seen.add(item.id);
  });
}

export const ProjectLexiconAuthoringCollectionSchema = z
  .array(ProjectLexiconAuthoringSchema)
  .superRefine((items, context) =>
    enforceUniqueOptionalIds(items, context, "lexicon entry"),
  );

const GlobalLexiconAuthoringCollectionSchema = z
  .array(GlobalLexiconAuthoringSchema)
  .superRefine((items, context) =>
    enforceUniqueOptionalIds(items, context, "lexicon entry"),
  );

const ProjectLexiconEntrySchema = LexiconEntrySchema.superRefine(
  (entry, context) => {
    if (entry.scope !== "project")
      context.addIssue({
        code: "custom",
        message: "Project lexicon entries must use project scope.",
        path: ["scope"],
      });
    if (entry.entryType !== "exactTerm")
      context.addIssue({
        code: "custom",
        message: "Project lexicon entries must use exact-term matching.",
        path: ["entryType"],
      });
    if (entry.senseId !== undefined)
      context.addIssue({
        code: "custom",
        message: "Project lexicon entries cannot define a sense ID.",
        path: ["senseId"],
      });
    if (entry.caseSensitive)
      context.addIssue({
        code: "custom",
        message: "Project lexicon entries must be case insensitive.",
        path: ["caseSensitive"],
      });
    if (!entry.wholeWord)
      context.addIssue({
        code: "custom",
        message: "Project lexicon entries must match whole words.",
        path: ["wholeWord"],
      });
    if (entry.priority !== 0)
      context.addIssue({
        code: "custom",
        message: "Project lexicon entries use fixed priority.",
        path: ["priority"],
      });
    if (entry.notes !== "")
      context.addIssue({
        code: "custom",
        message: "Project lexicon entries do not store notes.",
        path: ["notes"],
      });
  },
);
const GlobalLexiconEntrySchema = LexiconEntrySchema.superRefine(
  (entry, context) => {
    if (entry.scope !== "global")
      context.addIssue({
        code: "custom",
        message: "Global lexicon entries must use global scope.",
        path: ["scope"],
      });
    if (entry.entryType !== "exactTerm" && entry.entryType !== "namedSense")
      context.addIssue({
        code: "custom",
        message:
          "Global lexicon entries must use exact-term or named-sense matching.",
        path: ["entryType"],
      });
    if (entry.caseSensitive)
      context.addIssue({
        code: "custom",
        message: "Global lexicon entries must be case insensitive.",
        path: ["caseSensitive"],
      });
    if (!entry.wholeWord)
      context.addIssue({
        code: "custom",
        message: "Global lexicon entries must match whole words.",
        path: ["wholeWord"],
      });
    if (entry.priority !== 0)
      context.addIssue({
        code: "custom",
        message: "Global lexicon entries use fixed priority.",
        path: ["priority"],
      });
    if (entry.notes !== "")
      context.addIssue({
        code: "custom",
        message: "Global lexicon entries do not store notes.",
        path: ["notes"],
      });
  },
);

export const ProjectCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).default(""),
  })
  .strict();
export type ProjectCreateInput = z.input<typeof ProjectCreateInputSchema>;

export const ProjectDuplicateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
  })
  .strict();
export type ProjectDuplicateInput = z.input<typeof ProjectDuplicateInputSchema>;

const ProjectAggregateShape = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  scriptSource: z.string().max(5_000_000),
  speakerMappings: SpeakerMappingCollectionSchema,
} as const;

export const ProjectReplaceInputSchema = z
  .object({
    ...ProjectAggregateShape,
    lexiconEntries: ProjectLexiconAuthoringCollectionSchema,
  })
  .strict();
export type ProjectReplaceInput = z.input<typeof ProjectReplaceInputSchema>;

const ProjectSummarySchema = z
  .object({
    id: ProjectIdSchema,
    name: z.string().min(1),
    description: z.string(),
    scriptHash: z.string().regex(/^[a-f0-9]{64}$/u),
    scriptLineCount: z.number().int().positive().nullable(),
    audioDurationMs: z.number().int().nonnegative().nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectDetailSchema = z
  .object({
    contractVersion: z.literal(PERSISTENCE_CONTRACT_VERSION),
    id: ProjectIdSchema,
    ...ProjectAggregateShape,
    scriptHash: z.string().regex(/^[a-f0-9]{64}$/u),
    lexiconEntries: z.array(ProjectLexiconEntrySchema),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const ProjectSummaryCollectionSchema = z.array(ProjectSummarySchema);
export const GlobalLexiconEntryCollectionSchema = z.array(
  GlobalLexiconEntrySchema,
);
export const GlobalLexiconReplaceInputSchema =
  GlobalLexiconAuthoringCollectionSchema;
export type GlobalLexiconReplaceInput = z.input<
  typeof GlobalLexiconReplaceInputSchema
>;

const DEFAULT_GLOBAL_EXACT_TERM_LEXICON = Object.freeze([
  {
    id: "10000000-0000-4000-8000-000000000001",
    scope: "global",
    entryType: "exactTerm",
    displayText: "API",
    spokenText: "A P I",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    scope: "global",
    entryType: "exactTerm",
    displayText: "URL",
    spokenText: "U R L",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    scope: "global",
    entryType: "exactTerm",
    displayText: "HTTP",
    spokenText: "H T T P",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    scope: "global",
    entryType: "exactTerm",
    displayText: "HTTPS",
    spokenText: "H T T P S",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    scope: "global",
    entryType: "exactTerm",
    displayText: "JSON",
    spokenText: "jay son",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    scope: "global",
    entryType: "exactTerm",
    displayText: "SQL",
    spokenText: "S Q L",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    scope: "global",
    entryType: "exactTerm",
    displayText: "PostgreSQL",
    spokenText: "post gres Q L",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
  },
  {
    id: "10000000-0000-4000-8000-000000000008",
    scope: "global",
    entryType: "exactTerm",
    displayText: "GitHub",
    spokenText: "git hub",
    caseSensitive: false,
    wholeWord: true,
    priority: 0,
    enabled: true,
    notes: "",
  },
] as const);

const DEFAULT_GLOBAL_NAMED_SENSE_VALUES = Object.freeze([
  ["resume", "cv", "rez oo may"],
  ["resume", "continue", "ree zoom"],
  ["read", "present", "reed"],
  ["read", "past", "red"],
  ["lead", "guide", "leed"],
  ["lead", "metal", "led"],
  ["live", "exist", "liv"],
  ["live", "realtime", "lyve"],
  ["record", "noun", "reck erd"],
  ["record", "verb", "ree cord"],
  ["project", "noun", "prah jekt"],
  ["project", "verb", "pruh jekt"],
  ["object", "thing", "ob jekt"],
  ["object", "oppose", "ub jekt"],
  ["subject", "topic", "sub jekt"],
  ["subject", "expose", "sub jekt"],
  ["present", "current", "prez ent"],
  ["present", "give", "pree zent"],
  ["content", "material", "con tent"],
  ["content", "satisfied", "kun tent"],
  ["minute", "time", "min it"],
  ["minute", "tiny", "my noot"],
  ["close", "near", "klohs"],
  ["close", "shut", "klohz"],
  ["use", "noun", "yoos"],
  ["use", "verb", "yooz"],
  ["attribute", "property", "at trih byoot"],
  ["attribute", "assign", "uh trib yoot"],
  ["import", "noun", "im port"],
  ["import", "verb", "im port"],
  ["export", "noun", "eks port"],
  ["export", "verb", "ik sport"],
  ["row", "line", "roh"],
  ["row", "argument", "rau"],
  ["axes", "math", "ak seez"],
  ["axes", "tools", "ak siz"],
] as const);

export const DEFAULT_GLOBAL_NAMED_SENSE_LEXICON = Object.freeze(
  DEFAULT_GLOBAL_NAMED_SENSE_VALUES.map(
    ([displayText, senseId, spokenText], index) =>
      Object.freeze({
        id: `10000000-0000-4000-8000-${String(index + 9).padStart(12, "0")}`,
        scope: "global" as const,
        entryType: "namedSense" as const,
        displayText,
        senseId,
        spokenText,
        caseSensitive: false as const,
        wholeWord: true as const,
        priority: 0 as const,
        enabled: true,
        notes: "" as const,
      }),
  ),
) satisfies Readonly<GlobalLexiconReplaceInput>;

export const DEFAULT_GLOBAL_LEXICON = Object.freeze([
  ...DEFAULT_GLOBAL_EXACT_TERM_LEXICON,
  ...DEFAULT_GLOBAL_NAMED_SENSE_LEXICON,
]) satisfies Readonly<GlobalLexiconReplaceInput>;

export const IgnoredDiagnosticCollectionSchema = z
  .array(IgnoredDiagnosticSchema)
  .superRefine((items, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const key = `${item.code}\u0000${item.pattern}`;
      if (seen.has(key))
        context.addIssue({
          code: "custom",
          message: "Duplicate ignored diagnostic pattern.",
          path: [index],
        });
      seen.add(key);
    });
  });
export type IgnoredDiagnosticCollection = z.infer<
  typeof IgnoredDiagnosticCollectionSchema
>;

export const ProjectIdInputSchema = z
  .object({ projectId: ProjectIdSchema })
  .strict();
export const ProjectReplaceRequestSchema = z
  .object({ projectId: ProjectIdSchema, project: ProjectReplaceInputSchema })
  .strict();
export const ProjectDuplicateRequestSchema = z
  .object({
    projectId: ProjectIdSchema,
    duplicate: ProjectDuplicateInputSchema,
  })
  .strict();
export const EmptyResponseSchema = z.object({}).strict();

export const PersistenceReadyStatusSchema = z
  .object({
    contractVersion: z.literal(PERSISTENCE_CONTRACT_VERSION),
    state: z.literal("ready"),
    databaseSchemaVersion: z.number().int().positive(),
    targetDatabaseSchemaVersion: z.number().int().positive(),
    databasePath: z.string().min(1),
    latestBackupPath: z.string().min(1).nullable(),
  })
  .strict();

export const PersistenceBackupSchema = z
  .object({
    path: z.string().min(1),
    fromVersion: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();
export type PersistenceBackup = z.infer<typeof PersistenceBackupSchema>;
export const PersistenceBackupCollectionSchema = z.array(
  PersistenceBackupSchema,
);

export const PersistenceBackupRestoreInputSchema = z
  .object({ backupPath: z.string().min(1) })
  .strict();
export type PersistenceBackupRestoreInput = z.infer<
  typeof PersistenceBackupRestoreInputSchema
>;
export const PersistenceBackupRestoreResultSchema = z
  .object({
    restoredFrom: z.string().min(1),
    safetyCopyPath: z.string().min(1),
  })
  .strict();
export type PersistenceBackupRestoreResult = z.infer<
  typeof PersistenceBackupRestoreResultSchema
>;

const PersistenceUnavailableStatusSchema = z
  .object({
    contractVersion: z.literal(PERSISTENCE_CONTRACT_VERSION),
    state: z.literal("unavailable"),
    databaseSchemaVersion: z.number().int().nonnegative().nullable(),
    targetDatabaseSchemaVersion: z.number().int().positive(),
    databasePath: z.string().min(1),
    latestBackupPath: z.string().min(1).nullable(),
    code: z.enum(["MIGRATION_FAILED", "SCHEMA_TOO_NEW"]),
    message: z.string().min(1),
    availableBackups: PersistenceBackupCollectionSchema.default([]),
  })
  .strict();

export interface PersistenceBackupsClient {
  list(): Promise<PersistenceBackup[]>;
  restore(
    input: PersistenceBackupRestoreInput,
  ): Promise<PersistenceBackupRestoreResult>;
}

export const PersistenceStatusSchema = z.discriminatedUnion("state", [
  PersistenceReadyStatusSchema,
  PersistenceUnavailableStatusSchema,
]);
export type PersistenceStatus = z.infer<typeof PersistenceStatusSchema>;

interface ProjectsClient {
  list(): Promise<ProjectSummary[]>;
  create(input: ProjectCreateInput): Promise<ProjectDetail>;
  get(projectId: string): Promise<ProjectDetail>;
  replace(
    projectId: string,
    input: ProjectReplaceInput,
  ): Promise<ProjectDetail>;
  duplicate(
    projectId: string,
    input: ProjectDuplicateInput,
  ): Promise<ProjectDetail>;
  delete(projectId: string): Promise<void>;
}

interface PersistenceSettingsClient {
  getPacing(): Promise<SystemTimingConfiguration>;
  updatePacing(
    input: SystemTimingConfiguration,
  ): Promise<SystemTimingConfiguration>;
}

interface PreferencesClient {
  getIgnoredDiagnostics(): Promise<IgnoredDiagnosticCollection>;
  replaceIgnoredDiagnostics(
    input: IgnoredDiagnosticCollection,
  ): Promise<IgnoredDiagnosticCollection>;
}

interface GlobalLexiconClient {
  list(): Promise<z.infer<typeof GlobalLexiconEntryCollectionSchema>>;
  replace(
    input: GlobalLexiconReplaceInput,
  ): Promise<z.infer<typeof GlobalLexiconEntryCollectionSchema>>;
}

export interface PersistenceClient {
  status(): Promise<PersistenceStatus>;
  backups?: PersistenceBackupsClient;
  projects: ProjectsClient;
  settings: PersistenceSettingsClient;
  preferences: PreferencesClient;
  globalLexicon: GlobalLexiconClient;
}
