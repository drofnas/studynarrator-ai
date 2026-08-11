import { app } from "electron";
import { SystemDiagnosticsSchema } from "@studynarrator/shared-types";
import { createDesktopServices } from "./bootstrap.js";

void app.whenReady().then(async () => {
  const runtime = createDesktopServices({ defaultDataDirectory: app.getPath("userData") });
  try {
    const diagnostics = SystemDiagnosticsSchema.parse(await runtime.service.diagnostics(runtime.context));
    process.stdout.write(`${JSON.stringify(diagnostics)}\n`);
    app.exit(diagnostics.overall === "pass" ? 0 : 1);
  } catch {
    app.exit(1);
  } finally {
    runtime.service.close();
  }
});
