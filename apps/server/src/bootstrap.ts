import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  createStudyNarratorServices,
  type StudyNarratorRuntimeDescriptor,
} from "@studynarrator/application";
import { APPLICATION_VERSION } from "@studynarrator/shared-types";
import { resolveServerRuntimeConfiguration } from "./runtimeConfig.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

export function resolveServerDataDirectory(environment = process.env): string {
  return environment.STUDYNARRATOR_DATA_DIR
    ? resolve(
        environment.INIT_CWD ?? repositoryRoot,
        environment.STUDYNARRATOR_DATA_DIR,
      )
    : resolve(repositoryRoot, ".tmp/dev/web");
}

export async function createServerServices(environment = process.env) {
  const runtimeConfiguration = resolveServerRuntimeConfiguration(
    environment,
    repositoryRoot,
  );
  const dataDirectory = resolveServerDataDirectory(environment);
  const descriptor = {
    client: "web",
    transport: "rest",
    runtimeName: "node",
    runtimeVersion: process.versions.node,
    electronVersion: null,
    distribution: runtimeConfiguration.distribution,
    sourceRevision: runtimeConfiguration.sourceRevision,
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
