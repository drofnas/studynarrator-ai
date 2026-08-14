import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const secret = process.env.STUDYNARRATOR_DOCKER_TEST_SECRET ?? "docker-verification-secret-never-exposed";
const fakeSpeachesUrl = process.env.STUDYNARRATOR_FAKE_SPEACHES_URL;

async function jsonRequest(request: APIRequestContext, method: "get" | "post" | "put", path: string, data?: unknown): Promise<unknown> {
  const response = await request[method](path, data === undefined ? undefined : { data });
  expect(response.ok(), `${method.toUpperCase()} ${path}: ${response.status()} ${await response.text()}`).toBe(true);
  const body = await response.json() as unknown;
  expect(JSON.stringify(body)).not.toContain(secret);
  return body;
}

async function setFakeScenario(request: APIRequestContext, scenario: "healthy" | "timeout"): Promise<void> {
  if (!fakeSpeachesUrl) throw new Error("STUDYNARRATOR_FAKE_SPEACHES_URL is required.");
  await jsonRequest(request, "put", `${fakeSpeachesUrl}/__control/scenario`, { scenario });
}

async function pollRender(request: APIRequestContext, renderId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const render = await jsonRequest(request, "get", `/api/renders/${renderId}`) as Record<string, unknown>;
    if (["complete", "failed", "canceled"].includes(String(render.state))) return render;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Render ${renderId} did not reach a terminal state.`);
}

async function assertBrowserStorageRedacted(page: Page): Promise<void> {
  const browserState = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    return {
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      cookies: document.cookie,
      indexedDatabaseNames: databases.map(({ name }) => name ?? "")
    };
  });
  expect(JSON.stringify(browserState)).not.toContain(secret);
}

test("Docker Web remains authorable offline and renders after Speaches reconnects", async ({ browserName, page, request }) => {
  const runtime = await jsonRequest(request, "get", "/api/runtime") as Record<string, unknown>;
  expect(runtime).toMatchObject({ schemaVersion: 4, distribution: "docker-web" });
  expect(runtime.sourceRevision).toBe(process.env.STUDYNARRATOR_EXPECTED_SOURCE_REVISION);
  await jsonRequest(request, "post", "/api/setup/complete");

  await setFakeScenario(request, "timeout");
  const offline = await jsonRequest(request, "post", "/api/connections/environment-speaches/test") as Record<string, unknown>;
  expect(offline.overall).toBe("disconnected");

  const name = `Docker ${browserName} persistence`;
  const created = await jsonRequest(request, "post", "/api/projects", { name, description: "Created while Speaches is offline." }) as {
    id: string;
    name: string;
    pausePresets: unknown[];
    transitionPauses: unknown;
  };
  await page.goto(`/#/projects/${created.id}`);
  await expect(page.getByLabel("Project name").last()).toHaveValue(name);

  await setFakeScenario(request, "healthy");
  const connected = await jsonRequest(request, "post", "/api/connections/environment-speaches/test") as Record<string, unknown>;
  expect(connected.overall).toBe("connected");

  await jsonRequest(request, "put", `/api/projects/${created.id}`, {
    name,
    description: "Created offline and rendered after reconnecting without a container restart.",
    scriptSource: `[speaker_teacher] Deterministic Docker render from ${browserName}.`,
    connectionProfileId: "environment-speaches",
    modelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
    speakerMappings: [{
      speakerId: "teacher",
      displayName: "Teacher",
      voiceId: "af_heart",
      speed: 1,
      gainDb: 0,
      roleDescription: "",
      sampleText: ""
    }],
    pausePresets: created.pausePresets,
    transitionPauses: created.transitionPauses,
    lexiconEntries: []
  });
  const plan = await jsonRequest(request, "post", `/api/projects/${created.id}/render-plans`) as { id: string };
  const started = await jsonRequest(request, "post", `/api/render-plans/${plan.id}/renders`) as { id: string };
  const completed = await pollRender(request, started.id);
  expect(completed.state).toBe("complete");
  const artifacts = await jsonRequest(request, "get", `/api/renders/${started.id}/artifacts`) as unknown[];
  expect(artifacts).toHaveLength(7);

  await page.goto("/#/diagnostics");
  await page.getByRole("button", { name: "Run self-test" }).click();
  await expect(page.getByText("Docker Web")).toBeVisible();
  await expect(page.getByText(String(runtime.sourceRevision), { exact: true })).toBeVisible();
  await page.goto(`/#/projects/${created.id}?tab=render`);
  await expect(page.getByText(/Phase: complete/u)).toBeVisible();

  const diagnostics = await jsonRequest(request, "get", "/api/diagnostics");
  const connectionDiagnostics = await jsonRequest(request, "get", "/api/connections/environment-speaches/diagnostics");
  const connections = await jsonRequest(request, "get", "/api/connections");
  expect(JSON.stringify({ runtime, diagnostics, connectionDiagnostics, connections })).not.toContain(secret);
  await assertBrowserStorageRedacted(page);
});
