import {
  CONNECTION_CHANNELS,
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
  EmptyResponseSchema,
  GlobalLexiconEntryCollectionSchema,
  IgnoredDiagnosticCollectionSchema,
  PERSISTENCE_CHANNELS,
  PersistenceBackupCollectionSchema,
  PersistenceBackupRestoreResultSchema,
  PersistenceStatusSchema,
  ProjectDetailSchema,
  PROJECT_PREVIEW_CHANNELS,
  ProjectPreviewResultSchema,
  ProjectSummaryCollectionSchema,
  RENDER_CHANNELS,
  RenderArtifactCollectionSchema,
  RenderArtifactExportResultSchema,
  RenderHistorySegmentCollectionSchema,
  RenderIdSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  RenderWaveformSchema,
  SYSTEM_DIAGNOSTICS_CHANNEL,
  SystemDiagnosticsSchema,
  SystemTimingConfigurationSchema,
  RedactedConnectionDiagnosticsSchema,
  SCRATCHPAD_CHANNELS,
  SCRIPT_GENERATION_CHANNELS,
  PromptDocumentSchema,
  FileExportResultSchema,
  ScratchpadPreviewResultSchema,
  SPEECH_CACHE_CHANNELS,
  SpeechCacheCleanupResultSchema,
  SpeechCacheStatusSchema,
  SpeechCatalogSchema,
  SpeechBackendConnectionSchema,
  VoiceCatalogSchema,
  type SpeechBackendConnectionClient,
  type PersistenceClient,
  type ProjectPreviewClient,
  type RenderClient,
  type ScratchpadClient,
  type ScriptGenerationClient,
  type SpeechCacheClient,
  type StudyNarratorBridge,
  type SystemDiagnostics,
  type VoiceCatalogClient,
} from "@studynarrator/shared-types";

