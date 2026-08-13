import {
  ActiveConnectionProfileInputSchema,
  CONNECTION_CHANNELS,
  ConnectionProfileCollectionSchema,
  ConnectionProfileIdInputSchema,
  ConnectionProfileMutationRequestSchema,
  ConnectionProfileMutationSchema,
  ConnectionProfileSchema,
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
  EmptyResponseSchema,
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PERSISTENCE_CHANNELS,
  PersistenceStatusSchema,
  ProjectCreateInputSchema,
  ProjectDetailSchema,
  ProjectDuplicateRequestSchema,
  ProjectIdInputSchema,
  PROJECT_PREVIEW_CHANNELS,
  ProjectPreviewRequestSchema,
  ProjectPreviewResultSchema,
  ProjectReplaceRequestSchema,
  ProjectSummaryCollectionSchema,
  SYSTEM_DIAGNOSTICS_CHANNEL,
  SystemDiagnosticsSchema,
  SystemPacingDefaultsSchema,
  RedactedConnectionDiagnosticsSchema,
  SCRATCHPAD_CHANNELS,
  ScratchpadPreviewInputSchema,
  ScratchpadPreviewResultSchema,
  SpeechCatalogSchema,
  SPEECH_CACHE_CHANNELS,
  SpeechCacheCleanupResultSchema,
  SpeechCacheKeyInputSchema,
  SpeechCacheProjectInputSchema,
  SpeechCacheStatusSchema,
  VoiceCatalogModelInputSchema,
  VoiceCatalogSchema,
  type ConnectionsClient,
  type PersistenceClient,
  type ProjectPreviewClient,
  type ScratchpadClient,
  type SpeechCacheClient,
  type VoiceCatalogClient
} from "@studynarrator/shared-types";
import type { DiagnosticsContext, SystemService } from "@studynarrator/application";

export const PUBLIC_IPC_CHANNEL_MANIFEST = Object.freeze([
  SYSTEM_DIAGNOSTICS_CHANNEL,
  ...Object.values(PERSISTENCE_CHANNELS),
  ...Object.values(CONNECTION_CHANNELS),
  ...Object.values(SCRATCHPAD_CHANNELS),
  ...Object.values(PROJECT_PREVIEW_CHANNELS),
  ...Object.values(SPEECH_CACHE_CHANNELS)
]);

interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, input?: unknown) => Promise<unknown>): void;
  removeHandler(channel: string): void;
}

export function registerDiagnosticsHandler(
  ipcMain: IpcMainLike,
  service: SystemService,
  context: DiagnosticsContext
) {
  ipcMain.removeHandler(SYSTEM_DIAGNOSTICS_CHANNEL);
  ipcMain.handle(SYSTEM_DIAGNOSTICS_CHANNEL, async () => {
    return SystemDiagnosticsSchema.parse(await service.diagnostics(context));
  });
}

