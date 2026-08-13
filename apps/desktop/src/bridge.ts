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
  PROJECT_PREVIEW_CHANNELS,
  ProjectPreviewResultSchema,
  ProjectSummaryCollectionSchema,
  RENDER_PLAN_CHANNELS,
  RenderPlanSchema,
  RenderPlanSummaryCollectionSchema,
  RENDER_CHANNELS,
  RenderArtifactCollectionSchema,
  RenderArtifactExportResultSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  SYSTEM_DIAGNOSTICS_CHANNEL,
  SystemDiagnosticsSchema,
  SystemPacingDefaultsSchema,
  RedactedConnectionDiagnosticsSchema,
  SCRATCHPAD_CHANNELS,
  ScratchpadPreviewResultSchema,
  SPEECH_CACHE_CHANNELS,
  SpeechCacheCleanupResultSchema,
  SpeechCacheStatusSchema,
  SpeechCatalogSchema,
  VoiceCatalogSchema,
  type ConnectionsClient,
  type PersistenceClient,
  type ProjectPreviewClient,
  type RenderPlanClient,
  type RenderClient,
  type ScratchpadClient,
  type SpeechCacheClient,
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
    async discoverSpeechCatalog(profileId) { return SpeechCatalogSchema.parse(await invoke(CONNECTION_CHANNELS.speechCatalogDiscover, { profileId })); },
    async exportDiagnostics(profileId) { return RedactedConnectionDiagnosticsSchema.parse(await invoke(CONNECTION_CHANNELS.exportDiagnostics, { profileId })); },
    async getSetupState() { return ConnectionSetupStateSchema.parse(await invoke(CONNECTION_CHANNELS.setupGet)); },
    async setActiveProfile(profileId) { return ConnectionSetupStateSchema.parse(await invoke(CONNECTION_CHANNELS.setupSetActive, { profileId })); },
    async completeOnboarding() { return ConnectionSetupStateSchema.parse(await invoke(CONNECTION_CHANNELS.setupComplete)); }
  };
  const voiceCatalog: VoiceCatalogClient = {
    async get(modelId) { return VoiceCatalogSchema.parse(await invoke(CONNECTION_CHANNELS.voiceCatalogGet, { modelId })); },
    async replace(input) { return VoiceCatalogSchema.parse(await invoke(CONNECTION_CHANNELS.voiceCatalogReplace, input)); }
  };
  const scratchpad: ScratchpadClient = {
    async preview(input) {
      return ScratchpadPreviewResultSchema.parse(await invoke(SCRATCHPAD_CHANNELS.preview, input));
    }
  };
  const projectPreview: ProjectPreviewClient = {
    async preview(projectId, input) {
      return ProjectPreviewResultSchema.parse(await invoke(PROJECT_PREVIEW_CHANNELS.preview, { projectId, preview: input }));
    }
  };
  const speechCache: SpeechCacheClient = {
    async status() { return SpeechCacheStatusSchema.parse(await invoke(SPEECH_CACHE_CHANNELS.status)); },
    async clearAll() { return SpeechCacheCleanupResultSchema.parse(await invoke(SPEECH_CACHE_CHANNELS.clearAll)); },
    async clearProject(projectId) {
      return SpeechCacheCleanupResultSchema.parse(await invoke(SPEECH_CACHE_CHANNELS.clearProject, { projectId }));
    },
    async clearEntry(cacheKey) {
      return SpeechCacheCleanupResultSchema.parse(await invoke(SPEECH_CACHE_CHANNELS.clearEntry, { cacheKey }));
    }
  };
  const renderPlans: RenderPlanClient = {
    async create(projectId) {
      return RenderPlanSchema.parse(await invoke(RENDER_PLAN_CHANNELS.create, { projectId }));
    },
    async list(projectId) {
      return RenderPlanSummaryCollectionSchema.parse(await invoke(RENDER_PLAN_CHANNELS.list, { projectId }));
    },
    async get(planId) {
      return RenderPlanSchema.parse(await invoke(RENDER_PLAN_CHANNELS.get, { planId }));
    }
  };
  const renders: RenderClient = {
    async start(planId) { return RenderJobSchema.parse(await invoke(RENDER_CHANNELS.start, { planId })); },
    async list(projectId) { return RenderJobCollectionSchema.parse(await invoke(RENDER_CHANNELS.list, { projectId })); },
    async get(renderId) { return RenderJobSchema.parse(await invoke(RENDER_CHANNELS.get, { renderId })); },
    async cancel(renderId) { return RenderJobSchema.parse(await invoke(RENDER_CHANNELS.cancel, { renderId })); },
    async retry(renderId) { return RenderJobSchema.parse(await invoke(RENDER_CHANNELS.retry, { renderId })); },
    async listArtifacts(renderId) { return RenderArtifactCollectionSchema.parse(await invoke(RENDER_CHANNELS.artifacts, { renderId })); },
    async exportArtifact(artifactId) { return RenderArtifactExportResultSchema.parse(await invoke(RENDER_CHANNELS.exportArtifact, { artifactId })); }
  };
  return Object.freeze({
    system: Object.freeze({
      async diagnostics(): Promise<SystemDiagnostics> {
        return SystemDiagnosticsSchema.parse(await invoke(SYSTEM_DIAGNOSTICS_CHANNEL));
      }
    }),
    persistence: Object.freeze(persistence),
    connections: Object.freeze(connections),
    voiceCatalog: Object.freeze(voiceCatalog),
    scratchpad: Object.freeze(scratchpad),
    projectPreview: Object.freeze(projectPreview),
    speechCache: Object.freeze(speechCache),
    renderPlans: Object.freeze(renderPlans),
    renders: Object.freeze(renders)
  });
}
