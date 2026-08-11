import { createExpressApp } from "./app.js";
import { createServerServices } from "./bootstrap.js";

const port = Number.parseInt(process.env.STUDYNARRATOR_PORT ?? "4310", 10);
const { service, context } = createServerServices();
const server = createExpressApp({ service, context }).listen(port, "127.0.0.1", () => {
  console.log(`StudyNarrator G01 server listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => {
    service.close();
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
