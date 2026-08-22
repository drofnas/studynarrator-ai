import { copyFile, writeFile } from "node:fs/promises";
import {
  CONNECTION_CHANNELS,
  ConnectionSetupStateSchema,
  ConnectionTestSummarySchema,
  EmptyResponseSchema,
  GlobalLexiconEntryCollectionSchema,
  GlobalLexiconReplaceInputSchema,
  IgnoredDiagnosticCollectionSchema,
  PERSISTENCE_CHANNELS,
  PersistenceBackupCollectionSchema,
  PersistenceBackupRestoreInputSchema,
  PersistenceBackupRestoreResultSchema,
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
  RENDER_CHANNELS,
  RenderArtifactCollectionSchema,
  RenderArtifactExportResultSchema,
  RenderArtifactInputSchema,
  RenderEstimateContextInputSchema,
  RenderEstimateContextResultSchema,
  RenderHistorySegmentCollectionSchema,
  RenderIdInputSchema,
  RenderJobCollectionSchema,
  RenderJobSchema,
  RenderProjectInputSchema,
  RenderProjectStartInputSchema,
  RenderSegmentInputSchema,
  RenderWaveformSchema,
  SYSTEM_DIAGNOSTICS_CHANNEL,
  SystemDiagnosticsSchema,
  SystemTimingConfigurationSchema,
  RedactedConnectionDiagnosticsSchema,
  SCRATCHPAD_CHANNELS,
  SCRIPT_GENERATION_CHANNELS,
  ScriptGenerationPromptExportRequestSchema,
  ScriptGenerationPromptRequestSchema,
  ScriptGenerationSkillRequestSchema,
  PromptDocumentSchema,
  FileExportResultSchema,
  ScratchpadPreviewInputSchema,
  ScratchpadPreviewResultSchema,
  SpeechCatalogSchema,
  SpeechCatalogDiscoveryInputSchema,
  SpeechBackendConnectionAuthoringSchema,
  SpeechBackendConnectionSchema,
  SPEECH_CACHE_CHANNELS,
  SpeechCacheCleanupResultSchema,
  SpeechCacheKeyInputSchema,
  SpeechCacheProjectInputSchema,
  SpeechCacheStatusSchema,
  VoiceCatalogModelInputSchema,
  VoiceCatalogSchema,
  type SpeechBackendConnectionClient,
  type PersistenceClient,
  type ProjectPreviewClient,
  type ScratchpadClient,
  type SpeechCacheClient,
  type VoiceCatalogClient,
} from "@studynarrator/shared-types";
import type {
  DiagnosticsContext,
  RenderService,
  ScriptGenerationService,
  SystemService,
} from "@studynarrator/application";

export const PUBLIC_IPC_CHANNEL_MANIFEST = Object.freeze([
  SYSTEM_DIAGNOSTICS_CHANNEL,
  ...Object.values(PERSISTENCE_CHANNELS),
  ...Object.values(CONNECTION_CHANNELS),
  ...Object.values(SCRATCHPAD_CHANNELS),
  ...Object.values(PROJECT_PREVIEW_CHANNELS),
  ...Object.values(SPEECH_CACHE_CHANNELS),
  ...Object.values(RENDER_CHANNELS),
  ...Object.values(SCRIPT_GENERATION_CHANNELS),
]);

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, input?: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

export function registerDiagnosticsHandler(
  ipcMain: IpcMainLike,
  service: SystemService,
  context: DiagnosticsContext,
) {
  ipcMain.removeHandler(SYSTEM_DIAGNOSTICS_CHANNEL);
  ipcMain.handle(SYSTEM_DIAGNOSTICS_CHANNEL, async () => {
    return SystemDiagnosticsSchema.parse(await service.diagnostics(context));
  });
}

