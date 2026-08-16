import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const secret = process.env.STUDYNARRATOR_DOCKER_TEST_SECRET ?? "docker-verification-secret-never-exposed";
const fakeSpeachesUrl = process.env.STUDYNARRATOR_FAKE_SPEACHES_URL;
const fakeSpeachesAppUrl = process.env.STUDYNARRATOR_FAKE_SPEACHES_APP_URL;

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
  expect(runtime).toMatchObject({ schemaVersion: 1, distribution: "docker-web" });
  expect(runtime.sourceRevision).toBe(process.env.STUDYNARRATOR_EXPECTED_SOURCE_REVISION);

  const initialConnection = await jsonRequest(request, "get", "/api/connection") as Record<string, unknown>;
  expect(fakeSpeachesAppUrl, "STUDYNARRATOR_FAKE_SPEACHES_APP_URL is required.").toBeTruthy();
  await setFakeScenario(request, "healthy");

  if (browserName === "chromium") {
    expect(initialConnection).toMatchObject({ baseUrl: null, configured: false });
    const catalog = await jsonRequest(request, "post", "/api/connection/speech-catalog", {
      baseUrl: fakeSpeachesAppUrl,
      timeoutSeconds: 2,
      retryCount: 0
    }) as { models: Array<{ modelId: string; voices: Array<{ voiceId: string }> }> };
    expect(catalog.models[0]?.modelId).toBe("speaches-ai/Kokoro-82M-v1.0-ONNX");
    expect(catalog.models[0]?.voices[0]?.voiceId).toBe("af_heart");
    await jsonRequest(request, "put", "/api/connection", {
      baseUrl: fakeSpeachesAppUrl,
      defaultModelId: catalog.models[0]?.modelId,
      defaultVoiceId: catalog.models[0]?.voices[0]?.voiceId,
      timeoutSeconds: 2,
      retryCount: 0,
      responseFormat: "wav"
    });
    await jsonRequest(request, "post", "/api/setup/complete");
  } else {
    expect(initialConnection).toMatchObject({ baseUrl: fakeSpeachesAppUrl, configured: true });
  }

  const initialTest = await jsonRequest(request, "post", "/api/connection/test") as Record<string, unknown>;
  expect(initialTest.overall).toBe("connected");

  await setFakeScenario(request, "timeout");
  const offline = await jsonRequest(request, "post", "/api/connection/test") as Record<string, unknown>;
  expect(offline.overall).toBe("disconnected");

  const name = `Docker ${browserName} persistence`;
  const created = await jsonRequest(request, "post", "/api/projects", { name, description: "Created while Speaches is offline." }) as {
    id: string;
    name: string;
  };
  await page.goto(`/#/projects/${created.id}`);
  await expect(page.getByLabel("Project name").last()).toHaveValue(name);

  await setFakeScenario(request, "healthy");
  const connected = await jsonRequest(request, "post", "/api/connection/test") as Record<string, unknown>;
  expect(connected.overall).toBe("connected");

  const timing = await jsonRequest(request, "get", "/api/settings/pacing") as {
    pausePresets: unknown[];
    transitionPauses: Record<string, unknown>;
  };
  await jsonRequest(request, "put", "/api/settings/pacing", {
    ...timing,
    transitionPauses: { ...timing.transitionPauses, paragraph: { mode: "duration", durationMs: 625 } }
  });

  await jsonRequest(request, "put", `/api/projects/${created.id}`, {
    name,
    description: "Created offline and rendered after reconnecting without a container restart.",
    scriptSource: `[speaker_teacher] Deterministic Docker render from ${browserName}.\n\n[speaker_teacher] Global timing applies here.`,
    speakerMappings: [{
      speakerId: "teacher",
      displayName: "Teacher",
      voiceId: "af_heart",
      speed: 1,
      gainDb: 0,
      roleDescription: "",
      sampleText: ""
    }],
    lexiconEntries: []
  });
  const started = await jsonRequest(request, "post", `/api/projects/${created.id}/renders`) as { id: string };
  const [plan] = await jsonRequest(request, "get", `/api/projects/${created.id}/render-plans`) as Array<{ id: string }>;
  if (!plan) throw new Error("Project render did not create its current plan.");
  const planDetail = await jsonRequest(request, "get", `/api/render-plans/${plan.id}`) as { entries: Array<{ type: string; durationMs?: number }> };
  expect(planDetail.entries).toContainEqual(expect.objectContaining({ type: "pause", durationMs: 625 }));
  const completed = await pollRender(request, started.id);
  expect(completed.state).toBe("complete");
  const artifacts = await jsonRequest(request, "get", `/api/renders/${started.id}/artifacts`) as unknown[];
  expect(artifacts).toHaveLength(7);

  await page.goto("/#/diagnostics");
  await page.getByRole("button", { name: "Run self-test" }).click();
  await expect(page.getByText("Docker Web")).toBeVisible();
  await expect(page.getByText(String(runtime.sourceRevision), { exact: true })).toBeVisible();
  await page.goto(`/#/projects/${created.id}?tab=render`);
  await expect(page.getByLabel(/Audio player for Completed project render/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible();

  const diagnostics = await jsonRequest(request, "get", "/api/diagnostics");
  const connectionDiagnostics = await jsonRequest(request, "get", "/api/connection/diagnostics");
  const connection = await jsonRequest(request, "get", "/api/connection");
  expect(JSON.stringify({ runtime, diagnostics, connectionDiagnostics, connection })).not.toContain(secret);
  await assertBrowserStorageRedacted(page);
});