export function registerPersistenceHandlers(ipcMain: IpcMainLike, persistence: PersistenceClient) {
  const handle = (channel: string, listener: (input: unknown) => Promise<unknown>) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, input) => {
      try {
        return await listener(input);
      } catch (error) {
        const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
        const safe = record && Array.isArray(record.issues)
          ? new Error("The request does not match the persistence contract.")
          : record?.code === "PERSISTENCE_NOT_FOUND"
            ? new Error("The requested persistence record does not exist.")
            : record?.code === "PERSISTENCE_CONFLICT"
              ? new Error("The persistence operation conflicts with existing data.")
              : record?.code === "PERSISTENCE_UNAVAILABLE"
                ? new Error("Persistence is unavailable until the database migration is repaired.")
                : new Error("StudyNarrator could not complete the persistence operation.");
        throw safe;
      }
    });
  };
  handle(PERSISTENCE_CHANNELS.status, async () => PersistenceStatusSchema.parse(await persistence.status()));
  handle(PERSISTENCE_CHANNELS.projectsList, async () => ProjectSummaryCollectionSchema.parse(await persistence.projects.list()));
  handle(PERSISTENCE_CHANNELS.projectsCreate, async (input) => ProjectDetailSchema.parse(await persistence.projects.create(ProjectCreateInputSchema.parse(input))));
  handle(PERSISTENCE_CHANNELS.projectsGet, async (input) => {
    const request = ProjectIdInputSchema.parse(input);
    return ProjectDetailSchema.parse(await persistence.projects.get(request.projectId));
  });
  handle(PERSISTENCE_CHANNELS.projectsReplace, async (input) => {
    const request = ProjectReplaceRequestSchema.parse(input);
    return ProjectDetailSchema.parse(await persistence.projects.replace(request.projectId, request.project));
  });
  handle(PERSISTENCE_CHANNELS.projectsDuplicate, async (input) => {
    const request = ProjectDuplicateRequestSchema.parse(input);
    return ProjectDetailSchema.parse(await persistence.projects.duplicate(request.projectId, request.duplicate));
  });
  handle(PERSISTENCE_CHANNELS.projectsDelete, async (input) => {
    const request = ProjectIdInputSchema.parse(input);
    await persistence.projects.delete(request.projectId);
    return EmptyResponseSchema.parse({});
  });
  handle(PERSISTENCE_CHANNELS.pacingGet, async () => SystemPacingDefaultsSchema.parse(await persistence.settings.getPacing()));
  handle(PERSISTENCE_CHANNELS.pacingUpdate, async (input) => SystemPacingDefaultsSchema.parse(await persistence.settings.updatePacing(SystemPacingDefaultsSchema.parse(input))));
  handle(PERSISTENCE_CHANNELS.ignoredGet, async () => IgnoredDiagnosticCollectionSchema.parse(await persistence.preferences.getIgnoredDiagnostics()));
  handle(PERSISTENCE_CHANNELS.ignoredReplace, async (input) => IgnoredDiagnosticCollectionSchema.parse(await persistence.preferences.replaceIgnoredDiagnostics(IgnoredDiagnosticCollectionSchema.parse(input))));
  handle(PERSISTENCE_CHANNELS.globalLexiconList, async () => GlobalLexiconEntryCollectionSchema.parse(await persistence.globalLexicon.list()));
  handle(PERSISTENCE_CHANNELS.globalLexiconReplace, async (input) => GlobalLexiconEntryCollectionSchema.parse(await persistence.globalLexicon.replace(GlobalLexiconReplaceInputSchema.parse(input))));
}

export function registerConnectionHandlers(
  ipcMain: IpcMainLike,
  connections: ConnectionsClient,
  voiceCatalog: VoiceCatalogClient
) {
  const handle = (channel: string, listener: (input: unknown) => Promise<unknown>) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, input) => {
      try {
        return await listener(input);
      } catch (error) {
        const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
        // The original error is intentionally not attached: it may contain a one-shot credential.
        /* eslint-disable preserve-caught-error */
        if (record && Array.isArray(record.issues)) throw new Error("The request does not match the connection contract.");
        if (record?.code === "CONNECTION_POLICY" && typeof record.message === "string") throw new Error(record.message);
        if (typeof record?.code === "string" && record.code.startsWith("CONNECTION_CATALOG_") && typeof record.message === "string") throw new Error(record.message);
        if (record?.code === "PERSISTENCE_NOT_FOUND") throw new Error("The requested connection profile does not exist.");
        throw new Error("StudyNarrator could not complete the connection operation.");
        /* eslint-enable preserve-caught-error */
      }
    });
  };
  handle(CONNECTION_CHANNELS.list, async () => ConnectionProfileCollectionSchema.parse(await connections.list()));
  handle(CONNECTION_CHANNELS.create, async (input) => ConnectionProfileSchema.parse(await connections.create(ConnectionProfileMutationSchema.parse(input))));
  handle(CONNECTION_CHANNELS.replace, async (input) => {
    const request = ConnectionProfileMutationRequestSchema.parse(input);
    return ConnectionProfileSchema.parse(await connections.replace(request.profileId, request.mutation));
  });
  handle(CONNECTION_CHANNELS.delete, async (input) => {
    await connections.delete(ConnectionProfileIdInputSchema.parse(input).profileId);
    return EmptyResponseSchema.parse({});
  });
  handle(CONNECTION_CHANNELS.test, async (input) => ConnectionTestSummarySchema.parse(await connections.test(ConnectionProfileIdInputSchema.parse(input).profileId)));
  handle(CONNECTION_CHANNELS.speechCatalogDiscover, async (input) => SpeechCatalogSchema.parse(await connections.discoverSpeechCatalog(ConnectionProfileIdInputSchema.parse(input).profileId)));
  handle(CONNECTION_CHANNELS.exportDiagnostics, async (input) => RedactedConnectionDiagnosticsSchema.parse(await connections.exportDiagnostics(ConnectionProfileIdInputSchema.parse(input).profileId)));
  handle(CONNECTION_CHANNELS.setupGet, async () => ConnectionSetupStateSchema.parse(await connections.getSetupState()));
  handle(CONNECTION_CHANNELS.setupSetActive, async (input) => ConnectionSetupStateSchema.parse(await connections.setActiveProfile(ActiveConnectionProfileInputSchema.parse(input).profileId)));
  handle(CONNECTION_CHANNELS.setupComplete, async () => ConnectionSetupStateSchema.parse(await connections.completeOnboarding()));
  handle(CONNECTION_CHANNELS.voiceCatalogGet, async (input) => VoiceCatalogSchema.parse(await voiceCatalog.get(VoiceCatalogModelInputSchema.parse(input).modelId)));
  handle(CONNECTION_CHANNELS.voiceCatalogReplace, async (input) => VoiceCatalogSchema.parse(await voiceCatalog.replace(VoiceCatalogSchema.parse(input))));
}

