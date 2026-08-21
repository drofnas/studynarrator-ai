import type { ErrorRequestHandler } from "express";
import { BoundaryErrorSchema } from "@studynarrator/shared-types";

export const boundaryError: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  let status = 500;
  let code = "PERSISTENCE_BOUNDARY_ERROR";
  let message = "StudyNarrator could not complete the persistence operation.";
  let issues: Array<{ path: string; message: string }> | undefined;
  const errorRecord =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : undefined;
  const zodIssues =
    errorRecord && Array.isArray(errorRecord.issues)
      ? errorRecord.issues.filter(
          (issue): issue is { path: PropertyKey[]; message: string } => {
            if (!issue || typeof issue !== "object") return false;
            const record = issue as Record<string, unknown>;
            return (
              Array.isArray(record.path) && typeof record.message === "string"
            );
          },
        )
      : undefined;
  if (zodIssues) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "The request does not match the persistence contract.";
    issues = zodIssues.map((issue) => ({
      path: issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`,
      message: issue.message,
    }));
  } else if (errorRecord?.code === "PERSISTENCE_NOT_FOUND") {
    status = 404;
    code = "NOT_FOUND";
    message = "The requested persistence record does not exist.";
  } else if (errorRecord?.code === "PERSISTENCE_CONFLICT") {
    status = 409;
    code = "CONFLICT";
    message = "The persistence operation conflicts with existing data.";
  } else if (errorRecord?.code === "PERSISTENCE_UNAVAILABLE") {
    status = 503;
    code = "PERSISTENCE_UNAVAILABLE";
    message =
      "Persistence is unavailable until the database migration is repaired.";
  } else if (errorRecord?.code === "BACKUP_RESTORE_FAILED") {
    status = 422;
    code = "BACKUP_RESTORE_FAILED";
    message =
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : "The selected backup could not be restored.";
  } else if (errorRecord?.code === "CONNECTION_POLICY") {
    status = 409;
    code = "CONNECTION_POLICY";
    message =
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : "The connection operation is managed by this installation.";
  } else if (errorRecord?.code === "CONNECTION_CONFIGURATION") {
    status = 409;
    code = "CONNECTION_CONFIGURATION";
    message = "Test this connection before exporting diagnostics.";
  } else if (
    typeof errorRecord?.code === "string" &&
    errorRecord.code.startsWith("CONNECTION_CATALOG_")
  ) {
    code = errorRecord.code;
    const catalogStatus: Record<string, number> = {
      CONNECTION_CATALOG_ABORTED: 499,
      CONNECTION_CATALOG_AUTHENTICATION: 401,
      CONNECTION_CATALOG_CONFIGURATION: 409,
      CONNECTION_CATALOG_INVALID_RESPONSE: 502,
      CONNECTION_CATALOG_UNAVAILABLE: 503,
    };
    status = catalogStatus[errorRecord.code] ?? 500;
    message =
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : "StudyNarrator could not discover supported speech models and voices.";
  } else if (
    typeof errorRecord?.code === "string" &&
    errorRecord.code.startsWith("SCRATCHPAD_")
  ) {
    code = errorRecord.code;
    const scratchpadStatus: Record<string, number> = {
      SCRATCHPAD_ABORTED: 499,
      SCRATCHPAD_AUTHENTICATION: 401,
      SCRATCHPAD_CONFIGURATION: 409,
      SCRATCHPAD_INVALID_AUDIO: 502,
      SCRATCHPAD_SELECTION_REJECTED: 422,
      SCRATCHPAD_UNAVAILABLE: 503,
    };
    status = scratchpadStatus[errorRecord.code] ?? 500;
    message =
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : "StudyNarrator could not complete speech synthesis.";
  } else if (
    typeof errorRecord?.code === "string" &&
    errorRecord.code.startsWith("PROJECT_PREVIEW_")
  ) {
    code = errorRecord.code;
    const previewStatus: Record<string, number> = {
      PROJECT_PREVIEW_ABORTED: 499,
      PROJECT_PREVIEW_AUTHENTICATION: 401,
      PROJECT_PREVIEW_CONFIGURATION: 409,
      PROJECT_PREVIEW_INVALID_AUDIO: 502,
      PROJECT_PREVIEW_INVALID_SEGMENT: 422,
      PROJECT_PREVIEW_SELECTION_REJECTED: 422,
      PROJECT_PREVIEW_UNAVAILABLE: 503,
    };
    status = previewStatus[errorRecord.code] ?? 500;
    message =
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : "StudyNarrator could not complete the project preview.";
  } else if (
    typeof errorRecord?.code === "string" &&
    errorRecord.code.startsWith("RENDER_PLAN_")
  ) {
    code = errorRecord.code;
    const renderPlanStatus: Record<string, number> = {
      RENDER_PLAN_CONFIGURATION: 409,
      RENDER_PLAN_INVALID_PROJECT: 422,
      RENDER_PLAN_NOT_FOUND: 404,
      RENDER_PLAN_STORAGE: 500,
    };
    status = renderPlanStatus[errorRecord.code] ?? 500;
    message =
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : "StudyNarrator could not complete the render plan operation.";
  } else if (errorRecord?.code === "RENDER_MEDIA_UNAVAILABLE") {
    status = 404;
    code = "RENDER_MEDIA_UNAVAILABLE";
    message = "The requested render audio is unavailable.";
  } else if (
    typeof errorRecord?.code === "string" &&
    errorRecord.code.startsWith("SCRIPT_GENERATION_")
  ) {
    code = errorRecord.code;
    status = errorRecord.code === "SCRIPT_GENERATION_NOT_FOUND" ? 404 : 500;
    message =
      typeof errorRecord.message === "string"
        ? errorRecord.message
        : "StudyNarrator could not generate the requested export.";
  }
  response.status(status).json(
    BoundaryErrorSchema.parse({
      error: {
        code,
        message,
        ...(issues === undefined ? {} : { issues }),
      },
    }),
  );
};
