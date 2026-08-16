import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import type { Page } from "@playwright/test";
import type { StudyNarratorBridge } from "@studynarrator/shared-types";
import { configureElectronConnection, continueElectronOffline, expect, test } from "../support/electronTest.js";

interface ElectronEvaluationApi {
  shell: {
    openExternal(url: string): Promise<void>;
  };
  dialog: {
    showSaveDialog(options: { defaultPath: string }): Promise<{ canceled: boolean; filePath?: string }>;
  };
}

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");
}

async function openProject(page: Page, name: string): Promise<void> {
  await page.getByRole("row", { name: new RegExp(name, "u") }).getByRole("link", { name }).click();
  await expect(page.getByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");
}

test.describe("Electron acceptance", () => {
  test("uses typed IPC for Scratchpad playback and exposes no Node or generic primitive", async ({ electronStudyNarrator, studyNarrator }) => {
    const { page } = electronStudyNarrator;
    await configureElectronConnection(page, studyNarrator);
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
      bridge: ["connection", "persistence", "projectPreview", "renderPlans", "renders", "scratchpad", "scriptGeneration", "speechCache", "system", "voiceCatalog"],
      hasRequire: false,
      hasProcess: false,
      frozen: true
    });

    studyNarrator.fakeSpeaches.reset();
    await page.getByRole("link", { name: "Quick Scratchpad" }).click();
    await expect(page.getByRole("heading", { name: "Quick Scratchpad" })).toBeVisible();
    await expect(page.getByLabel("Model")).toHaveValue("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await expect(page.getByLabel("Voice")).toHaveValue("af_heart");
    await expect(page.getByLabel("Voice").getByRole("option", { name: "Heart (af_heart | en-US)" })).toBeAttached();
    await expect(page.getByLabel("Voice").locator('optgroup[label="en-US"]')).toBeAttached();
    await expect(page.getByText("Recent results")).toHaveCount(0);
    await expect(page.getByText("Sent to Speaches")).toHaveCount(0);
    await expect(page.getByText("No audio loaded")).toHaveCount(0);
    await expect(page.getByText("Active signal")).toHaveCount(0);
    await page.getByLabel("Passage").fill("SQL indexes can improve database reads.");
    await page.getByRole("link", { name: "Projects" }).click();
    await page.getByRole("link", { name: "Quick Scratchpad" }).click();
    await expect(page.getByLabel("Passage")).toHaveValue("SQL indexes can improve database reads.");
    const renderButton = page.getByRole("button", { name: "Render and Play" });
    await renderButton.click();
    await expect.poll(() => studyNarrator.fakeSpeaches.getState().requests.filter(({ path }) => path === "/v1/audio/speech").length).toBe(1);
    await expect(renderButton).toBeEnabled();
    await expect(page.locator("audio")).toHaveCount(0);
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path }) => path === "/v1/audio/speech")).toHaveLength(1);
    await renderButton.click();
    await expect(renderButton).toBeEnabled();
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path }) => path === "/v1/audio/speech")).toHaveLength(1);
    await page.getByLabel("Voice").selectOption("af_sky");
    await renderButton.click();
    await expect.poll(() => studyNarrator.fakeSpeaches.getState().requests.filter(({ path }) => path === "/v1/audio/speech").length).toBe(2);
    await expect(page.getByLabel(/Audio player for/u)).toHaveCount(0);
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path }) => path === "/v1/audio/speech")).toHaveLength(2);

    await page.getByRole("link", { name: "Projects" }).click();
    await createProject(page, "Desktop global model voices");
    await page.getByLabel("Script source").fill("[speaker_narrator] Globally configured model voice.");
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(page.getByLabel("Optional model override")).toHaveCount(0);
    await expect(page.getByLabel("Voice for speaker narrator")).toHaveValue("af_heart");
    await expect(page.getByLabel("Voice for speaker narrator").getByRole("option", { name: "Heart (af_heart | en-US)" })).toBeAttached();
    await expect(page.locator("strong").filter({ hasText: "Heart — American English — af_heart" })).toHaveCount(0);
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText("All changes saved.")).toHaveCount(0);
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path }) => path === "/v1/audio/speech")).toHaveLength(2);

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
    await page.getByRole("link", { name: "System diagnostics" }).click();
    await page.getByRole("button", { name: "Run self-test" }).click();
    await expect(page.getByText("IPC", { exact: true })).toBeVisible();
    await expect(page.getByText(/Electron 43/u)).toBeVisible();
  });

  test("persists project UI state across a desktop relaunch", async ({ electronStudyNarrator }) => {
    let page = electronStudyNarrator.page;
    await continueElectronOffline(page);
    await createProject(page, "Desktop durable project");
    await expect(page.getByRole("heading", { name: "Script editor" })).toBeVisible();
    await page.getByLabel("Script source").fill("[speaker_teacher] Persist through relaunch.");
    await page.getByRole("tab", { name: "Settings" }).click();
    const lexicon = page.getByRole("region", { name: "Project lexicon" });
    await lexicon.getByLabel("Script Text").first().fill("CLI");
    await lexicon.getByLabel("Spoken Text").first().fill("C L I");
    await lexicon.getByRole("button", { name: "Add" }).click();
    await expect(lexicon.getByRole("article", { name: "Lexicon entry CLI" })).toBeVisible();
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText("All changes saved.")).toHaveCount(0);

    page = await electronStudyNarrator.relaunch();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await openProject(page, "Desktop durable project");
    await expect(page.getByLabel("Script source")).toHaveText("[speaker_teacher] Persist through relaunch.");
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(page.getByRole("region", { name: "Project lexicon" }).getByRole("article", { name: "Lexicon entry CLI" })).toBeVisible();
  });

  test("keeps one hidden current plan and reopens the latest render through typed IPC", async ({ electronStudyNarrator, studyNarrator }) => {
    let page = electronStudyNarrator.page;
    await configureElectronConnection(page, studyNarrator);
    await page.getByRole("link", { name: "Timings" }).click();
    const paragraphTiming = page.getByRole("group", { name: "Paragraph" });
    await paragraphTiming.getByLabel("Pause").selectOption("pause_short");
    await page.getByLabel("pause_short duration").fill("350 ms");
    await page.getByRole("button", { name: "Save timing" }).click();
    await expect(page.getByText("Global timing saved.")).toBeVisible();
    await page.getByRole("link", { name: "Projects" }).click();
    studyNarrator.fakeSpeaches.reset();
    await createProject(page, "Desktop current render");
    await page.getByLabel("Script source").fill("[speaker_teacher] First.\n\n[speaker_teacher] Second.");
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(page.getByLabel("Optional model override")).toHaveCount(0);
    await expect(page.getByLabel("Voice for speaker teacher")).toHaveValue("af_heart");
    await page.getByRole("tab", { name: "Render" }).click();
    await expect(page.getByRole("heading", { name: "Render and listen" })).toBeVisible();
    await page.getByRole("button", { name: "Render" }).click();
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible({ timeout: 20_000 });
    const projectId = page.url().match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/u)?.[0];
    if (!projectId) throw new Error("Project route did not contain a project ID.");
    const firstPlans = await page.evaluate(async (id) => await (window as typeof window & { studyNarrator: StudyNarratorBridge }).studyNarrator.renderPlans.list(id), projectId);
    expect(firstPlans).toHaveLength(1);
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(2);

    page = await electronStudyNarrator.relaunch();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await openProject(page, "Desktop current render");
    await page.getByRole("tab", { name: "Render" }).click();
    await expect(page.getByLabel(/Audio player for Completed project render/u)).toBeVisible();
    await expect(page.getByLabel("Saved render plans")).toHaveCount(0);

    await page.getByRole("link", { name: "Timings" }).click();
    await page.getByLabel("pause_short duration").fill("750 ms");
    await page.getByRole("button", { name: "Save timing" }).click();
    await expect(page.getByText("Global timing saved.")).toBeVisible();
    await page.getByRole("link", { name: "Projects" }).click();
    await openProject(page, "Desktop current render");
    await page.getByRole("tab", { name: "Render" }).click();
    await page.getByRole("button", { name: "Render" }).click();
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible({ timeout: 20_000 });
    const currentPlans = await page.evaluate(async (id) => await (window as typeof window & { studyNarrator: StudyNarratorBridge }).studyNarrator.renderPlans.list(id), projectId);
    expect(currentPlans).toHaveLength(1);
    expect(currentPlans[0]!.id).toBe(firstPlans[0]!.id);
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(2);
  });

  test("auto-resumes an interrupted render and saves a validated artifact through native IPC", async ({ electronStudyNarrator, studyNarrator }) => {
    let page = electronStudyNarrator.page;
    await configureElectronConnection(page, studyNarrator);
    await createProject(page, "Desktop render recovery");
    await page.getByLabel("Script source").fill("[speaker_teacher] Resume this render.");
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(page.getByLabel("Optional model override")).toHaveCount(0);
    await expect(page.getByLabel("Voice for speaker teacher")).toHaveValue("af_heart");
    await page.getByRole("tab", { name: "Render" }).click();
    studyNarrator.fakeSpeaches.setScenario("timeout");
    await page.getByRole("button", { name: "Render" }).click();
    await expect(page.getByRole("button", { name: "Rendering…" })).toBeVisible();

    studyNarrator.fakeSpeaches.setScenario("healthy");
    page = await electronStudyNarrator.relaunch();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await openProject(page, "Desktop render recovery");
    await page.getByRole("tab", { name: "Render" }).click();
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible({ timeout: 20_000 });
    const destination = resolve(electronStudyNarrator.dataDirectory, "exported-render.mp3");
    await electronStudyNarrator.application.evaluate(({ dialog }: ElectronEvaluationApi, filePath) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
    }, destination);
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await expect.poll(async () => (await stat(destination)).size).toBeGreaterThan(0);

    const detailsDestination = resolve(electronStudyNarrator.dataDirectory, "exported-render-details.zip");
    await electronStudyNarrator.application.evaluate(({ dialog }: ElectronEvaluationApi, filePath) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
    }, detailsDestination);
    await page.getByRole("button", { name: "Download Details" }).click();
    await expect.poll(async () => await stat(detailsDestination).then(({ size }) => size).catch(() => 0)).toBeGreaterThan(0);
    expect(Object.keys(unzipSync(await readFile(detailsDestination)))).toHaveLength(7);
  });

  test("edits and saves independent prompts through native typed IPC without TTS", async ({ electronStudyNarrator, studyNarrator }) => {
    const { page, application, dataDirectory } = electronStudyNarrator;
    await continueElectronOffline(page);
    studyNarrator.fakeSpeaches.reset();
    await page.getByRole("link", { name: "Prompt Kit" }).click();
    await expect(page.getByRole("heading", { name: "Script prompt kit" })).toBeVisible();
    const creationEditor = page.getByRole("textbox", { name: "Create a script prompt editor" });
    await expect(creationEditor).toContainText("# StudyNarrator Script Creation Instructions");
    await expect(page.getByText(/questions to customize this prompt are in the USER INPUT section at the end/u)).toBeVisible();
    await expect(creationEditor).toContainText("## AUTHORING RULES");
    await creationEditor.press("Meta+ArrowDown");
    await expect(creationEditor).toContainText("[PASTE SOURCE MATERIAL HERE AND/OR ATTACH RELEVANT FILES TO THE CONVERSATION.]");
    const editedCreation = "EDITED DESKTOP CREATION PROMPT";
    await creationEditor.fill(editedCreation);

    const creationDestination = resolve(dataDirectory, "desktop-creation-prompt.md");
    const updateDestination = resolve(dataDirectory, "desktop-update-prompt.md");
    await application.evaluate(({ dialog }: ElectronEvaluationApi, destinations) => {
      dialog.showSaveDialog = ({ defaultPath }) => Promise.resolve({
        canceled: false,
        filePath: defaultPath.includes("update") ? destinations.update : destinations.creation
      });
    }, { creation: creationDestination, update: updateDestination });
    await page.getByRole("button", { name: "Download creation prompt" }).click();
    await expect.poll(async () => (await stat(creationDestination)).size).toBeGreaterThan(0);
    await page.getByRole("tab", { name: "Update Prompt" }).click();
    const updateEditor = page.getByRole("textbox", { name: "Update a script prompt editor" });
    await updateEditor.press("Meta+ArrowDown");
    await expect(updateEditor).toContainText("[OPTIONAL — PROVIDE FACTS, RESEARCH, SOURCE MATERIAL, CONSTRAINTS, OR ATTACH RELEVANT FILES.]");
    await expect(page.getByText(/USER INPUT section at the end asks for the requested changes/u)).toBeVisible();
    const editedUpdate = "EDITED DESKTOP UPDATE PROMPT";
    await updateEditor.fill(editedUpdate);
    await page.getByRole("button", { name: "Download update prompt" }).click();
    await expect.poll(async () => (await stat(updateDestination)).size).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /both prompts/u })).toHaveCount(0);

    expect(await readFile(creationDestination, "utf8")).toBe(editedCreation);
    expect(await readFile(updateDestination, "utf8")).toBe(editedUpdate);
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });

  test("exposes and persists only the singleton connection settings", async ({ electronStudyNarrator, studyNarrator }) => {
    let page = electronStudyNarrator.page;
    await configureElectronConnection(page, studyNarrator);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Address")).toHaveValue(studyNarrator.fakeSpeaches.baseUrl);
    await expect(page.getByLabel("Model")).toHaveValue("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await expect(page.getByLabel("Default Voice")).toHaveValue("af_heart");
    await expect(page.getByRole("option", { name: "Heart (af_heart | en-US)" })).toBeAttached();
    await page.getByRole("link", { name: "Voices" }).click();
    await page.getByLabel("Search voice catalog").fill("en-US");
    await expect(page.getByLabel("en-US voices")).toBeVisible();
    await page.getByRole("button", { name: "Add Heart to favorites" }).click();
    await expect(page.getByLabel("Favorites voices")).toContainText("Heart");
    const script = "Electron voice audition without a player.";
    await page.getByLabel("Voice test script").fill(script);
    studyNarrator.fakeSpeaches.reset();
    await page.getByRole("button", { name: /^Test Heart/u }).click();
    await expect.poll(() => studyNarrator.fakeSpeaches.getState().requests.filter(({ path, status }) => path === "/v1/audio/speech" && status === 200).length).toBe(1);
    expect(studyNarrator.fakeSpeaches.getState().requests.find(({ path }) => path === "/v1/audio/speech")).toMatchObject({
      model: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      voice: "af_heart",
      speed: 1,
      inputLength: script.length,
      inputHash: createHash("sha256").update(script).digest("hex")
    });
    await expect(page.locator("audio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Test Heart/u })).toBeVisible({ timeout: 5_000 });

    page = await electronStudyNarrator.relaunch();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Address")).toHaveValue(studyNarrator.fakeSpeaches.baseUrl);
    await expect(page.getByLabel("Model")).toHaveValue("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await page.getByRole("link", { name: "Voices" }).click();
    await expect(page.getByLabel("Favorites voices")).toContainText("Heart");
    await expect(page.getByRole("button", { name: "Remove Heart from favorites" })).toHaveAttribute("aria-pressed", "true");
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
