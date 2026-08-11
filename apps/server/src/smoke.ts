import { SystemDiagnosticsSchema } from "@studynarrator/shared-types";
import { createServerServices } from "./bootstrap.js";

const { service, context } = createServerServices();
try {
  const diagnostics = SystemDiagnosticsSchema.parse(await service.diagnostics(context));
  process.stdout.write(`${JSON.stringify(diagnostics)}\n`);
  if (diagnostics.overall !== "pass") process.exitCode = 1;
} finally {
  service.close();
}
