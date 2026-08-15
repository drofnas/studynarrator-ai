import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import {
  expect,
  test as studyNarratorTest,
  type StudyNarratorTestApplication
} from "./studyNarratorTest.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const desktopRoot = resolve(repositoryRoot, "apps/desktop");
const electronExecutable = process.platform === "darwin"
  ? resolve(desktopRoot, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
  : process.platform === "win32"
    ? resolve(desktopRoot, "node_modules/electron/dist/electron.exe")
    : resolve(desktopRoot, "node_modules/electron/dist/electron");

async function launch(application: StudyNarratorTestApplication, dataDirectory: string): Promise<ElectronApplication> {
  return await electron.launch({
    args: ["."],
    cwd: desktopRoot,
    executablePath: electronExecutable,
    env: {
      ...application.environment,
      STUDYNARRATOR_DATA_DIR: dataDirectory,
      STUDYNARRATOR_RENDERER_URL: application.baseUrl,
      STUDYNARRATOR_OPEN_DEVTOOLS: "false"
    }
  });
}

export class ElectronStudyNarrator {
  application: ElectronApplication;
  page: Page;

  private constructor(
    application: ElectronApplication,
    page: Page,
    readonly dataDirectory: string,
    private readonly webApplication: StudyNarratorTestApplication
  ) {
    this.application = application;
    this.page = page;
  }

  static async start(webApplication: StudyNarratorTestApplication): Promise<ElectronStudyNarrator> {
    const dataDirectory = resolve(webApplication.dataDirectory, "electron");
    await mkdir(dataDirectory, { recursive: true });
    const application = await launch(webApplication, dataDirectory);
    const page = await application.firstWindow();
    return new ElectronStudyNarrator(application, page, dataDirectory, webApplication);
  }

  async relaunch(): Promise<Page> {
    await this.application.close();
    this.application = await launch(this.webApplication, this.dataDirectory);
    this.page = await this.application.firstWindow();
    return this.page;
  }

  async close(): Promise<void> {
    await this.application.close();
  }
}

export const test = studyNarratorTest.extend<{ electronStudyNarrator: ElectronStudyNarrator }>({
  electronStudyNarrator: async ({ studyNarrator }, use) => {
    const harness = await ElectronStudyNarrator.start(studyNarrator);
    try {
      await use(harness);
    } finally {
      await harness.close();
    }
  }
});

export async function continueElectronOffline(page: Page): Promise<void> {
  const onboarding = page.getByRole("heading", { name: "Connect the voice workshop" });
  const projects = page.getByRole("heading", { name: "Projects", exact: true });
  await expect(onboarding).toBeVisible();
  await page.getByRole("button", { name: "Continue offline" }).click();
  await expect(projects).toBeVisible();
}

export async function configureElectronConnection(page: Page, application: StudyNarratorTestApplication): Promise<void> {
  const onboarding = page.getByRole("heading", { name: "Connect the voice workshop" });
  const projects = page.getByRole("heading", { name: "Projects", exact: true });
  await expect(onboarding).toBeVisible();
  await page.getByLabel("Speaches address").fill(application.fakeSpeaches.baseUrl);
  await page.getByRole("button", { name: "Load catalog" }).click();
  await expect(page.getByLabel("Model")).toHaveValue("speaches-ai/Kokoro-82M-v1.0-ONNX");
  await expect(page.getByLabel("Default Voice")).toHaveValue("af_heart");
  await expect(page.getByRole("option", { name: "Heart (af_heart | en-US)" })).toBeAttached();
  await page.getByRole("button", { name: "Save and Test" }).click();
  await expect(projects).toBeVisible();
  await page.evaluate(async () => {
    const bridge = (window as typeof window & { studyNarrator: {
      connection: {
        get(): Promise<{ baseUrl: string | null }>;
        update(input: Record<string, unknown>): Promise<unknown>;
      };
    } }).studyNarrator;
    const connection = await bridge.connection.get();
    await bridge.connection.update({
      baseUrl: connection.baseUrl,
      defaultModelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      defaultVoiceId: "af_heart",
      timeoutSeconds: 2,
      retryCount: 0,
      responseFormat: "wav"
    });
  });
  await page.reload();
  await expect(projects).toBeVisible();
}

export { expect };
