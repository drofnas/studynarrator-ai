import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { StudyNarratorBridge } from "@studynarrator/shared-types";
import { continueElectronOffline, expect, test } from "../support/electronTest.js";

const secret = "test-secret-must-not-appear";

interface ElectronEvaluationApi {
  safeStorage: {
    isEncryptionAvailable(): boolean;
    getSelectedStorageBackend?: () => string;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
}

test.describe("Electron acceptance", () => {
  test("uses typed IPC for route access and exposes no Node or generic primitive", async ({ electronStudyNarrator }) => {
    const { page } = electronStudyNarrator;
    await continueElectronOffline(page);
    const bridgeShape = await page.evaluate(() => {
      const renderer = window as typeof window & { studyNarrator?: StudyNarratorBridge };
      return {
        bridge: Object.keys(renderer.studyNarrator ?? {}).sort(),
        hasRequire: "require" in window,
        hasProcess: "process" in window,
        frozen: renderer.studyNarrator ? Object.isFrozen(renderer.studyNarrator) : false
      };
    });
    expect(bridgeShape).toEqual({
      bridge: ["connections", "persistence", "system", "voiceCatalog"],
      hasRequire: false,
      hasProcess: false,
      frozen: true
    });

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("link", { name: "System diagnostics" }).click();
    await page.getByRole("button", { name: "Run self-test" }).click();
    await expect(page.getByText("IPC")).toBeVisible();
    await expect(page.getByText(/Electron 43/u)).toBeVisible();
  });

  test("persists project UI state across a desktop relaunch", async ({ electronStudyNarrator }) => {
    let page = electronStudyNarrator.page;
    await continueElectronOffline(page);
    await page.getByLabel("Project name").fill("Desktop durable project");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: "Script editor" })).toBeVisible();
    await page.getByLabel("Script source").fill("[speaker_teacher] Persist through relaunch.");
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText("All changes saved.")).toBeVisible();

    page = await electronStudyNarrator.relaunch();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Desktop durable project/u }).click();
    await expect(page.getByLabel("Script source")).toHaveValue("[speaker_teacher] Persist through relaunch.");
  });

  test("clears one-shot credential input and never stores plaintext", async ({ electronStudyNarrator, studyNarrator }) => {
    const { page, application, dataDirectory } = electronStudyNarrator;
    await continueElectronOffline(page);
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "New saved profile" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Desktop credential profile");
    await page.getByLabel("Endpoint root or /v1").fill(studyNarrator.fakeSpeaches.baseUrl);
    await page.getByLabel("Model ID").fill("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await page.getByLabel("Default voice ID").fill("af_heart");
    const credential = page.getByLabel("Replace API key (one shot)");
    await credential.fill(secret);
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(credential).toHaveValue("");

    const encryptionAvailable = await application.evaluate(({ safeStorage }: ElectronEvaluationApi) =>
      safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== "basic_text");
    if (encryptionAvailable) {
      await expect(page.getByText("Desktop credential profile saved.")).toBeVisible();
      await expect(page.getByText(/API key: configured/u)).toBeVisible();
      const vaultPath = resolve(dataDirectory, "credentials.safe-storage.json");
      const vault = await readFile(vaultPath, "utf8");
      expect(vault).not.toContain(secret);
      expect((await stat(vaultPath)).mode & 0o777).toBe(0o600);
    } else {
      await expect(page.getByRole("alert")).toContainText("could not complete the connection operation");
    }

    const rendererStorage = await page.evaluate(() => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}${document.body.textContent ?? ""}`);
    expect(rendererStorage).not.toContain(secret);
    const database = await readFile(resolve(dataDirectory, "studynarrator.sqlite"));
    expect(database.includes(Buffer.from(secret))).toBe(false);
  });

  test("opens only approved Speaches links outside the renderer", async ({ electronStudyNarrator }) => {
    const { page, application } = electronStudyNarrator;
    await application.evaluate(({ shell }: ElectronEvaluationApi) => {
      const scope = globalThis as typeof globalThis & { __studyNarratorOpenedUrls?: string[] };
      scope.__studyNarratorOpenedUrls = [];
      shell.openExternal = (url: string) => {
        scope.__studyNarratorOpenedUrls?.push(url);
        return Promise.resolve();
      };
    });

    await expect(page.getByRole("heading", { name: "Connect the voice workshop" })).toBeVisible();
    await page.getByRole("link", { name: "Official installation guide" }).click();
    await expect.poll(async () => await application.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __studyNarratorOpenedUrls?: string[] };
      return scope.__studyNarratorOpenedUrls ?? [];
    })).toEqual(["https://speaches.ai/installation/"]);

    await page.evaluate(() => window.open("https://example.com/not-approved", "_blank"));
    await expect.poll(async () => await application.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __studyNarratorOpenedUrls?: string[] };
      return scope.__studyNarratorOpenedUrls ?? [];
    })).toEqual(["https://speaches.ai/installation/"]);
    expect(application.windows()).toHaveLength(1);
  });
});