export function registerPersistenceHandlers(
  ipcMain: IpcMainLike,
  persistence: PersistenceClient,
) {
  const handle = (
    channel: string,
    listener: (input: unknown) => Promise<unknown>,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, input) => {
      try {
        return await listener(input);
      } catch (error) {
        const record =
          error && typeof error === "object"
            ? (error as Record<string, unknown>)
            : undefined;
        const safe = safePersistenceError(record);
        throw safe;
      }
    });
  };
  handle(PERSISTENCE_CHANNELS.status, async () =>
    PersistenceStatusSchema.parse(await persistence.status()),
  );
  handle(PERSISTENCE_CHANNELS.projectsList, async () =>
    ProjectSummaryCollectionSchema.parse(await persistence.projects.list()),
  );
  handle(PERSISTENCE_CHANNELS.projectsCreate, async (input) =>
    ProjectDetailSchema.parse(
      await persistence.projects.create(ProjectCreateInputSchema.parse(input)),
    ),
  );
  handle(PERSISTENCE_CHANNELS.projectsGet, async (input) => {
    const request = ProjectIdInputSchema.parse(input);
    return ProjectDetailSchema.parse(
      await persistence.projects.get(request.projectId),
    );
  });
  handle(PERSISTENCE_CHANNELS.projectsReplace, async (input) => {
    const request = ProjectReplaceRequestSchema.parse(input);
    return ProjectDetailSchema.parse(
      await persistence.projects.replace(request.projectId, request.project),
    );
  });
  handle(PERSISTENCE_CHANNELS.projectsDuplicate, async (input) => {
    const request = ProjectDuplicateRequestSchema.parse(input);
    return ProjectDetailSchema.parse(
      await persistence.projects.duplicate(
        request.projectId,
        request.duplicate,
      ),
    );
  });
  handle(PERSISTENCE_CHANNELS.projectsDelete, async (input) => {
    const request = ProjectIdInputSchema.parse(input);
    await persistence.projects.delete(request.projectId);
    return EmptyResponseSchema.parse({});
  });
  handle(PERSISTENCE_CHANNELS.pacingGet, async () =>
    SystemTimingConfigurationSchema.parse(
      await persistence.settings.getPacing(),
    ),
  );
  handle(PERSISTENCE_CHANNELS.pacingUpdate, async (input) =>
    SystemTimingConfigurationSchema.parse(
      await persistence.settings.updatePacing(
        SystemTimingConfigurationSchema.parse(input),
      ),
    ),
  );
  handle(PERSISTENCE_CHANNELS.ignoredGet, async () =>
    IgnoredDiagnosticCollectionSchema.parse(
      await persistence.preferences.getIgnoredDiagnostics(),
    ),
  );
  handle(PERSISTENCE_CHANNELS.ignoredReplace, async (input) =>
    IgnoredDiagnosticCollectionSchema.parse(
      await persistence.preferences.replaceIgnoredDiagnostics(
        IgnoredDiagnosticCollectionSchema.parse(input),
      ),
    ),
  );
  handle(PERSISTENCE_CHANNELS.globalLexiconList, async () =>
    GlobalLexiconEntryCollectionSchema.parse(
      await persistence.globalLexicon.list(),
    ),
  );
  handle(PERSISTENCE_CHANNELS.globalLexiconReplace, async (input) =>
    GlobalLexiconEntryCollectionSchema.parse(
      await persistence.globalLexicon.replace(
        GlobalLexiconReplaceInputSchema.parse(input),
      ),
    ),
  );
  handle(PERSISTENCE_CHANNELS.backupsList, async () =>
    PersistenceBackupCollectionSchema.parse(
      await requireBackupClient(persistence).list(),
    ),
  );
  handle(PERSISTENCE_CHANNELS.backupsRestore, async (input) => {
    return PersistenceBackupRestoreResultSchema.parse(
      await requireBackupClient(persistence).restore(
        PersistenceBackupRestoreInputSchema.parse(input),
      ),
    );
  });
}

function safePersistenceError(record?: Record<string, unknown>): Error {
  if (record && Array.isArray(record.issues)) {
    return new Error("The request does not match the persistence contract.");
  }
  if (record?.code === "PERSISTENCE_NOT_FOUND") {
    return new Error("The requested persistence record does not exist.");
  }
  if (record?.code === "PERSISTENCE_CONFLICT") {
    return new Error("The persistence operation conflicts with existing data.");
  }
  if (record?.code === "PERSISTENCE_UNAVAILABLE") {
    return new Error(
      "Persistence is unavailable until the database migration is repaired.",
    );
  }
  return new Error(
    "StudyNarrator could not complete the persistence operation.",
  );
}

function requireBackupClient(persistence: PersistenceClient) {
  const backups = persistence.backups;
  if (!backups)
    throw new Error("Persistence backups are not available in this context.");
  return backups;
}

