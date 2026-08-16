import {
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PersistenceStatusSchema,
  ProjectCreateInputSchema,
  ProjectDetailSchema,
  ProjectDuplicateInputSchema,
  ProjectIdSchema,
  ProjectReplaceInputSchema,
  ProjectSummaryCollectionSchema,
  SystemTimingConfigurationSchema,
  type GlobalLexiconReplaceInput,
  type IgnoredDiagnosticCollection,
  type PersistenceClient,
  type PersistenceStatus,
  type ProjectCreateInput,
  type ProjectDetail,
  type ProjectDuplicateInput,
  type ProjectReplaceInput,
  type ProjectSummary,
  type SystemTimingConfiguration
} from "@studynarrator/shared-types";
import type { LexiconEntry } from "@studynarrator/core";

export interface PersistenceRepository {
  status(): PersistenceStatus;
  listProjects(): ProjectSummary[];
  createProject(input: ProjectCreateInput): ProjectDetail;
  getProject(projectId: string): ProjectDetail;
  replaceProject(projectId: string, input: ProjectReplaceInput, speechCacheKeys?: readonly string[]): ProjectDetail;
  duplicateProject(projectId: string, input: ProjectDuplicateInput): ProjectDetail;
  deleteProject(projectId: string): void;
  getSystemPacing(): SystemTimingConfiguration;
  updateSystemPacing(input: SystemTimingConfiguration): SystemTimingConfiguration;
  getIgnoredDiagnostics(): IgnoredDiagnosticCollection;
  replaceIgnoredDiagnostics(input: IgnoredDiagnosticCollection): IgnoredDiagnosticCollection;
  listGlobalLexicon(): LexiconEntry[];
  replaceGlobalLexicon(input: GlobalLexiconReplaceInput): LexiconEntry[];
}

export class PersistenceUnavailableError extends Error {
  readonly code = "PERSISTENCE_UNAVAILABLE";
}

export function createPersistenceService(repository: PersistenceRepository, options: {
  projectSpeechCacheKeys?: (input: ProjectReplaceInput) => readonly string[] | undefined;
} = {}): PersistenceClient {
  const execute = <T>(operation: () => T): Promise<T> => Promise.resolve().then(operation);
  return {
    status() {
      return execute(() => PersistenceStatusSchema.parse(repository.status()));
    },
    projects: {
      list() {
        return execute(() => ProjectSummaryCollectionSchema.parse(repository.listProjects()));
      },
      create(input) {
        return execute(() => ProjectDetailSchema.parse(repository.createProject(ProjectCreateInputSchema.parse(input))));
      },
      get(projectId) {
        return execute(() => ProjectDetailSchema.parse(repository.getProject(ProjectIdSchema.parse(projectId))));
      },
      replace(projectId, input) {
        return execute(() => {
          const parsed = ProjectReplaceInputSchema.parse(input);
          return ProjectDetailSchema.parse(repository.replaceProject(ProjectIdSchema.parse(projectId), parsed, options.projectSpeechCacheKeys?.(parsed)));
        });
      },
      duplicate(projectId, input) {
        return execute(() => ProjectDetailSchema.parse(repository.duplicateProject(ProjectIdSchema.parse(projectId), ProjectDuplicateInputSchema.parse(input))));
      },
      delete(projectId) {
        return execute(() => { repository.deleteProject(ProjectIdSchema.parse(projectId)); });
      }
    },
    settings: {
      getPacing() {
        return execute(() => SystemTimingConfigurationSchema.parse(repository.getSystemPacing()));
      },
      updatePacing(input) {
        return execute(() => SystemTimingConfigurationSchema.parse(repository.updateSystemPacing(SystemTimingConfigurationSchema.parse(input))));
      }
    },
    preferences: {
      getIgnoredDiagnostics() {
        return execute(() => IgnoredDiagnosticCollectionSchema.parse(repository.getIgnoredDiagnostics()));
      },
      replaceIgnoredDiagnostics(input) {
        return execute(() => IgnoredDiagnosticCollectionSchema.parse(repository.replaceIgnoredDiagnostics(IgnoredDiagnosticCollectionSchema.parse(input))));
      }
    },
    globalLexicon: {
      list() {
        return execute(() => GlobalLexiconEntryCollectionSchema.parse(repository.listGlobalLexicon()));
      },
      replace(input) {
        return execute(() => GlobalLexiconEntryCollectionSchema.parse(repository.replaceGlobalLexicon(GlobalLexiconReplaceInputSchema.parse(input))));
      }
    }
  };
}

export function createUnavailablePersistenceService(statusInput: PersistenceStatus): PersistenceClient {
  const status = PersistenceStatusSchema.parse(statusInput);
  const unavailable = (): Promise<never> => Promise.reject(
    new PersistenceUnavailableError("Persistence is unavailable until the database migration is repaired.")
  );
  return {
    status() { return Promise.resolve(status); },
    projects: { list: unavailable, create: unavailable, get: unavailable, replace: unavailable, duplicate: unavailable, delete: unavailable },
    settings: { getPacing: unavailable, updatePacing: unavailable },
    preferences: { getIgnoredDiagnostics: unavailable, replaceIgnoredDiagnostics: unavailable },
    globalLexicon: { list: unavailable, replace: unavailable }
  };
}
