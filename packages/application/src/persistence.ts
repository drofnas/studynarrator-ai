import {
  CustomGlobalLexiconReplaceInputSchema,
  GlobalLexiconBuiltInEnabledInputSchema,
  GlobalLexiconStateSchema,
  IgnoredDiagnosticCollectionSchema,
  PersistenceBackupCollectionSchema,
  PersistenceBackupRestoreInputSchema,
  PersistenceBackupRestoreResultSchema,
  PersistenceStatusSchema,
  RetentionReclaimInputSchema,
  RetentionReclaimPreviewSchema,
  RetentionReclaimResultSchema,
  RetentionSettingsAuthoringSchema,
  RetentionSettingsSchema,
  RetentionUsageSchema,
  ProjectCreateInputSchema,
  ProjectDetailSchema,
  ProjectDuplicateInputSchema,
  ProjectIdSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  SystemTimingConfigurationSchema,
  type CustomGlobalLexiconReplaceInput,
  type GlobalLexiconBuiltInEnabledInput,
  type GlobalLexiconState,
  type IgnoredDiagnosticCollection,
  type PersistenceBackup,
  type PersistenceBackupRestoreInput,
  type PersistenceBackupRestoreResult,
  type PersistenceClient,
  type PersistenceStatus,
  type RetentionSettings,
  type RetentionSettingsAuthoring,
  type ProjectCreateInput,
  type ProjectDetail,
  type ProjectDuplicateInput,
  type ProjectReplaceInput,
  type ProjectSummary,
  type SystemTimingConfiguration,
} from "@studynarrator/shared-types";
import type { LexiconEntry } from "@studynarrator/core";

export interface PersistenceRepository {
  status(): PersistenceStatus;
  listProjects(): ProjectSummary[];
  createProject(input: ProjectCreateInput): ProjectDetail;
  getProject(projectId: string): ProjectDetail;
  replaceProject(
    projectId: string,
    input: ProjectReplaceInput,
    speechCacheKeys?: readonly string[],
  ): ProjectDetail;
  duplicateProject(
    projectId: string,
    input: ProjectDuplicateInput,
  ): ProjectDetail;
  deleteProject(projectId: string): void;
  getSystemPacing(): SystemTimingConfiguration;
  updateSystemPacing(
    input: SystemTimingConfiguration,
  ): SystemTimingConfiguration;
  getIgnoredDiagnostics(): IgnoredDiagnosticCollection;
  replaceIgnoredDiagnostics(
    input: IgnoredDiagnosticCollection,
  ): IgnoredDiagnosticCollection;
  listGlobalLexicon(): LexiconEntry[];
  getGlobalLexiconState(): GlobalLexiconState;
  replaceCustomGlobalLexicon(
    input: CustomGlobalLexiconReplaceInput,
  ): GlobalLexiconState;
  setBuiltInGlobalLexiconEnabled(
    input: GlobalLexiconBuiltInEnabledInput,
  ): GlobalLexiconState;
  reimportBuiltInGlobalLexicon(): GlobalLexiconState;
  getRetentionSettings(): RetentionSettings;
  updateRetentionSettings(input: RetentionSettingsAuthoring): RetentionSettings;
}

interface RetentionMaintenanceProvider {
  usage(): Promise<unknown>;
  previewReclaim(): Promise<unknown>;
  reclaim(input: unknown): Promise<unknown>;
}

export class PersistenceUnavailableError extends Error {
  readonly code = "PERSISTENCE_UNAVAILABLE";
}

interface PersistenceBackupsProvider {
  list(): Promise<readonly PersistenceBackup[]>;
  restore(
    input: PersistenceBackupRestoreInput,
  ): Promise<PersistenceBackupRestoreResult>;
}