export function registerConnectionHandlers(
  ipcMain: IpcMainLike,
  connection: SpeechBackendConnectionClient,
  voiceCatalog: VoiceCatalogClient,
) {
  const handle = (
    channel: string,
    listener: (input: unknown) => Promise<unknown>,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, input) => {
      try {
        return await listener(input);
      } catch (error) {
        const record =
          error && typeof error === "object"
            ? (error as Record<string, unknown>)
            : undefined;
        // The original error is intentionally not attached: it may contain a private endpoint.
        /* eslint-disable preserve-caught-error */
        if (record && Array.isArray(record.issues))
          throw new Error(
            "The request does not match the connection contract.",
          );
        if (
          typeof record?.code === "string" &&
          record.code.startsWith("CONNECTION_CATALOG_") &&
          typeof record.message === "string"
        )
          throw new Error(record.message);
        if (record?.code === "PERSISTENCE_NOT_FOUND")
          throw new Error("The Speaches connection does not exist.");
        throw new Error(
          "StudyNarrator could not complete the connection operation.",
        );
        /* eslint-enable preserve-caught-error */
      }
    });
  };
  handle(CONNECTION_CHANNELS.get, async () =>
    SpeechBackendConnectionSchema.parse(await connection.get()),
  );
  handle(CONNECTION_CHANNELS.update, async (input) =>
    SpeechBackendConnectionSchema.parse(
      await connection.update(
        SpeechBackendConnectionAuthoringSchema.parse(input),
      ),
    ),
  );
  handle(CONNECTION_CHANNELS.test, async () =>
    ConnectionTestSummarySchema.parse(await connection.test()),
  );
  handle(CONNECTION_CHANNELS.speechCatalogDiscover, async (input) =>
    SpeechCatalogSchema.parse(
      await connection.discoverSpeechCatalog(
        SpeechCatalogDiscoveryInputSchema.parse(input),
      ),
    ),
  );
  handle(CONNECTION_CHANNELS.exportDiagnostics, async () =>
    RedactedConnectionDiagnosticsSchema.parse(
      await connection.exportDiagnostics(),
    ),
  );
  handle(CONNECTION_CHANNELS.setupGet, async () =>
    ConnectionSetupStateSchema.parse(await connection.getSetupState()),
  );
  handle(CONNECTION_CHANNELS.setupComplete, async () =>
    ConnectionSetupStateSchema.parse(await connection.completeOnboarding()),
  );
  handle(CONNECTION_CHANNELS.voiceCatalogGet, async (input) =>
    VoiceCatalogSchema.parse(
      await voiceCatalog.get(VoiceCatalogModelInputSchema.parse(input).modelId),
    ),
  );
  handle(CONNECTION_CHANNELS.voiceCatalogReplace, async (input) =>
    VoiceCatalogSchema.parse(
      await voiceCatalog.replace(VoiceCatalogSchema.parse(input)),
    ),
  );
}

export function registerScratchpadHandlers(
  ipcMain: IpcMainLike,
  scratchpad: ScratchpadClient,
) {
  ipcMain.removeHandler(SCRATCHPAD_CHANNELS.preview);
  ipcMain.handle(SCRATCHPAD_CHANNELS.preview, async (_event, input) => {
    try {
      return ScratchpadPreviewResultSchema.parse(
        await scratchpad.preview(ScratchpadPreviewInputSchema.parse(input)),
      );
    } catch (error) {
      const record =
        error && typeof error === "object"
          ? (error as Record<string, unknown>)
          : undefined;
      /* eslint-disable preserve-caught-error */
      if (record && Array.isArray(record.issues))
        throw new Error("The request does not match the Scratchpad contract.");
      if (
        typeof record?.code === "string" &&
        record.code.startsWith("SCRATCHPAD_") &&
        typeof record.message === "string"
      ) {
        throw new Error(record.message);
      }
      throw new Error("StudyNarrator could not complete speech synthesis.");
      /* eslint-enable preserve-caught-error */
    }
  });
}

export function registerProjectPreviewHandlers(
  ipcMain: IpcMainLike,
  projectPreview: ProjectPreviewClient,
) {
  ipcMain.removeHandler(PROJECT_PREVIEW_CHANNELS.preview);
  ipcMain.handle(PROJECT_PREVIEW_CHANNELS.preview, async (_event, input) => {
    try {
      const request = ProjectPreviewRequestSchema.parse(input);
      return ProjectPreviewResultSchema.parse(
        await projectPreview.preview(request.projectId, request.preview),
      );
    } catch (error) {
      const record =
        error && typeof error === "object"
          ? (error as Record<string, unknown>)
          : undefined;
      /* eslint-disable preserve-caught-error */
      if (record && Array.isArray(record.issues))
        throw new Error(
          "The request does not match the project preview contract.",
        );
      if (
        typeof record?.code === "string" &&
        record.code.startsWith("PROJECT_PREVIEW_") &&
        typeof record.message === "string"
      ) {
        throw new Error(record.message);
      }
      throw new Error("StudyNarrator could not complete the project preview.");
      /* eslint-enable preserve-caught-error */
    }
  });
}

