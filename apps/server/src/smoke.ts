import { SystemDiagnosticsSchema } from "@studynarrator/shared-types";
import { createServerServices } from "./bootstrap.js";

const smokeProjectName = "G04 deterministic runtime smoke";
const first = await createServerServices();
try {
  const existing = (await first.persistence.projects.list()).find((project) => project.name === smokeProjectName);
  if (!existing) await first.persistence.projects.create({ name: smokeProjectName, description: "Disposable reopen evidence" });
} finally {
  first.service.close();
}

const reopened = await createServerServices();
try {
  const summary = (await reopened.persistence.projects.list()).find((project) => project.name === smokeProjectName);
  if (!summary) throw new Error("The runtime smoke project did not survive reopen.");
  const project = await reopened.persistence.projects.get(summary.id);
  const diagnostics = SystemDiagnosticsSchema.parse(await reopened.service.diagnostics(reopened.context));
  process.stdout.write(`${JSON.stringify({ ...diagnostics, persistenceSmoke: { projectId: project.id, reopened: true } })}\n`);
  if (diagnostics.overall !== "pass") process.exitCode = 1;
} finally {
  reopened.service.close();
}
