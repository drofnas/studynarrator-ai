import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import type { Page } from "@playwright/test";
import type { StudyNarratorBridge } from "@studynarrator/shared-types";
import { FAKE_SPEACHES_SECONDARY_MODEL_ID, FAKE_SPEACHES_SECONDARY_VOICE_ID } from "@studynarrator/fake-speaches";
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
  await page.getByRole("row", { name: new RegExp(name, "u") }).getByRole("link", { name: "Open" }).click();
  await expect(page.getByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");
}

test.describe("Electron acceptance", () => {
  test("uses typed IPC for Scratchpad playback and exposes no Node or generic primitive", async ({ electronStudyNarrator, studyNarrator }) => {
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
      bridge: ["connections", "persistence", "projectPreview", "renderPlans", "renders", "scratchpad", "scriptGeneration", "speechCache", "system", "voiceCatalog"],
      hasRequire: false,
      hasProcess: false,
      frozen: true
    });

    studyNarrator.fakeSpeaches.reset();
    await page.getByRole("link", { name: "Quick Scratchpad" }).click();
    await expect(page.getByRole("heading", { name: "Quick Scratchpad" })).toBeVisible();
    await expect(page.getByLabel("Model")).toHaveValue("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await expect(page.getByLabel("Voice")).toHaveValue("af_heart");
    await expect(page.getByText("Recent results")).toHaveCount(0);
    await expect(page.getByText("Sent to Speaches")).toHaveCount(0);
    await expect(page.getByText("No audio loaded")).toHaveCount(0);
    await page.getByLabel("Passage").fill("SQL indexes can improve database reads.");
    await page.getByRole("link", { name: "Projects" }).click();
    await page.getByRole("link", { name: "Quick Scratchpad" }).click();
    await expect(page.getByLabel("Passage")).toHaveValue("SQL indexes can improve database reads.");
    await page.getByRole("button", { name: "Synthesize passage" }).click();
    const player = page.getByLabel(/Audio player for/u);
    await expect(player).toBeVisible();
    await expect(player.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await player.getByRole("button", { name: "Play", exact: true }).click();
    await expect(player.getByRole("status")).toHaveText("Playing");
    await expect(player.getByRole("status")).toHaveText("Playback complete", { timeout: 5_000 });
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path }) => path === "/v1/audio/speech")).toHaveLength(1);
    await page.getByLabel("Voice").selectOption("af_sky");
    await page.getByRole("button", { name: "Synthesize passage" }).click();
    await expect(page.getByLabel(/Audio player for/u)).toHaveCount(1);
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path }) => path === "/v1/audio/speech")).toHaveLength(2);

    await page.getByRole("link", { name: "Projects" }).click();
    await createProject(page, "Desktop model voices");
    await page.getByLabel("Script source").fill("[speaker_narrator] Model scoped voice.");
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByLabel("Connection profile").selectOption("environment-speaches");
    await page.getByLabel("Optional model override").fill(FAKE_SPEACHES_SECONDARY_MODEL_ID);
    await expect(page.getByLabel("Voices")).toHaveValue(FAKE_SPEACHES_SECONDARY_VOICE_ID);
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText("All changes saved.")).toBeVisible();
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path }) => path === "/v1/audio/speech")).toHaveLength(2);

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
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
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText("All changes saved.")).toBeVisible();

    page = await electronStudyNarrator.relaunch();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await openProject(page, "Desktop durable project");
    await expect(page.getByLabel("Script source")).toHaveValue("[speaker_teacher] Persist through relaunch.");
  });

  test("freezes and reopens immutable plans through typed IPC without TTS", async ({ electronStudyNarrator, studyNarrator }) => {
    let page = electronStudyNarrator.page;
    await continueElectronOffline(page);
    studyNarrator.fakeSpeaches.reset();
    await createProject(page, "Desktop frozen plan");
    await page.getByLabel("Script source").fill("[speaker_teacher] First.\n\n[speaker_teacher] Second.");
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByLabel("Connection profile").selectOption("environment-speaches");
    await page.getByLabel("Optional model override").fill("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await expect(page.getByLabel("Voices")).toHaveValue("af_heart");
    await page.getByLabel("Paragraph transition mode").selectOption("duration");
    await page.getByLabel("Paragraph transition duration (ms)").fill("350");
    await page.getByRole("tab", { name: "Render" }).click();
    await page.getByRole("button", { name: "Freeze render plan" }).click();
    await expect(page.getByRole("table", { name: "Frozen render plan ordered entries" })).toContainText("350 ms");
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);

    page = await electronStudyNarrator.relaunch();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await openProject(page, "Desktop frozen plan");
    await page.getByRole("tab", { name: "Render" }).click();
    const savedPlans = page.getByLabel("Saved render plans");
    await expect(savedPlans.getByRole("button")).toHaveCount(1);
    await savedPlans.getByRole("button").click();
    const table = page.getByRole("table", { name: "Frozen render plan ordered entries" });
    await expect(table).toContainText("350 ms");

    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByLabel("Paragraph transition duration (ms)").fill("750");
    await page.getByRole("button", { name: "Save now" }).click();
    await page.getByRole("tab", { name: "Render" }).click();
    await expect(page.getByText("Frozen from earlier project").first()).toBeVisible();
    await page.getByRole("button", { name: "Freeze render plan" }).click();
    await expect(table).toContainText("750 ms");
    await expect(savedPlans.getByRole("button")).toHaveCount(2);
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });

  test("auto-resumes an interrupted render and saves a validated artifact through native IPC", async ({ electronStudyNarrator, studyNarrator }) => {
    let page = electronStudyNarrator.page;
    await continueElectronOffline(page);
    await createProject(page, "Desktop render recovery");
    await page.getByLabel("Script source").fill("[speaker_teacher] Resume this render.");
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByLabel("Connection profile").selectOption("environment-speaches");
    await page.getByLabel("Optional model override").fill("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await expect(page.getByLabel("Voices")).toHaveValue("af_heart");
    await page.getByRole("tab", { name: "Render" }).click();
    await page.getByRole("button", { name: "Freeze render plan" }).click();
    studyNarrator.fakeSpeaches.setScenario("timeout");
    await page.getByRole("button", { name: "Render this frozen plan" }).click();
    await expect(page.getByText(/Phase: synthesizing/u)).toBeVisible();

    studyNarrator.fakeSpeaches.setScenario("healthy");
    page = await electronStudyNarrator.relaunch();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await openProject(page, "Desktop render recovery");
    await page.getByRole("tab", { name: "Render" }).click();
    await expect(page.getByText(/Phase: complete/u)).toBeVisible({ timeout: 20_000 });
    const mp3Row = page.getByRole("list", { name: "Render artifacts" }).getByRole("listitem").filter({ hasText: "mp3" });
    await expect(mp3Row).toBeVisible();
    const destination = resolve(electronStudyNarrator.dataDirectory, "exported-render.mp3");
    await electronStudyNarrator.application.evaluate(({ dialog }: ElectronEvaluationApi, filePath) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
    }, destination);
    await mp3Row.getByRole("button", { name: "Save As" }).click();
    await expect.poll(async () => (await stat(destination)).size).toBeGreaterThan(0);

    const segmentRow = page.getByLabel("Ordered segment rows").getByRole("article").filter({ has: page.getByRole("button", { name: /Play segment/u }) }).first();
    await segmentRow.getByRole("button", { name: /Play segment/u }).click();
    const segmentPlayer = page.getByLabel(/Audio player for Teacher · segment/u);
    await expect(segmentPlayer).toBeVisible();
    await expect.poll(async () => await segmentPlayer.locator("audio").getAttribute("src")).toMatch(/^studynarrator-media:\/\/segment\//u);
    const segmentDestination = resolve(electronStudyNarrator.dataDirectory, "exported-segment.wav");
    await electronStudyNarrator.application.evaluate(({ dialog }: ElectronEvaluationApi, filePath) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath });
    }, segmentDestination);
    await segmentRow.getByRole("button", { name: "Save segment" }).click();
    await expect.poll(async () => (await stat(segmentDestination)).size).toBeGreaterThan(0);
  });

  test("saves creation, update, and reusable prompt-kit artifacts through native typed IPC without TTS", async ({ electronStudyNarrator, studyNarrator }) => {
    const { page, application, dataDirectory } = electronStudyNarrator;
    await continueElectronOffline(page);
    studyNarrator.fakeSpeaches.reset();
    await page.getByRole("link", { name: "Prompt Kit" }).click();
    await expect(page.getByRole("heading", { name: "Script prompt kit" })).toBeVisible();
    const creationPreview = page.getByLabel("Create a script prompt preview");
    await expect(creationPreview).toContainText("KNOWLEDGE TO GATHER AND TEACH");
    await expect(creationPreview).toContainText("[speaker_narrator]");
    await expect(creationPreview).toContainText("[pause_medium]");

    const creationDestination = resolve(dataDirectory, "desktop-creation-prompt.md");
    const updateDestination = resolve(dataDirectory, "desktop-update-prompt.md");
    const skillDestination = resolve(dataDirectory, "desktop-skill.zip");
    await application.evaluate(({ dialog }: ElectronEvaluationApi, destinations) => {
      dialog.showSaveDialog = ({ defaultPath }) => Promise.resolve({
        canceled: false,
        filePath: defaultPath.endsWith(".zip") ? destinations.skill : defaultPath.includes("update") ? destinations.update : destinations.creation
      });
    }, { creation: creationDestination, update: updateDestination, skill: skillDestination });
    await page.getByRole("button", { name: "Save creation prompt" }).click();
    await expect.poll(async () => (await stat(creationDestination)).size).toBeGreaterThan(0);
    await page.getByRole("button", { name: /Update a script/u }).click();
    await expect(page.getByLabel("Update a script prompt preview")).toContainText("SCRIPT AND CHANGE REQUEST");
    await page.getByRole("button", { name: "Save update prompt" }).click();
    await expect.poll(async () => (await stat(updateDestination)).size).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Save both prompts as a kit" }).click();
    await expect.poll(async () => (await stat(skillDestination)).size).toBeGreaterThan(0);

    expect(await readFile(creationDestination, "utf8")).toContain("KNOWLEDGE TO GATHER AND TEACH");
    expect(await readFile(updateDestination, "utf8")).toContain("SCRIPT AND CHANGE REQUEST");
    const files = unzipSync(await readFile(skillDestination));
    expect(Object.keys(files).sort()).toEqual(["CREATION_PROMPT.md", "LEXICON_ALIASES.md", "SCRIPT_FORMAT.md", "SKILL.md", "UPDATE_PROMPT.md", "examples/single-narrator.txt"]);
    expect(Object.values(files).map((bytes) => strFromU8(bytes)).join("\n")).toContain("[speaker_narrator]");
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });

  test("clears one-shot credential input and never stores plaintext", async ({ electronStudyNarrator, studyNarrator }) => {
    const { page, application, dataDirectory } = electronStudyNarrator;
    await continueElectronOffline(page);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
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
