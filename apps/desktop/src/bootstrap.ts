import { resolve } from "node:path";
import Database from "better-sqlite3";
import { createSystemService, type DiagnosticsContext } from "@studynarrator/application";
import { openStudyNarratorRepository } from "@studynarrator/persistence";
import { createFfmpegProbe } from "@studynarrator/runtime";

export async function createDesktopServices(options: {
  defaultDataDirectory: string;
  environment?: NodeJS.ProcessEnv;
}) {
  const environment = options.environment ?? process.env;
  const dataDirectory = resolve(environment.STUDYNARRATOR_DATA_DIR ?? options.defaultDataDirectory);
  const repository = await openStudyNarratorRepository({
    Database,
    databasePath: resolve(dataDirectory, "studynarrator.sqlite")
  });
  const service = createSystemService({
    repository,
    ffmpegProbe: createFfmpegProbe(
      environment.STUDYNARRATOR_FFMPEG_PATH
        ? { executable: environment.STUDYNARRATOR_FFMPEG_PATH }
        : {}
    )
  });
  const context: DiagnosticsContext = {
    client: "electron",
    transport: "ipc",
    runtimeName: "electron",
    runtimeVersion: process.versions.node,
    electronVersion: process.versions.electron ?? null,
    platform: process.platform,
    architecture: process.arch,
    dataDirectory
  };
  return { service, context };
}
