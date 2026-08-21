import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  createStudyNarratorServices,
  type StudyNarratorRuntimeDescriptor,
} from "@studynarrator/application";
import { APPLICATION_VERSION } from "@studynarrator/shared-types";

export function resolveDesktopDataDirectory(
  defaultDataDirectory: string,
  environment: NodeJS.ProcessEnv,
): string {
  return environment.STUDYNARRATOR_DATA_DIR
    ? resolve(
        environment.INIT_CWD ?? process.cwd(),
        environment.STUDYNARRATOR_DATA_DIR,
      )
    : resolve(defaultDataDirectory);
}

export async function createDesktopServices(options: {
  defaultDataDirectory: string;
  environment?: NodeJS.ProcessEnv;
}) {
  const environment = options.environment ?? process.env;
  const dataDirectory = resolveDesktopDataDirectory(
    options.defaultDataDirectory,
    environment,
  );
  const descriptor = {
    client: "electron",
    distribution: "electron" as const,
    transport: "ipc",
    runtimeName: "electron",
    runtimeVersion: process.versions.node,
    electronVersion: process.versions.electron ?? null,
    sourceRevision:
      environment.STUDYNARRATOR_SOURCE_REVISION?.trim() || "development",
    dataDirectory,
    appVersion: APPLICATION_VERSION,
  } satisfies StudyNarratorRuntimeDescriptor;
  return createStudyNarratorServices({
    Database,
    descriptor,
    ...(environment.STUDYNARRATOR_FFMPEG_PATH
      ? { ffmpegPath: environment.STUDYNARRATOR_FFMPEG_PATH }
      : {}),
  });
}
