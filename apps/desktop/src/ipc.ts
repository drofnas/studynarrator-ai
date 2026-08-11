import {
  SYSTEM_DIAGNOSTICS_CHANNEL,
  SystemDiagnosticsSchema,
  type SystemDiagnostics
} from "@studynarrator/shared-types";
import type { DiagnosticsContext, SystemService } from "@studynarrator/application";

interface IpcMainLike {
  handle(channel: string, listener: () => Promise<SystemDiagnostics>): void;
  removeHandler(channel: string): void;
}

export function registerDiagnosticsHandler(
  ipcMain: IpcMainLike,
  service: SystemService,
  context: DiagnosticsContext
) {
  ipcMain.removeHandler(SYSTEM_DIAGNOSTICS_CHANNEL);
  ipcMain.handle(SYSTEM_DIAGNOSTICS_CHANNEL, async () => {
    return SystemDiagnosticsSchema.parse(await service.diagnostics(context));
  });
}