export function registerSpeechCacheHandlers(
  ipcMain: IpcMainLike,
  speechCache: SpeechCacheClient,
) {
  const handle = (
    channel: string,
    listener: (input: unknown) => Promise<unknown>,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, input) => {
      try {
        return await listener(input);
      } catch (error) {
        const record =
          error && typeof error === "object"
            ? (error as Record<string, unknown>)
            : undefined;
        /* eslint-disable preserve-caught-error */
        if (record && Array.isArray(record.issues))
          throw new Error(
            "The request does not match the speech cache contract.",
          );
        throw new Error(
          "StudyNarrator could not complete the speech cache operation.",
        );
        /* eslint-enable preserve-caught-error */
      }
    });
  };
  handle(SPEECH_CACHE_CHANNELS.status, async () =>
    SpeechCacheStatusSchema.parse(await speechCache.status()),
  );
  handle(SPEECH_CACHE_CHANNELS.clearAll, async () =>
    SpeechCacheCleanupResultSchema.parse(await speechCache.clearAll()),
  );
  handle(SPEECH_CACHE_CHANNELS.clearProject, async (input) => {
    const { projectId } = SpeechCacheProjectInputSchema.parse(input);
    return SpeechCacheCleanupResultSchema.parse(
      await speechCache.clearProject(projectId),
    );
  });
  handle(SPEECH_CACHE_CHANNELS.clearEntry, async (input) => {
    const { cacheKey } = SpeechCacheKeyInputSchema.parse(input);
    return SpeechCacheCleanupResultSchema.parse(
      await speechCache.clearEntry(cacheKey),
    );
  });
}

export function registerRenderHandlers(
  ipcMain: IpcMainLike,
  renders: RenderService,
  dialog: {
    showSaveDialog(options: {
      defaultPath: string;
    }): Promise<{ canceled: boolean; filePath?: string }>;
  },
) {
  const handle = (
    channel: string,
    listener: (input: unknown) => Promise<unknown>,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, input) => {
      try {
        return await listener(input);
      } catch (error) {
        const record =
          error && typeof error === "object"
            ? (error as Record<string, unknown>)
            : undefined;
        /* eslint-disable preserve-caught-error */
        if (record && Array.isArray(record.issues))
          throw new Error("The request does not match the render contract.");
        if (
          record?.code === "RENDER_DISK_SPACE_INSUFFICIENT" &&
          typeof record.message === "string"
        )
          throw new Error(record.message);
        throw new Error(
          "StudyNarrator could not complete the render operation.",
        );
        /* eslint-enable preserve-caught-error */
      }
    });
  };
  handle(RENDER_CHANNELS.startProject, async (input) => {
    const { projectId, options } = RenderProjectStartInputSchema.parse(input);
    return RenderJobSchema.parse(
      await renders.startProject(projectId, options),
    );
  });
  handle(RENDER_CHANNELS.getEstimateContext, async (input) => {
    const parsed = RenderEstimateContextInputSchema.parse(input);
    return RenderEstimateContextResultSchema.parse(
      await renders.getEstimateContext(parsed),
    );
  });
  handle(RENDER_CHANNELS.list, async (input) => {
    const { projectId } = RenderProjectInputSchema.parse(input);
    return RenderJobCollectionSchema.parse(await renders.list(projectId));
  });
  handle(RENDER_CHANNELS.get, async (input) => {
    const { renderId } = RenderIdInputSchema.parse(input);
    return RenderJobSchema.parse(await renders.get(renderId));
  });
  handle(RENDER_CHANNELS.cancel, async (input) => {
    const { renderId } = RenderIdInputSchema.parse(input);
    return RenderJobSchema.parse(await renders.cancel(renderId));
  });
  handle(RENDER_CHANNELS.retry, async (input) => {
    const { renderId } = RenderIdInputSchema.parse(input);
    return RenderJobSchema.parse(await renders.retry(renderId));
  });
  handle(RENDER_CHANNELS.artifacts, async (input) => {
    const { renderId } = RenderIdInputSchema.parse(input);
    return RenderArtifactCollectionSchema.parse(
      await renders.listArtifacts(renderId),
    );
  });
  handle(RENDER_CHANNELS.exportArtifact, async (input) => {
    const { artifactId } = RenderArtifactInputSchema.parse(input);
    const { artifact, path } = await renders.resolveArtifact(artifactId);
    const destination = await dialog.showSaveDialog({
      defaultPath: artifact.fileName,
    });
    if (destination.canceled || !destination.filePath)
      return RenderArtifactExportResultSchema.parse({
        disposition: "canceled",
        fileName: artifact.fileName,
      });
    await copyFile(path, destination.filePath);
    return RenderArtifactExportResultSchema.parse({
      disposition: "saved",
      fileName: artifact.fileName,
    });
  });
  handle(RENDER_CHANNELS.exportAudio, async (input) => {
    const { renderId } = RenderIdInputSchema.parse(input);
    const media = await renders.resolveRenderAudio(renderId);
    const destination = await dialog.showSaveDialog({
      defaultPath: media.fileName,
    });
    if (destination.canceled || !destination.filePath)
      return RenderArtifactExportResultSchema.parse({
        disposition: "canceled",
        fileName: media.fileName,
      });
    await copyFile(media.path, destination.filePath);
    return RenderArtifactExportResultSchema.parse({
      disposition: "saved",
      fileName: media.fileName,
    });
  });
  handle(RENDER_CHANNELS.exportDetails, async (input) => {
    const { renderId } = RenderIdInputSchema.parse(input);
    const archive = await renders.resolveDetailsArchive!(renderId);
    const destination = await dialog.showSaveDialog({
      defaultPath: archive.fileName,
    });
    if (destination.canceled || !destination.filePath)
      return RenderArtifactExportResultSchema.parse({
        disposition: "canceled",
        fileName: archive.fileName,
      });
    await writeFile(destination.filePath, archive.bytes, { mode: 0o600 });
    return RenderArtifactExportResultSchema.parse({
      disposition: "saved",
      fileName: archive.fileName,
    });
  });
  handle(RENDER_CHANNELS.segments, async (input) => {
    const { renderId } = RenderIdInputSchema.parse(input);
    return RenderHistorySegmentCollectionSchema.parse(
      await renders.listSegments(renderId),
    );
  });
  handle(RENDER_CHANNELS.waveform, async (input) => {
    const { renderId } = RenderIdInputSchema.parse(input);
    return RenderWaveformSchema.parse(await renders.getWaveform(renderId));
  });
  handle(RENDER_CHANNELS.exportSegment, async (input) => {
    const { renderId, ordinal } = RenderSegmentInputSchema.parse(input);
    const media = await renders.resolveSegmentAudio(renderId, ordinal);
    const destination = await dialog.showSaveDialog({
      defaultPath: media.fileName,
    });
    if (destination.canceled || !destination.filePath)
      return RenderArtifactExportResultSchema.parse({
        disposition: "canceled",
        fileName: media.fileName,
      });
    await copyFile(media.path, destination.filePath);
    return RenderArtifactExportResultSchema.parse({
      disposition: "saved",
      fileName: media.fileName,
    });
  });
}

