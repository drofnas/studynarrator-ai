import { createExpressApp } from "./app.js";
import { createServerServices } from "./bootstrap.js";

const port = Number.parseInt(process.env.STUDYNARRATOR_PORT ?? "4310", 10);
const runtime = await createServerServices();
const { service, persistence, connections, voiceCatalog, scratchpad, projectPreview, renderPlans, renders, scriptGeneration, speechCache, context } = runtime;
const server = createExpressApp({
  service,
  persistence,
  context,
  ...(connections === undefined ? {} : { connections }),
  ...(voiceCatalog === undefined ? {} : { voiceCatalog }),
  ...(scratchpad === undefined ? {} : { scratchpad }),
  ...(projectPreview === undefined ? {} : { projectPreview }),
  ...(renderPlans === undefined ? {} : { renderPlans }),
  ...(renders === undefined ? {} : { renders }),
  ...(scriptGeneration === undefined ? {} : { scriptGeneration }),
  speechCache
}).listen(port, "127.0.0.1", () => {
  console.log(`StudyNarrator server listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => {
    void runtime.dispose();
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
