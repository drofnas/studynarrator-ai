import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve, sep } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import {
  startFakeSpeachesServer,
  type FakeSpeachesServer,
} from "@studynarrator/fake-speaches";
import {
  attachStaticWebApplication,
  createExpressApp,
} from "@studynarrator/server/app";
import { createServerServices } from "@studynarrator/server/bootstrap";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const temporaryRoot = resolve(repositoryRoot, ".tmp/playwright");
const webDistribution = resolve(repositoryRoot, "apps/web/dist");

export interface StudyNarratorTestApplication {
  baseUrl: string;
  dataDirectory: string;
  fakeSpeaches: FakeSpeachesServer;
  environment: NodeJS.ProcessEnv;
  restart: () => Promise<void>;
}

export interface StudyNarratorSetup {
  dataDirectory: string;
  environment: NodeJS.ProcessEnv;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(
          new Error("The Playwright host did not obtain a loopback port."),
        );
        return;
      }
      resolvePort(address.port);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

async function removeTestDirectory(dataDirectory: string): Promise<void> {
  const expectedPrefix = `${temporaryRoot}${sep}`;
  if (!dataDirectory.startsWith(expectedPrefix)) {
    throw new Error(
      `Refusing to remove an unexpected Playwright directory: ${dataDirectory}`,
    );
  }
  await rm(dataDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

export const test = base.extend<{
  studyNarrator: StudyNarratorTestApplication;
  studyNarratorEnvironment: NodeJS.ProcessEnv;
  studyNarratorSetup: (setup: StudyNarratorSetup) => Promise<void>;
}>({
  studyNarratorEnvironment: [{}, { option: true }],
  studyNarratorSetup: [
    async ({ studyNarratorEnvironment: _environment }, use) => {
      await use(async () => {});
    },
    { option: true },
  ],
  studyNarrator: async (
    { studyNarratorEnvironment, studyNarratorSetup },
    use,
  ) => {
    await mkdir(temporaryRoot, { recursive: true });
    const dataDirectory = await mkdtemp(resolve(temporaryRoot, "case-"));
    const fakeSpeaches = await startFakeSpeachesServer();
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...studyNarratorEnvironment,
      INIT_CWD: repositoryRoot,
      STUDYNARRATOR_DATA_DIR: dataDirectory,
    };
    await studyNarratorSetup({ dataDirectory, environment });

    interface ActiveRuntime {
      server: Server;
      services: Awaited<ReturnType<typeof createServerServices>>;
    }

    const runtime: {
      current: ActiveRuntime | null;
    } = {
      current: null,
    };
    const application: StudyNarratorTestApplication = {
      baseUrl: "",
      dataDirectory,
      fakeSpeaches,
      environment,
      restart: () => startServer(),
    };

    async function startServer(): Promise<void> {
      const services = await createServerServices(environment);
      const expressApp = createExpressApp({
        service: services.service,
        persistence: services.persistence,
        context: services.context,
        ...(services.connection === undefined
          ? {}
          : { connection: services.connection }),
        ...(services.voiceCatalog === undefined
          ? {}
          : { voiceCatalog: services.voiceCatalog }),
        ...(services.scratchpad === undefined
          ? {}
          : { scratchpad: services.scratchpad }),
        ...(services.projectPreview === undefined
          ? {}
          : { projectPreview: services.projectPreview }),
        ...(services.renders === undefined
          ? {}
          : { renders: services.renders }),
        ...(services.scriptGeneration === undefined
          ? {}
          : { scriptGeneration: services.scriptGeneration }),
        speechCache: services.speechCache,
      });
      attachStaticWebApplication(expressApp, webDistribution);
      const server = createServer(expressApp);
      const nextPort = await listen(server);
      if (runtime.current) {
        await closeServer(runtime.current.server);
        await runtime.current.services.dispose();
      }
      runtime.current = { server, services };
      application.baseUrl = `http://127.0.0.1:${String(nextPort)}`;
    }

    try {
      await startServer();
      await use(application);
    } finally {
      if (runtime.current) {
        await closeServer(runtime.current.server);
        await runtime.current.services.dispose();
      }
      await fakeSpeaches.close();
      await removeTestDirectory(dataDirectory);
    }
  },
});

export async function openRoute(
  page: Page,
  application: StudyNarratorTestApplication,
  route: string,
): Promise<void> {
  await page.goto(`${application.baseUrl}/#${route}`);
}

export async function continueOffline(
  page: Page,
  application: StudyNarratorTestApplication,
): Promise<void> {
  await openRoute(page, application, "/projects");
  const onboarding = page.getByRole("heading", {
    name: "Connect the voice workshop",
  });
  const projects = page.getByRole("heading", { name: "Projects", exact: true });
  await expect(onboarding.or(projects)).toBeVisible();
  if (await onboarding.isVisible()) {
    await page.getByRole("button", { name: "Continue offline" }).click();
  }
  await expect(projects).toBeVisible();
}

export async function configureConnection(
  page: Page,
  application: StudyNarratorTestApplication,
): Promise<void> {
  await openRoute(page, application, "/projects");
  const onboarding = page.getByRole("heading", {
    name: "Connect the voice workshop",
  });
  const projects = page.getByRole("heading", { name: "Projects", exact: true });
  await expect(onboarding.or(projects)).toBeVisible();
  if (await onboarding.isVisible()) {
    await page
      .getByLabel("Speaches address")
      .fill(application.fakeSpeaches.baseUrl);
    await page.getByRole("button", { name: "Load catalog" }).click();
    await expect(page.getByLabel("Model")).toHaveValue(
      "speaches-ai/Kokoro-82M-v1.0-ONNX",
    );
    await expect(page.getByLabel("Default Voice")).toHaveValue("af_heart");
    await expect(
      page.getByRole("option", { name: "Heart (af_heart | en-US)" }),
    ).toBeAttached();
    await page.getByRole("button", { name: "Save and Test" }).click();
  }
  await expect(projects).toBeVisible();
  await page.evaluate(async () => {
    const response = await fetch("/api/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: (
          (await (await fetch("/api/connection")).json()) as { baseUrl: string }
        ).baseUrl,
        defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
        defaultVoiceId: "af_heart",
        timeoutSeconds: 2,
        retryCount: 0,
        responseFormat: "wav",
      }),
    });
    if (!response.ok)
      throw new Error(
        `Could not tune the acceptance connection: ${String(response.status)}.`,
      );
  });
  await page.reload();
  await expect(projects).toBeVisible();
}

export { expect };
