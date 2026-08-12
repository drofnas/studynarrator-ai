import {
  ConnectionProfileAuthoringSchema,
  ConnectionProfileCollectionSchema,
  ConnectionProfilePlaceholderSchema,
  DurableIdSchema,
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
  SystemPacingDefaultsSchema,
  type ConnectionProfileAuthoring,
  type ConnectionProfilePlaceholder,
  type GlobalLexiconReplaceInput,
  type IgnoredDiagnosticCollection,
  type PersistenceClient,
  type PersistenceStatus,
  type ProjectCreateInput,
  type ProjectDetail,
  type ProjectDuplicateInput,
  type ProjectReplaceInput,
  type ProjectSummary,
  type SystemPacingDefaults
} from "@studynarrator/shared-types";
import type { LexiconEntry } from "@studynarrator/core";

export interface PersistenceRepository {
  status(): PersistenceStatus;
  listProjects(): ProjectSummary[];
  createProject(input: ProjectCreateInput): ProjectDetail;
  getProject(projectId: string): ProjectDetail;
  replaceProject(projectId: string, input: ProjectReplaceInput): ProjectDetail;
  duplicateProject(projectId: string, input: ProjectDuplicateInput): ProjectDetail;
  deleteProject(projectId: string): void;
  getSystemPacing(): SystemPacingDefaults;
  updateSystemPacing(input: SystemPacingDefaults): SystemPacingDefaults;
  getIgnoredDiagnostics(): IgnoredDiagnosticCollection;
  replaceIgnoredDiagnostics(input: IgnoredDiagnosticCollection): IgnoredDiagnosticCollection;
  listGlobalLexicon(): LexiconEntry[];
  replaceGlobalLexicon(input: GlobalLexiconReplaceInput): LexiconEntry[];
  listConnectionProfiles(): ConnectionProfilePlaceholder[];
  createConnectionProfile(input: ConnectionProfileAuthoring): ConnectionProfilePlaceholder;
  replaceConnectionProfile(profileId: string, input: ConnectionProfileAuthoring): ConnectionProfilePlaceholder;
  deleteConnectionProfile(profileId: string): void;
}

export class PersistenceUnavailableError extends Error {
  readonly code = "PERSISTENCE_UNAVAILABLE";
}

export function createPersistenceService(repository: PersistenceRepository): PersistenceClient {
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
        return execute(() => ProjectDetailSchema.parse(repository.replaceProject(ProjectIdSchema.parse(projectId), ProjectReplaceInputSchema.parse(input))));
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
        return execute(() => SystemPacingDefaultsSchema.parse(repository.getSystemPacing()));
      },
      updatePacing(input) {
        return execute(() => SystemPacingDefaultsSchema.parse(repository.updateSystemPacing(SystemPacingDefaultsSchema.parse(input))));
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
    },
    connectionProfiles: {
      list() {
        return execute(() => ConnectionProfileCollectionSchema.parse(repository.listConnectionProfiles()));
      },
      create(input) {
        return execute(() => ConnectionProfilePlaceholderSchema.parse(repository.createConnectionProfile(ConnectionProfileAuthoringSchema.parse(input))));
      },
      replace(profileId, input) {
        return execute(() => ConnectionProfilePlaceholderSchema.parse(repository.replaceConnectionProfile(DurableIdSchema.parse(profileId), ConnectionProfileAuthoringSchema.parse(input))));
      },
      delete(profileId) {
        return execute(() => { repository.deleteConnectionProfile(DurableIdSchema.parse(profileId)); });
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
    globalLexicon: { list: unavailable, replace: unavailable },
    connectionProfiles: { list: unavailable, create: unavailable, replace: unavailable, delete: unavailable }
  };
}
