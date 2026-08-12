import {
  ConnectionProfileCollectionSchema,
  ConnectionProfilePlaceholderSchema,
  EmptyResponseSchema,
  GlobalLexiconEntryCollectionSchema,
  IgnoredDiagnosticCollectionSchema,
  PERSISTENCE_CHANNELS,
  PersistenceStatusSchema,
  ProjectDetailSchema,
  ProjectSummaryCollectionSchema,
  SYSTEM_DIAGNOSTICS_CHANNEL,
  SystemDiagnosticsSchema,
  SystemPacingDefaultsSchema,
  type PersistenceClient,
  type StudyNarratorBridge,
  type SystemDiagnostics
} from "@studynarrator/shared-types";

export function createPreloadBridge(invoke: (channel: string, input?: unknown) => Promise<unknown>): StudyNarratorBridge {
  const persistence: PersistenceClient = {
    async status() { return PersistenceStatusSchema.parse(await invoke(PERSISTENCE_CHANNELS.status)); },
    projects: {
      async list() { return ProjectSummaryCollectionSchema.parse(await invoke(PERSISTENCE_CHANNELS.projectsList)); },
      async create(input) { return ProjectDetailSchema.parse(await invoke(PERSISTENCE_CHANNELS.projectsCreate, input)); },
      async get(projectId) { return ProjectDetailSchema.parse(await invoke(PERSISTENCE_CHANNELS.projectsGet, { projectId })); },
      async replace(projectId, project) { return ProjectDetailSchema.parse(await invoke(PERSISTENCE_CHANNELS.projectsReplace, { projectId, project })); },
      async duplicate(projectId, duplicate) { return ProjectDetailSchema.parse(await invoke(PERSISTENCE_CHANNELS.projectsDuplicate, { projectId, duplicate })); },
      async delete(projectId) { EmptyResponseSchema.parse(await invoke(PERSISTENCE_CHANNELS.projectsDelete, { projectId })); }
    },
    settings: {
      async getPacing() { return SystemPacingDefaultsSchema.parse(await invoke(PERSISTENCE_CHANNELS.pacingGet)); },
      async updatePacing(input) { return SystemPacingDefaultsSchema.parse(await invoke(PERSISTENCE_CHANNELS.pacingUpdate, input)); }
    },
    preferences: {
      async getIgnoredDiagnostics() { return IgnoredDiagnosticCollectionSchema.parse(await invoke(PERSISTENCE_CHANNELS.ignoredGet)); },
      async replaceIgnoredDiagnostics(input) { return IgnoredDiagnosticCollectionSchema.parse(await invoke(PERSISTENCE_CHANNELS.ignoredReplace, input)); }
    },
    globalLexicon: {
      async list() { return GlobalLexiconEntryCollectionSchema.parse(await invoke(PERSISTENCE_CHANNELS.globalLexiconList)); },
      async replace(input) { return GlobalLexiconEntryCollectionSchema.parse(await invoke(PERSISTENCE_CHANNELS.globalLexiconReplace, input)); }
    },
    connectionProfiles: {
      async list() { return ConnectionProfileCollectionSchema.parse(await invoke(PERSISTENCE_CHANNELS.connectionProfilesList)); },
      async create(input) { return ConnectionProfilePlaceholderSchema.parse(await invoke(PERSISTENCE_CHANNELS.connectionProfilesCreate, input)); },
      async replace(profileId, profile) { return ConnectionProfilePlaceholderSchema.parse(await invoke(PERSISTENCE_CHANNELS.connectionProfilesReplace, { profileId, profile })); },
      async delete(profileId) { EmptyResponseSchema.parse(await invoke(PERSISTENCE_CHANNELS.connectionProfilesDelete, { profileId })); }
    }
  };
  Object.freeze(persistence.projects);
  Object.freeze(persistence.settings);
  Object.freeze(persistence.preferences);
  Object.freeze(persistence.globalLexicon);
  Object.freeze(persistence.connectionProfiles);
  return Object.freeze({
    system: Object.freeze({
      async diagnostics(): Promise<SystemDiagnostics> {
        return SystemDiagnosticsSchema.parse(await invoke(SYSTEM_DIAGNOSTICS_CHANNEL));
      }
    }),
    persistence: Object.freeze(persistence)
  });
}
