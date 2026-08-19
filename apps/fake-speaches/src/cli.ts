import { startFakeSpeachesServer, type FakeSpeachesScenario } from "./index.js";

const port = Number.parseInt(
  process.env.STUDYNARRATOR_FAKE_SPEACHES_PORT ?? "18080",
  10,
);
const host = process.env.STUDYNARRATOR_FAKE_SPEACHES_HOST ?? "127.0.0.1";
const scenario = (process.env.STUDYNARRATOR_FAKE_SPEACHES_SCENARIO ??
  "healthy") as FakeSpeachesScenario;
const server = await startFakeSpeachesServer({ host, port, scenario });

process.stdout.write(
  `Fake Speaches listening at ${server.baseUrl} (${scenario})\n`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}
