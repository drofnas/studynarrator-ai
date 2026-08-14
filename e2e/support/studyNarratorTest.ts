import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve, sep } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { startFakeSpeachesServer, type FakeSpeachesServer } from "@studynarrator/fake-speaches";
import { attachStaticWebApplication, createExpressApp } from "@studynarrator/server/app";
import { createServerServices } from "@studynarrator/server/bootstrap";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const temporaryRoot = resolve(repositoryRoot, ".tmp/playwright");
const webDistribution = resolve(repositoryRoot, "apps/web/dist");

export interface StudyNarratorTestApplication {
  baseUrl: string;
  dataDirectory: string;
  fakeSpeaches: FakeSpeachesServer;
  environment: NodeJS.ProcessEnv;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The Playwright host did not obtain a loopback port."));
        return;
      }
      resolvePort(address.port);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

async function removeTestDirectory(dataDirectory: string): Promise<void> {
  const expectedPrefix = `${temporaryRoot}${sep}`;
  if (!dataDirectory.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove an unexpected Playwright directory: ${dataDirectory}`);
  }
  await rm(dataDirectory, { recursive: true, force: true });
}

export const test = base.extend<{
  studyNarrator: StudyNarratorTestApplication;
  studyNarratorEnvironment: NodeJS.ProcessEnv;
}>({
  studyNarratorEnvironment: [{}, { option: true }],
  studyNarrator: async ({ studyNarratorEnvironment }, use) => {
    await mkdir(temporaryRoot, { recursive: true });
    const dataDirectory = await mkdtemp(resolve(temporaryRoot, "case-"));
    const fakeSpeaches = await startFakeSpeachesServer();
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...studyNarratorEnvironment,
      INIT_CWD: repositoryRoot,
      STUDYNARRATOR_DATA_DIR: dataDirectory,
    };
    const services = await createServerServices(environment);
    const application = createExpressApp({
      service: services.service,
      persistence: services.persistence,
      context: services.context,
      ...(services.connection === undefined ? {} : { connection: services.connection }),
      ...(services.voiceCatalog === undefined ? {} : { voiceCatalog: services.voiceCatalog }),
      ...(services.scratchpad === undefined ? {} : { scratchpad: services.scratchpad }),
      ...(services.projectPreview === undefined ? {} : { projectPreview: services.projectPreview }),
      ...(services.renderPlans === undefined ? {} : { renderPlans: services.renderPlans }),
      ...(services.renders === undefined ? {} : { renders: services.renders }),
      ...(services.scriptGeneration === undefined ? {} : { scriptGeneration: services.scriptGeneration }),
      speechCache: services.speechCache
    });
    attachStaticWebApplication(application, webDistribution);
    const server = createServer(application);
    const port = await listen(server);

    try {
      await use({
        baseUrl: `http://127.0.0.1:${String(port)}`,
        dataDirectory,
        fakeSpeaches,
        environment
      });
    } finally {
      await closeServer(server);
      await services.dispose();
      await fakeSpeaches.close();
      await removeTestDirectory(dataDirectory);
    }
  }
});

export async function openRoute(page: Page, application: StudyNarratorTestApplication, route: string): Promise<void> {
  await page.goto(`${application.baseUrl}/#${route}`);
}

export async function continueOffline(page: Page, application: StudyNarratorTestApplication): Promise<void> {
  await openRoute(page, application, "/projects");
  const onboarding = page.getByRole("heading", { name: "Connect the voice workshop" });
  const projects = page.getByRole("heading", { name: "Projects", exact: true });
  await expect(onboarding.or(projects)).toBeVisible();
  if (await onboarding.isVisible()) {
    await page.getByRole("button", { name: "Continue offline" }).click();
  }
  await expect(projects).toBeVisible();
}

export async function configureConnection(page: Page, application: StudyNarratorTestApplication): Promise<void> {
  await openRoute(page, application, "/projects");
  const onboarding = page.getByRole("heading", { name: "Connect the voice workshop" });
  const projects = page.getByRole("heading", { name: "Projects", exact: true });
  await expect(onboarding.or(projects)).toBeVisible();
  if (await onboarding.isVisible()) {
    await page.getByLabel("Speaches address").fill(application.fakeSpeaches.baseUrl);
    await page.getByRole("button", { name: "Load catalog" }).click();
    await expect(page.getByLabel("Model")).toHaveValue("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await expect(page.getByLabel("Default Voice")).toHaveValue("af_heart");
    await expect(page.getByRole("option", { name: "Heart (af_heart | en-US)" })).toBeAttached();
    await page.getByRole("button", { name: "Save and Test" }).click();
  }
  await expect(projects).toBeVisible();
  await page.evaluate(async () => {
    const response = await fetch("/api/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: (await (await fetch("/api/connection")).json() as { baseUrl: string }).baseUrl,
        defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
        defaultVoiceId: "af_heart",
        timeoutSeconds: 2,
        retryCount: 0,
        responseFormat: "wav"
      })
    });
    if (!response.ok) throw new Error(`Could not tune the acceptance connection: ${String(response.status)}.`);
  });
  await page.reload();
  await expect(projects).toBeVisible();
}

export { expect };
