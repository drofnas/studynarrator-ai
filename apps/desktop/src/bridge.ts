import {
  CONNECTION_CHANNELS,
  ConnectionProfileCollectionSchema,
  ConnectionProfileSchema,
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
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
  RedactedConnectionDiagnosticsSchema,
  VoiceCatalogSchema,
  type ConnectionsClient,
  type PersistenceClient,
  type StudyNarratorBridge,
  type SystemDiagnostics,
  type VoiceCatalogClient
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
    }
  };
  Object.freeze(persistence.projects);
  Object.freeze(persistence.settings);
  Object.freeze(persistence.preferences);
  Object.freeze(persistence.globalLexicon);
  const connections: ConnectionsClient = {
    async list() { return ConnectionProfileCollectionSchema.parse(await invoke(CONNECTION_CHANNELS.list)); },
    async create(input) { return ConnectionProfileSchema.parse(await invoke(CONNECTION_CHANNELS.create, input)); },
    async replace(profileId, mutation) { return ConnectionProfileSchema.parse(await invoke(CONNECTION_CHANNELS.replace, { profileId, mutation })); },
    async delete(profileId) { EmptyResponseSchema.parse(await invoke(CONNECTION_CHANNELS.delete, { profileId })); },
    async test(profileId) { return ConnectionTestSummarySchema.parse(await invoke(CONNECTION_CHANNELS.test, { profileId })); },
    async exportDiagnostics(profileId) { return RedactedConnectionDiagnosticsSchema.parse(await invoke(CONNECTION_CHANNELS.exportDiagnostics, { profileId })); },
    async getSetupState() { return ConnectionSetupStateSchema.parse(await invoke(CONNECTION_CHANNELS.setupGet)); },
    async setActiveProfile(profileId) { return ConnectionSetupStateSchema.parse(await invoke(CONNECTION_CHANNELS.setupSetActive, { profileId })); },
    async completeOnboarding() { return ConnectionSetupStateSchema.parse(await invoke(CONNECTION_CHANNELS.setupComplete)); }
  };
  const voiceCatalog: VoiceCatalogClient = {
    async get(modelId) { return VoiceCatalogSchema.parse(await invoke(CONNECTION_CHANNELS.voiceCatalogGet, { modelId })); },
    async replace(input) { return VoiceCatalogSchema.parse(await invoke(CONNECTION_CHANNELS.voiceCatalogReplace, input)); }
  };
  return Object.freeze({
    system: Object.freeze({
      async diagnostics(): Promise<SystemDiagnostics> {
        return SystemDiagnosticsSchema.parse(await invoke(SYSTEM_DIAGNOSTICS_CHANNEL));
      }
    }),
    persistence: Object.freeze(persistence),
    connections: Object.freeze(connections),
    voiceCatalog: Object.freeze(voiceCatalog)
  });
}