export function registerScriptGenerationHandlers(
  ipcMain: IpcMainLike,
  generation: ScriptGenerationService,
  dialog: {
    showSaveDialog(options: {
      defaultPath: string;
    }): Promise<{ canceled: boolean; filePath?: string }>;
  },
) {
  const handle = (
    channel: string,
    listener: (input: unknown) => Promise<unknown>,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, input) => {
      try {
        return await listener(input);
      } catch {
        throw new Error(
          "StudyNarrator could not complete the script generation operation.",
        );
      }
    });
  };
  handle(SCRIPT_GENERATION_CHANNELS.previewPrompt, async (input) => {
    const { projectId, kind } =
      ScriptGenerationPromptRequestSchema.parse(input);
    return PromptDocumentSchema.parse(
      await generation.previewPrompt(projectId, kind),
    );
  });
  handle(SCRIPT_GENERATION_CHANNELS.exportPrompt, async (input) => {
    const { projectId, kind, content } =
      ScriptGenerationPromptExportRequestSchema.parse(input);
    const file = await generation.resolvePromptExport(projectId, kind, content);
    const destination = await dialog.showSaveDialog({
      defaultPath: file.fileName,
    });
    if (destination.canceled || !destination.filePath)
      return FileExportResultSchema.parse({
        disposition: "canceled",
        fileName: file.fileName,
      });
    await writeFile(destination.filePath, file.bytes);
    return FileExportResultSchema.parse({
      disposition: "saved",
      fileName: file.fileName,
    });
  });
  handle(SCRIPT_GENERATION_CHANNELS.exportSkillPackage, async (input) => {
    const { projectId } = ScriptGenerationSkillRequestSchema.parse(input);
    const file = await generation.resolveSkillPackage(projectId);
    const destination = await dialog.showSaveDialog({
      defaultPath: file.fileName,
    });
    if (destination.canceled || !destination.filePath)
      return FileExportResultSchema.parse({
        disposition: "canceled",
        fileName: file.fileName,
      });
    await writeFile(destination.filePath, file.bytes);
    return FileExportResultSchema.parse({
      disposition: "saved",
      fileName: file.fileName,
    });
  });
}
