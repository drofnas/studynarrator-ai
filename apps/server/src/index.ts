import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { attachStaticWebApplication, createExpressApp } from "./app.js";
import { createServerServices } from "./bootstrap.js";
import { resolveServerRuntimeConfiguration } from "./runtimeConfig.js";

const configuration = resolveServerRuntimeConfiguration();
const runtime = await createServerServices();
const {
  service,
  persistence,
  connection,
  voiceCatalog,
  scratchpad,
  projectPreview,
  renders,
  scriptGeneration,
  speechCache,
  context,
  logger,
} = runtime;
const application = createExpressApp({
  service,
  persistence,
  context,
  ...(connection === undefined ? {} : { connection }),
  ...(voiceCatalog === undefined ? {} : { voiceCatalog }),
  ...(scratchpad === undefined ? {} : { scratchpad }),
  ...(projectPreview === undefined ? {} : { projectPreview }),
  ...(renders === undefined ? {} : { renders }),
  ...(scriptGeneration === undefined ? {} : { scriptGeneration }),
  speechCache,
  logger,
});
const webEntryPoint = resolve(
  configuration.webDistributionDirectory,
  "index.html",
);
if (existsSync(webEntryPoint)) {
  attachStaticWebApplication(
    application,
    configuration.webDistributionDirectory,
  );
} else if (configuration.requireWebDistribution) {
  throw new Error(
    `StudyNarrator Web distribution is missing at ${webEntryPoint}.`,
  );
}
const server = application.listen(
  configuration.port,
  configuration.host,
  () => {
    console.log(
      `StudyNarrator ${configuration.distribution} server listening on http://${configuration.host}:${String(configuration.port)}`,
    );
  },
);

function shutdown() {
  server.close(() => {
    void runtime.dispose();
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
