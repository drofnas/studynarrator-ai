import { resolve } from "node:path";
import Database from "better-sqlite3";
import { createSystemService, type DiagnosticsContext } from "@studynarrator/application";
import { createDiagnosticRepository, createLazyDiagnosticRepository } from "@studynarrator/persistence";
import { createFfmpegProbe } from "@studynarrator/runtime";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

export function resolveServerDataDirectory(environment = process.env): string {
  return resolve(environment.STUDYNARRATOR_DATA_DIR ?? resolve(repositoryRoot, ".tmp/gates/G01/web"));
}

export function createServerServices(environment = process.env) {
  const dataDirectory = resolveServerDataDirectory(environment);
  const repository = createLazyDiagnosticRepository(() => createDiagnosticRepository({
    Database,
    databasePath: resolve(dataDirectory, "studynarrator.sqlite")
  }));
  const service = createSystemService({
    repository,
    ffmpegProbe: createFfmpegProbe(
      environment.STUDYNARRATOR_FFMPEG_PATH
        ? { executable: environment.STUDYNARRATOR_FFMPEG_PATH }
        : {}
    )
  });
  const context: DiagnosticsContext = {
    client: "web",
    transport: "rest",
    runtimeName: "node",
    runtimeVersion: process.versions.node,
    electronVersion: null,
    platform: process.platform,
    architecture: process.arch,
    dataDirectory
  };
  return { service, context };
}