export function createPersistenceService(
  repository: PersistenceRepository,
  options: {
    projectSpeechCacheKeys?: (
      input: ProjectReplaceInput,
    ) => readonly string[] | undefined;
    backups?: PersistenceBackupsProvider;
    retention?: RetentionMaintenanceProvider;
  } = {},
): PersistenceClient {
  const execute = <T>(operation: () => T | Promise<T>): Promise<Awaited<T>> =>
    Promise.resolve().then(operation) as Promise<Awaited<T>>;
  const retentionMaintenance = (): RetentionMaintenanceProvider => {
    if (options.retention) return options.retention;
    throw new PersistenceUnavailableError(
      "Retention maintenance is not available in this context.",
    );
  };
  return {
    status() {
      return execute(() => PersistenceStatusSchema.parse(repository.status()));
    },
    backups: {
      list() {
        return execute(async () =>
          PersistenceBackupCollectionSchema.parse(
            (await options.backups?.list()) ?? [],
          ),
        );
      },
      restore(input) {
        return execute(async () => {
          const provider = options.backups;
          if (!provider)
            throw new PersistenceUnavailableError(
              "Backup restore is not available in this context.",
            );
          return PersistenceBackupRestoreResultSchema.parse(
            await provider.restore(
              PersistenceBackupRestoreInputSchema.parse(input),
            ),
          );
        });
      },
    },
    projects: {
      list() {
        return execute(() =>
          ProjectSummaryCollectionSchema.parse(repository.listProjects()),
        );
      },
      create(input) {
        return execute(() =>
          ProjectDetailSchema.parse(
            repository.createProject(ProjectCreateInputSchema.parse(input)),
          ),
        );
      },
      get(projectId) {
        return execute(() =>
          ProjectDetailSchema.parse(
            repository.getProject(ProjectIdSchema.parse(projectId)),
          ),
        );
      },
      replace(projectId, input) {
        return execute(() => {
          const parsed = ProjectReplaceInputSchema.parse(input);
          return ProjectDetailSchema.parse(
            repository.replaceProject(
              ProjectIdSchema.parse(projectId),
              parsed,
              options.projectSpeechCacheKeys?.(parsed),
            ),
          );
        });
      },
      duplicate(projectId, input) {
        return execute(() =>
          ProjectDetailSchema.parse(
            repository.duplicateProject(
              ProjectIdSchema.parse(projectId),
              ProjectDuplicateInputSchema.parse(input),
            ),
          ),
        );
      },
      delete(projectId) {
        return execute(() => {
          repository.deleteProject(ProjectIdSchema.parse(projectId));
        });
      },
    },
    settings: {
      getPacing() {
        return execute(() =>
          SystemTimingConfigurationSchema.parse(repository.getSystemPacing()),
        );
      },
      updatePacing(input) {
        return execute(() =>
          SystemTimingConfigurationSchema.parse(
            repository.updateSystemPacing(
              SystemTimingConfigurationSchema.parse(input),
            ),
          ),
        );
      },
    },
    retention: {
      get() {
        return execute(() =>
          RetentionSettingsSchema.parse(repository.getRetentionSettings()),
        );
      },
      update(input) {
        return execute(() =>
          RetentionSettingsSchema.parse(
            repository.updateRetentionSettings(
              RetentionSettingsAuthoringSchema.parse(input),
            ),
          ),
        );
      },
      usage() {
        return execute(async () =>
          RetentionUsageSchema.parse(await retentionMaintenance().usage()),
        );
      },
      previewReclaim() {
        return execute(async () =>
          RetentionReclaimPreviewSchema.parse(
            await retentionMaintenance().previewReclaim(),
          ),
        );
      },
      reclaim(input) {
        return execute(async () =>
          RetentionReclaimResultSchema.parse(
            await retentionMaintenance().reclaim(
              RetentionReclaimInputSchema.parse(input),
            ),
          ),
        );
      },
    },
    preferences: {
      getIgnoredDiagnostics() {
        return execute(() =>
          IgnoredDiagnosticCollectionSchema.parse(
            repository.getIgnoredDiagnostics(),
          ),
        );
      },
      replaceIgnoredDiagnostics(input) {
        return execute(() =>
          IgnoredDiagnosticCollectionSchema.parse(
            repository.replaceIgnoredDiagnostics(
              IgnoredDiagnosticCollectionSchema.parse(input),
            ),
          ),
        );
      },
    },
    globalLexicon: {
      list() {
        return execute(() =>
          GlobalLexiconStateSchema.parse(repository.getGlobalLexiconState()),
        );
      },
      setBuiltInEnabled(input) {
        return execute(() =>
          GlobalLexiconStateSchema.parse(
            repository.setBuiltInGlobalLexiconEnabled(
              GlobalLexiconBuiltInEnabledInputSchema.parse(input),
            ),
          ),
        );
      },
      replaceCustom(input) {
        return execute(() =>
          GlobalLexiconStateSchema.parse(
            repository.replaceCustomGlobalLexicon(
              CustomGlobalLexiconReplaceInputSchema.parse(input),
            ),
          ),
        );
      },
      reimportBuiltIns() {
        return execute(() =>
          GlobalLexiconStateSchema.parse(
            repository.reimportBuiltInGlobalLexicon(),
          ),
        );
      },
    },
  };
}

export function createUnavailablePersistenceService(
  statusInput: PersistenceStatus,
  options: { backups?: PersistenceBackupsProvider } = {},
): PersistenceClient {
  const status = PersistenceStatusSchema.parse(statusInput);
  const unavailable = (): Promise<never> =>
    Promise.reject(
      new PersistenceUnavailableError(
        "Persistence is unavailable until the database migration is repaired.",
      ),
    );
  return {
    status() {
      return Promise.resolve(status);
    },
    backups: {
      list() {
        return Promise.resolve(
          options.backups?.list() ?? ([] as readonly PersistenceBackup[]),
        ).then((backups) => PersistenceBackupCollectionSchema.parse(backups));
      },
      restore(input) {
        const provider = options.backups;
        if (!provider) return unavailable();
        return Promise.resolve(
          provider.restore(PersistenceBackupRestoreInputSchema.parse(input)),
        ).then((result) => PersistenceBackupRestoreResultSchema.parse(result));
      },
    },
    projects: {
      list: unavailable,
      create: unavailable,
      get: unavailable,
      replace: unavailable,
      duplicate: unavailable,
      delete: unavailable,
    },
    settings: { getPacing: unavailable, updatePacing: unavailable },
    retention: {
      get: unavailable,
      update: unavailable,
      usage: unavailable,
      previewReclaim: unavailable,
      reclaim: unavailable,
    },
    preferences: {
      getIgnoredDiagnostics: unavailable,
      replaceIgnoredDiagnostics: unavailable,
    },
    globalLexicon: {
      list: unavailable,
      setBuiltInEnabled: unavailable,
      replaceCustom: unavailable,
      reimportBuiltIns: unavailable,
    },
  };
}
