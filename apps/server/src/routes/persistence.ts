import { Router } from "express";
import {
  CustomGlobalLexiconReplaceInputSchema,
  EmptyResponseSchema,
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
  type PersistenceClient,
} from "@studynarrator/shared-types";
import { asyncHandler } from "../asyncHandler.js";

export function createPersistenceRouter(
  persistence: PersistenceClient,
  router: Router = Router(),
): Router {
  router.get(
    "/api/persistence/status",
    asyncHandler(async (_request, response) => {
      response.json(PersistenceStatusSchema.parse(await persistence.status()));
    }),
  );
  router.get(
    "/api/persistence/backups",
    asyncHandler(async (_request, response) => {
      const backups = persistence.backups;
      if (!backups)
        throw new Error("Backup listing is not available in this context.");
      response.json(
        PersistenceBackupCollectionSchema.parse(await backups.list()),
      );
    }),
  );
  router.post(
    "/api/persistence/backups/restore",
    asyncHandler(async (request, response) => {
      const backups = persistence.backups;
      if (!backups)
        throw new Error("Backup restore is not available in this context.");
      response
        .status(201)
        .json(
          PersistenceBackupRestoreResultSchema.parse(
            await backups.restore(
              PersistenceBackupRestoreInputSchema.parse(request.body),
            ),
          ),
        );
    }),
  );
  router.get(
    "/api/projects",
    asyncHandler(async (_request, response) => {
      response.json(
        ProjectSummaryCollectionSchema.parse(await persistence.projects.list()),
      );
    }),
  );
  router.post(
    "/api/projects",
    asyncHandler(async (request, response) => {
      response
        .status(201)
        .json(
          ProjectDetailSchema.parse(
            await persistence.projects.create(
              ProjectCreateInputSchema.parse(request.body),
            ),
          ),
        );
    }),
  );
  router.get(
    "/api/projects/:projectId",
    asyncHandler(async (request, response) => {
      response.json(
        ProjectDetailSchema.parse(
          await persistence.projects.get(
            ProjectIdSchema.parse(request.params.projectId),
          ),
        ),
      );
    }),
  );
  router.put(
    "/api/projects/:projectId",
    asyncHandler(async (request, response) => {
      response.json(
        ProjectDetailSchema.parse(
          await persistence.projects.replace(
            ProjectIdSchema.parse(request.params.projectId),
            ProjectReplaceInputSchema.parse(request.body),
          ),
        ),
      );
    }),
  );
  router.post(
    "/api/projects/:projectId/duplicate",
    asyncHandler(async (request, response) => {
      response
        .status(201)
        .json(
          ProjectDetailSchema.parse(
            await persistence.projects.duplicate(
              ProjectIdSchema.parse(request.params.projectId),
              ProjectDuplicateInputSchema.parse(request.body),
            ),
          ),
        );
    }),
  );
  router.delete(
    "/api/projects/:projectId",
    asyncHandler(async (request, response) => {
      await persistence.projects.delete(
        ProjectIdSchema.parse(request.params.projectId),
      );
      response.status(204).end();
    }),
  );
  router.get(
    "/api/settings/pacing",
    asyncHandler(async (_request, response) => {
      response.json(
        SystemTimingConfigurationSchema.parse(
          await persistence.settings.getPacing(),
        ),
      );
    }),
  );
  router.put(
    "/api/settings/pacing",
    asyncHandler(async (request, response) => {
      response.json(
        SystemTimingConfigurationSchema.parse(
          await persistence.settings.updatePacing(
            SystemTimingConfigurationSchema.parse(request.body),
          ),
        ),
      );
    }),
  );
  router.get(
    "/api/settings/retention",
    asyncHandler(async (_request, response) => {
      response.json(
        RetentionSettingsSchema.parse(await persistence.retention.get()),
      );
    }),
  );
  router.put(
    "/api/settings/retention",
    asyncHandler(async (request, response) => {
      response.json(
        RetentionSettingsSchema.parse(
          await persistence.retention.update(
            RetentionSettingsAuthoringSchema.parse(request.body),
          ),
        ),
      );
    }),
  );
  router.get(
    "/api/settings/retention/usage",
    asyncHandler(async (_request, response) => {
      response.json(
        RetentionUsageSchema.parse(await persistence.retention.usage()),
      );
    }),
  );
  router.post(
    "/api/settings/retention/reclaim-preview",
    asyncHandler(async (_request, response) => {
      response.json(
        RetentionReclaimPreviewSchema.parse(
          await persistence.retention.previewReclaim(),
        ),
      );
    }),
  );
  router.post(
    "/api/settings/retention/reclaim",
    asyncHandler(async (request, response) => {
      response.json(
        RetentionReclaimResultSchema.parse(
          await persistence.retention.reclaim(
            RetentionReclaimInputSchema.parse(request.body),
          ),
        ),
      );
    }),
  );
  router.get(
    "/api/preferences/ignored-diagnostics",
    asyncHandler(async (_request, response) => {
      response.json(
        IgnoredDiagnosticCollectionSchema.parse(
          await persistence.preferences.getIgnoredDiagnostics(),
        ),
      );
    }),
  );
  router.put(
    "/api/preferences/ignored-diagnostics",
    asyncHandler(async (request, response) => {
      response.json(
        IgnoredDiagnosticCollectionSchema.parse(
          await persistence.preferences.replaceIgnoredDiagnostics(
            IgnoredDiagnosticCollectionSchema.parse(request.body),
          ),
        ),
      );
    }),
  );
  router.get(
    "/api/lexicon/global",
    asyncHandler(async (_request, response) => {
      response.json(
        GlobalLexiconStateSchema.parse(await persistence.globalLexicon.list()),
      );
    }),
  );
  router.patch(
    "/api/lexicon/global/built-ins/:entryId/enabled",
    asyncHandler(async (request, response) => {
      response.json(
        GlobalLexiconStateSchema.parse(
          await persistence.globalLexicon.setBuiltInEnabled(
            GlobalLexiconBuiltInEnabledInputSchema.parse({
              id: request.params.entryId,
              ...request.body,
            }),
          ),
        ),
      );
    }),
  );
  router.put(
    "/api/lexicon/custom",
    asyncHandler(async (request, response) => {
      response.json(
        GlobalLexiconStateSchema.parse(
          await persistence.globalLexicon.replaceCustom(
            CustomGlobalLexiconReplaceInputSchema.parse(request.body),
          ),
        ),
      );
    }),
  );
  router.post(
    "/api/lexicon/global/built-ins/reimport",
    asyncHandler(async (request, response) => {
      EmptyResponseSchema.parse(request.body ?? {});
      response.json(
        GlobalLexiconStateSchema.parse(
          await persistence.globalLexicon.reimportBuiltIns(),
        ),
      );
    }),
  );

  return router;
}