export function createPreloadBridge(
  invoke: (channel: string, input?: unknown) => Promise<unknown>,
): StudyNarratorBridge {
  const persistence: PersistenceClient = {
    async status() {
      return PersistenceStatusSchema.parse(
        await invoke(PERSISTENCE_CHANNELS.status),
      );
    },
    backups: {
      async list() {
        return PersistenceBackupCollectionSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.backupsList),
        );
      },
      async restore(input) {
        return PersistenceBackupRestoreResultSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.backupsRestore, input),
        );
      },
    },
    projects: {
      async list() {
        return ProjectSummaryCollectionSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.projectsList),
        );
      },
      async create(input) {
        return ProjectDetailSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.projectsCreate, input),
        );
      },
      async get(projectId) {
        return ProjectDetailSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.projectsGet, { projectId }),
        );
      },
      async replace(projectId, project) {
        return ProjectDetailSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.projectsReplace, {
            projectId,
            project,
          }),
        );
      },
      async duplicate(projectId, duplicate) {
        return ProjectDetailSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.projectsDuplicate, {
            projectId,
            duplicate,
          }),
        );
      },
      async delete(projectId) {
        EmptyResponseSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.projectsDelete, { projectId }),
        );
      },
    },
    settings: {
      async getPacing() {
        return SystemTimingConfigurationSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.pacingGet),
        );
      },
      async updatePacing(input) {
        return SystemTimingConfigurationSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.pacingUpdate, input),
        );
      },
    },
    preferences: {
      async getIgnoredDiagnostics() {
        return IgnoredDiagnosticCollectionSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.ignoredGet),
        );
      },
      async replaceIgnoredDiagnostics(input) {
        return IgnoredDiagnosticCollectionSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.ignoredReplace, input),
        );
      },
    },
    globalLexicon: {
      async list() {
        return GlobalLexiconEntryCollectionSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.globalLexiconList),
        );
      },
      async replace(input) {
        return GlobalLexiconEntryCollectionSchema.parse(
          await invoke(PERSISTENCE_CHANNELS.globalLexiconReplace, input),
        );
      },
    },
  };
  Object.freeze(persistence);
  Object.freeze(persistence.settings);
  Object.freeze(persistence.preferences);
  Object.freeze(persistence.globalLexicon);
  const connection: SpeechBackendConnectionClient = {
    async get() {
      return SpeechBackendConnectionSchema.parse(
        await invoke(CONNECTION_CHANNELS.get),
      );
    },
    async update(input) {
      return SpeechBackendConnectionSchema.parse(
        await invoke(CONNECTION_CHANNELS.update, input),
      );
    },
    async test() {
      return ConnectionTestSummarySchema.parse(
        await invoke(CONNECTION_CHANNELS.test),
      );
    },
    async discoverSpeechCatalog(input) {
      return SpeechCatalogSchema.parse(
        await invoke(CONNECTION_CHANNELS.speechCatalogDiscover, input),
      );
    },
    async exportDiagnostics() {
      return RedactedConnectionDiagnosticsSchema.parse(
        await invoke(CONNECTION_CHANNELS.exportDiagnostics),
      );
    },
    async getSetupState() {
      return ConnectionSetupStateSchema.parse(
        await invoke(CONNECTION_CHANNELS.setupGet),
      );
    },
    async completeOnboarding() {
      return ConnectionSetupStateSchema.parse(
        await invoke(CONNECTION_CHANNELS.setupComplete),
      );
    },
  };
  const voiceCatalog: VoiceCatalogClient = {
    async get(modelId) {
      return VoiceCatalogSchema.parse(
        await invoke(CONNECTION_CHANNELS.voiceCatalogGet, { modelId }),
      );
    },
    async replace(input) {
      return VoiceCatalogSchema.parse(
        await invoke(CONNECTION_CHANNELS.voiceCatalogReplace, input),
      );
    },
  };
  const scratchpad: ScratchpadClient = {
    async preview(input) {
      return ScratchpadPreviewResultSchema.parse(
        await invoke(SCRATCHPAD_CHANNELS.preview, input),
      );
    },
  };
  const projectPreview: ProjectPreviewClient = {
    async preview(projectId, input) {
      return ProjectPreviewResultSchema.parse(
        await invoke(PROJECT_PREVIEW_CHANNELS.preview, {
          projectId,
          preview: input,
        }),
      );
    },
  };
  const speechCache: SpeechCacheClient = {
    async status() {
      return SpeechCacheStatusSchema.parse(
        await invoke(SPEECH_CACHE_CHANNELS.status),
      );
    },
    async clearAll() {
      return SpeechCacheCleanupResultSchema.parse(
        await invoke(SPEECH_CACHE_CHANNELS.clearAll),
      );
    },
    async clearProject(projectId) {
      return SpeechCacheCleanupResultSchema.parse(
        await invoke(SPEECH_CACHE_CHANNELS.clearProject, { projectId }),
      );
    },
    async clearEntry(cacheKey) {
      return SpeechCacheCleanupResultSchema.parse(
        await invoke(SPEECH_CACHE_CHANNELS.clearEntry, { cacheKey }),
      );
    },
  };
  const renders: RenderClient = {
    async startProject(projectId) {
      return RenderJobSchema.parse(
        await invoke(RENDER_CHANNELS.startProject, { projectId }),
      );
    },
    async list(projectId) {
      return RenderJobCollectionSchema.parse(
        await invoke(RENDER_CHANNELS.list, { projectId }),
      );
    },
    async get(renderId) {
      return RenderJobSchema.parse(
        await invoke(RENDER_CHANNELS.get, { renderId }),
      );
    },
    async cancel(renderId) {
      return RenderJobSchema.parse(
        await invoke(RENDER_CHANNELS.cancel, { renderId }),
      );
    },
    async retry(renderId) {
      return RenderJobSchema.parse(
        await invoke(RENDER_CHANNELS.retry, { renderId }),
      );
    },
    async listArtifacts(renderId) {
      return RenderArtifactCollectionSchema.parse(
        await invoke(RENDER_CHANNELS.artifacts, { renderId }),
      );
    },
    async exportArtifact(artifactId) {
      return RenderArtifactExportResultSchema.parse(
        await invoke(RENDER_CHANNELS.exportArtifact, { artifactId }),
      );
    },
    async exportAudio(renderId) {
      return RenderArtifactExportResultSchema.parse(
        await invoke(RENDER_CHANNELS.exportAudio, { renderId }),
      );
    },
    async exportDetails(renderId) {
      return RenderArtifactExportResultSchema.parse(
        await invoke(RENDER_CHANNELS.exportDetails, { renderId }),
      );
    },
    async listSegments(renderId) {
      return RenderHistorySegmentCollectionSchema.parse(
        await invoke(RENDER_CHANNELS.segments, { renderId }),
      );
    },
    async getWaveform(renderId) {
      return RenderWaveformSchema.parse(
        await invoke(RENDER_CHANNELS.waveform, { renderId }),
      );
    },
    renderAudioSource(renderId) {
      return `studynarrator-media://render/${RenderIdSchema.parse(renderId)}`;
    },
    segmentAudioSource(renderId, ordinal) {
      if (!Number.isInteger(ordinal) || ordinal < 1)
        throw new Error("The render segment ordinal is invalid.");
      return `studynarrator-media://segment/${RenderIdSchema.parse(renderId)}/${String(ordinal)}`;
    },
    async exportSegment(renderId, ordinal) {
      return RenderArtifactExportResultSchema.parse(
        await invoke(RENDER_CHANNELS.exportSegment, { renderId, ordinal }),
      );
    },
  };
  const scriptGeneration: ScriptGenerationClient = {
    async previewPrompt(projectId, kind) {
      return PromptDocumentSchema.parse(
        await invoke(SCRIPT_GENERATION_CHANNELS.previewPrompt, {
          projectId,
          kind,
        }),
      );
    },
    async exportPrompt(projectId, kind, content) {
      return FileExportResultSchema.parse(
        await invoke(SCRIPT_GENERATION_CHANNELS.exportPrompt, {
          projectId,
          kind,
          ...(content === undefined ? {} : { content }),
        }),
      );
    },
    async exportSkillPackage(projectId) {
      return FileExportResultSchema.parse(
        await invoke(SCRIPT_GENERATION_CHANNELS.exportSkillPackage, {
          projectId,
        }),
      );
    },
  };
  return Object.freeze({
    system: Object.freeze({
      async diagnostics(): Promise<SystemDiagnostics> {
        return SystemDiagnosticsSchema.parse(
          await invoke(SYSTEM_DIAGNOSTICS_CHANNEL),
        );
      },
    }),
    persistence: Object.freeze(persistence),
    connection: Object.freeze(connection),
    voiceCatalog: Object.freeze(voiceCatalog),
    scratchpad: Object.freeze(scratchpad),
    projectPreview: Object.freeze(projectPreview),
    speechCache: Object.freeze(speechCache),
    renders: Object.freeze(renders),
    scriptGeneration: Object.freeze(scriptGeneration),
  });
}
