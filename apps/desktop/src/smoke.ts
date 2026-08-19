import { app } from "electron";
import { SystemDiagnosticsSchema } from "@studynarrator/shared-types";
import { createDesktopServices } from "./bootstrap.js";

void app.whenReady().then(async () => {
  const defaultDataDirectory = app.getPath("userData");
  const smokeProjectName = "Deterministic runtime smoke";
  const first = await createDesktopServices({ defaultDataDirectory });
  try {
    const existing = (await first.persistence.projects.list()).find(
      (project) => project.name === smokeProjectName,
    );
    if (!existing)
      await first.persistence.projects.create({
        name: smokeProjectName,
        description: "Disposable reopen evidence",
      });
  } finally {
    first.service.close();
  }
  const reopened = await createDesktopServices({ defaultDataDirectory });
  try {
    const summary = (await reopened.persistence.projects.list()).find(
      (project) => project.name === smokeProjectName,
    );
    if (!summary)
      throw new Error("The runtime smoke project did not survive reopen.");
    const project = await reopened.persistence.projects.get(summary.id);
    const diagnostics = SystemDiagnosticsSchema.parse(
      await reopened.service.diagnostics(reopened.context),
    );
    process.stdout.write(
      `${JSON.stringify({ ...diagnostics, persistenceSmoke: { projectId: project.id, reopened: true } })}\n`,
    );
    app.exit(diagnostics.overall === "pass" ? 0 : 1);
  } catch {
    app.exit(1);
  } finally {
    reopened.service.close();
  }
});
