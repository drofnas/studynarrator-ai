import {
  ConnectionProfileAuthoringSchema,
  ConnectionProfileCollectionSchema,
  ConnectionProfileIdInputSchema,
  ConnectionProfilePlaceholderSchema,
  ConnectionProfileReplaceRequestSchema,
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
  ProjectReplaceRequestSchema,
  ProjectSummaryCollectionSchema,
  SYSTEM_DIAGNOSTICS_CHANNEL,
  SystemDiagnosticsSchema,
  SystemPacingDefaultsSchema,
  type PersistenceClient
} from "@studynarrator/shared-types";
import type { DiagnosticsContext, SystemService } from "@studynarrator/application";

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
  handle(PERSISTENCE_CHANNELS.connectionProfilesList, async () => ConnectionProfileCollectionSchema.parse(await persistence.connectionProfiles.list()));
  handle(PERSISTENCE_CHANNELS.connectionProfilesCreate, async (input) => ConnectionProfilePlaceholderSchema.parse(await persistence.connectionProfiles.create(ConnectionProfileAuthoringSchema.parse(input))));
  handle(PERSISTENCE_CHANNELS.connectionProfilesReplace, async (input) => {
    const request = ConnectionProfileReplaceRequestSchema.parse(input);
    return ConnectionProfilePlaceholderSchema.parse(await persistence.connectionProfiles.replace(request.profileId, request.profile));
  });
  handle(PERSISTENCE_CHANNELS.connectionProfilesDelete, async (input) => {
    const request = ConnectionProfileIdInputSchema.parse(input);
    await persistence.connectionProfiles.delete(request.profileId);
    return EmptyResponseSchema.parse({});
  });
}
