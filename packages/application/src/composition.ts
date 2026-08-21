export interface StudyNarratorRuntimeDescriptor {
  client: "web" | "electron";
  distribution: string;
  transport: "rest" | "ipc";
  runtimeName: "node" | "electron";
  runtimeVersion: string;
  electronVersion: string | null;
  sourceRevision: string;
  dataDirectory: string;
  appVersion: string;
}
