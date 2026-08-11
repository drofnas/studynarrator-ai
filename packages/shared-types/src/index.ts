import { z } from "zod";

export const APPLICATION_VERSION = "0.1.0";
export const DIAGNOSTICS_SCHEMA_VERSION = 1;
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
  z.object({ status: z.literal("pass"), marker: z.literal("study-narrator-g01") }).strict(),
  FailureSchema
]);

export const StorageCheckSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pass"),
    driver: z.literal("better-sqlite3"),
    sqliteVersion: z.string().min(1),
    migrationVersion: z.literal(1),
    databasePath: z.string().min(1),
    markerKey: z.literal("g01.runtime-self-test"),
    markerValue: z.literal("study-narrator-g01"),
    createdAt: z.iso.datetime()
  }).strict(),
  FailureSchema
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
    message: z.string().min(1)
  }).strict()
}).strict();
export type BoundaryError = z.infer<typeof BoundaryErrorSchema>;

export interface SystemClient {
  diagnostics(): Promise<SystemDiagnostics>;
}

export interface StudyNarratorBridge {
  system: SystemClient;
}
