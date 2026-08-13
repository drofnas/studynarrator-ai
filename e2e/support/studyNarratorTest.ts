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
      SPEACHES_BASE_URL: fakeSpeaches.baseUrl,
      SPEACHES_MODEL_ID: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      SPEACHES_VOICE_ID: "af_heart",
      SPEACHES_TIMEOUT_SECONDS: "2"
    };
    const services = await createServerServices(environment);
    const application = createExpressApp({
      service: services.service,
      persistence: services.persistence,
      context: services.context,
      ...(services.connections === undefined ? {} : { connections: services.connections }),
      ...(services.voiceCatalog === undefined ? {} : { voiceCatalog: services.voiceCatalog })
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
      services.dispose();
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

export { expect };
