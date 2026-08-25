export interface DockerResourceNames {
  builderContainerName: string;
  builderName: string;
  builderStateVolumeName: string;
  imageTag: string;
  imageVersionTag: string;
  projectName: string;
  runId: string;
}

export interface DockerRunner {
  output(
    command: string,
    args: string[],
    environment?: Record<string, string>,
  ): Promise<string>;
  run(
    command: string,
    args: string[],
    environment?: Record<string, string>,
  ): Promise<void>;
}

export interface SignalChild {
  exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean | void;
  signalCode: NodeJS.Signals | null;
}

export interface SignalTarget {
  off(event: NodeJS.Signals, listener: () => void): unknown;
  on(event: NodeJS.Signals, listener: () => void): unknown;
}

export const VERIFICATION_LABEL: "io.studynarrator.verification";
export const VERIFICATION_RUN_LABEL: "io.studynarrator.verification.run";
export const LEGACY_IMAGE_TAG: "studynarrator:verify";
export const BUILDKIT_IMAGE: "moby/buildkit:buildx-stable-1";

export function createDockerResourceNames(
  pid: number,
  timestamp: number,
): DockerResourceNames;

export function acquireVerificationLock(options: {
  lockPath: string;
  pid?: number;
  processIsAlive?: (pid: number) => boolean;
  token?: string;
}): () => void;

export class VerificationInterruptedError extends Error {
  constructor(signal: NodeJS.Signals);
  readonly signal: NodeJS.Signals;
}

export function createSignalController(options: {
  getActiveChild: () => SignalChild | undefined;
  processTarget?: SignalTarget;
}): {
  beginCleanup(): void;
  dispose(): void;
  readonly signal: NodeJS.Signals | undefined;
  throwIfInterrupted(): void;
};

export function cleanupVerificationResources(options: {
  composeEnvironment?: Record<string, string>;
  currentNames?: DockerResourceNames;
  runner: DockerRunner;
}): Promise<string[]>;

export function removeRunOwnedBuildkitImage(options: {
  existedBeforeRun: boolean;
  runner: DockerRunner;
}): Promise<string[]>;

export function auditVerificationResources(options: {
  runner: DockerRunner;
}): Promise<{ failures: string[]; leftovers: string[] }>;

export function executeWithCleanup(options: {
  audit: () => Promise<string[] | undefined | void>;
  cleanup: () => Promise<string[] | undefined | void>;
  execute: () => Promise<void>;
  release: () => Promise<string[] | undefined | void>;
}): Promise<void>;
