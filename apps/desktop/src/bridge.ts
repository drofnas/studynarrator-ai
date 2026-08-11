import {
  SYSTEM_DIAGNOSTICS_CHANNEL,
  SystemDiagnosticsSchema,
  type StudyNarratorBridge,
  type SystemDiagnostics
} from "@studynarrator/shared-types";

export function createPreloadBridge(invoke: (channel: string) => Promise<unknown>): StudyNarratorBridge {
  return Object.freeze({
    system: Object.freeze({
      async diagnostics(): Promise<SystemDiagnostics> {
        return SystemDiagnosticsSchema.parse(await invoke(SYSTEM_DIAGNOSTICS_CHANNEL));
      }
    })
  });
}
