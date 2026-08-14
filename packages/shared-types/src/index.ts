import { z } from "zod";
import type { ConnectionsClient, VoiceCatalogClient } from "./connections.js";
import type { PersistenceClient } from "./persistence.js";
import type { ProjectPreviewClient, SpeechCacheClient } from "./preview.js";
import type { RenderPlanClient } from "./renderPlan.js";
import type { RenderClient } from "./render.js";
import type { ScratchpadClient } from "./scratchpad.js";
import type { ScriptGenerationClient } from "./scriptGeneration.js";

export const APPLICATION_VERSION = "0.1.0";
export const DIAGNOSTICS_SCHEMA_VERSION = 3;
export const SYSTEM_DIAGNOSTICS_CHANNEL = "system.diagnostics";

export const CheckStatusSchema = z.enum(["pass", "fail"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const HealthSchema = z.object({
  status: z.literal("ok"),
  applicationVersion: z.string().min(1)
}).strict();
export type Health = z.infer<typeof HealthSchema>;

export const RuntimeSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  applicationVersion: z.string().min(1),
  runtimeName: z.enum(["node", "electron"]),
  runtimeVersion: z.string().min(1),
  electronVersion: z.string().min(1).nullable(),
  platform: z.string().min(1),
  architecture: z.string().min(1),
  dataDirectory: z.string().min(1)
}).strict();
export type RuntimeInfo = z.infer<typeof RuntimeSchema>;

const FailureSchema = z.object({
  status: z.literal("fail"),
  code: z.string().min(1),
  message: z.string().min(1)
}).strict();

export const SharedCoreCheckSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pass"), marker: z.literal("study-narrator-core") }).strict(),
  FailureSchema
]);

export const StorageCheckSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pass"),
    driver: z.literal("better-sqlite3"),
    sqliteVersion: z.string().min(1),
    migrationVersion: z.literal(6),
    databasePath: z.string().min(1),
    latestBackupPath: z.string().min(1).nullable(),
    markerKey: z.literal("runtime.storage-self-test"),
    markerValue: z.literal("study-narrator-storage-ok"),
    createdAt: z.iso.datetime()
  }).strict(),
  FailureSchema.extend({
    databasePath: z.string().min(1).optional(),
    recoveryBackupPath: z.string().min(1).nullable().optional()
  }).strict()
]);

export const FfmpegCheckSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pass"),
    executable: z.string().min(1),
    version: z.string().min(1)
  }).strict(),
  FailureSchema.extend({ executable: z.string().min(1) }).strict()
]);

export const SystemDiagnosticsSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  overall: CheckStatusSchema,
  client: z.enum(["web", "electron"]),
  transport: z.enum(["rest", "ipc"]),
  runtime: RuntimeSchema,
  checks: z.object({
    sharedCore: SharedCoreCheckSchema,
    storage: StorageCheckSchema,
    ffmpeg: FfmpegCheckSchema
  }).strict()
}).strict();
export type SystemDiagnostics = z.infer<typeof SystemDiagnosticsSchema>;

export const BoundaryErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    issues: z.array(z.object({ path: z.string(), message: z.string().min(1) }).strict()).optional()
  }).strict()
}).strict();
export type BoundaryError = z.infer<typeof BoundaryErrorSchema>;

export interface SystemClient {
  diagnostics(): Promise<SystemDiagnostics>;
}

export interface StudyNarratorBridge {
  system: SystemClient;
  persistence: PersistenceClient;
  connections: ConnectionsClient;
  voiceCatalog: VoiceCatalogClient;
  scratchpad: ScratchpadClient;
  projectPreview: ProjectPreviewClient;
  speechCache: SpeechCacheClient;
  renderPlans: RenderPlanClient;
  renders: RenderClient;
  scriptGeneration: ScriptGenerationClient;
}

export * from "./connections.js";
export * from "./persistence.js";
export * from "./preview.js";
export * from "./scratchpad.js";
export * from "./renderPlan.js";
export * from "./render.js";
export * from "./scriptGeneration.js";