export function registerScratchpadHandlers(ipcMain: IpcMainLike, scratchpad: ScratchpadClient) {
  ipcMain.removeHandler(SCRATCHPAD_CHANNELS.preview);
  ipcMain.handle(SCRATCHPAD_CHANNELS.preview, async (_event, input) => {
    try {
      return ScratchpadPreviewResultSchema.parse(await scratchpad.preview(ScratchpadPreviewInputSchema.parse(input)));
    } catch (error) {
      const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
      /* eslint-disable preserve-caught-error */
      if (record && Array.isArray(record.issues)) throw new Error("The request does not match the Scratchpad contract.");
      if (typeof record?.code === "string" && record.code.startsWith("SCRATCHPAD_") && typeof record.message === "string") {
        throw new Error(record.message);
      }
      throw new Error("StudyNarrator could not complete speech synthesis.");
      /* eslint-enable preserve-caught-error */
    }
  });
}

export function registerProjectPreviewHandlers(ipcMain: IpcMainLike, projectPreview: ProjectPreviewClient) {
  ipcMain.removeHandler(PROJECT_PREVIEW_CHANNELS.preview);
  ipcMain.handle(PROJECT_PREVIEW_CHANNELS.preview, async (_event, input) => {
    try {
      const request = ProjectPreviewRequestSchema.parse(input);
      return ProjectPreviewResultSchema.parse(await projectPreview.preview(request.projectId, request.preview));
    } catch (error) {
      const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
      /* eslint-disable preserve-caught-error */
      if (record && Array.isArray(record.issues)) throw new Error("The request does not match the project preview contract.");
      if (typeof record?.code === "string" && record.code.startsWith("PROJECT_PREVIEW_") && typeof record.message === "string") {
        throw new Error(record.message);
      }
      throw new Error("StudyNarrator could not complete the project preview.");
      /* eslint-enable preserve-caught-error */
    }
  });
}

export function registerSpeechCacheHandlers(ipcMain: IpcMainLike, speechCache: SpeechCacheClient) {
  const handle = (channel: string, listener: (input: unknown) => Promise<unknown>) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, input) => {
      try {
        return await listener(input);
      } catch (error) {
        const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
        /* eslint-disable preserve-caught-error */
        if (record && Array.isArray(record.issues)) throw new Error("The request does not match the speech cache contract.");
        throw new Error("StudyNarrator could not complete the speech cache operation.");
        /* eslint-enable preserve-caught-error */
      }
    });
  };
  handle(SPEECH_CACHE_CHANNELS.status, async () => SpeechCacheStatusSchema.parse(await speechCache.status()));
  handle(SPEECH_CACHE_CHANNELS.clearAll, async () => SpeechCacheCleanupResultSchema.parse(await speechCache.clearAll()));
  handle(SPEECH_CACHE_CHANNELS.clearProject, async (input) => {
    const { projectId } = SpeechCacheProjectInputSchema.parse(input);
    return SpeechCacheCleanupResultSchema.parse(await speechCache.clearProject(projectId));
  });
  handle(SPEECH_CACHE_CHANNELS.clearEntry, async (input) => {
    const { cacheKey } = SpeechCacheKeyInputSchema.parse(input);
    return SpeechCacheCleanupResultSchema.parse(await speechCache.clearEntry(cacheKey));
  });
}
