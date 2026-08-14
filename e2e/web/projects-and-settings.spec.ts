import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { FAKE_SPEACHES_SECONDARY_MODEL_ID, FAKE_SPEACHES_SECONDARY_VOICE_ID, type FakeSpeachesScenario } from "@studynarrator/fake-speaches";
import {
  configureConnection,
  continueOffline,
  expect,
  openRoute,
  test,
  type StudyNarratorTestApplication
} from "../support/studyNarratorTest.js";

const modelId = "speaches-ai/Kokoro-82M-v1.0-ONNX";

async function openConnectionSettings(page: Page, application: StudyNarratorTestApplication): Promise<void> {
  await configureConnection(page, application);
  await openRoute(page, application, "/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

async function createProject(page: Page, name: string, description = ""): Promise<void> {
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill(name);
  if (description) await page.getByLabel("Description").fill(description);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");
}

test.describe("Settings and connection diagnostics", () => {
  test.beforeEach(async ({ page, studyNarrator }) => {
    await openConnectionSettings(page, studyNarrator);
  });

  test("persists the singleton, normalizes /v1, stages every fake failure, and exports redacted JSON", async ({ page, studyNarrator }) => {
    await page.getByLabel("Address").fill(`${studyNarrator.fakeSpeaches.baseUrl}/v1`);
    await page.getByRole("button", { name: "Refresh catalog" }).click();
    await expect(page.getByLabel("Model")).toHaveValue(modelId);
    await expect(page.getByLabel("Default Voice")).toHaveValue("af_heart");
    const testButton = page.getByRole("button", { name: "Save and Test" });

    await testButton.click();
    await expect(page.getByText("Connection test: connected.")).toBeVisible();
    expect(studyNarrator.fakeSpeaches.getState().requests.every(({ path }) => !path.includes("/v1/v1"))).toBe(true);
    await expect(page.getByText("Signal path")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export redacted JSON" })).toHaveCount(0);
    const endpointHost = new URL(studyNarrator.fakeSpeaches.baseUrl).host.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    await expect(page.getByRole("link", { name: new RegExp(`Connected\\. ${endpointHost}\\. Manage connection\\.`, "u") })).toBeVisible();
    await expect(page.getByText(/New saved profile|Active profile|API key|Environment Speaches/u)).toHaveCount(0);

    const scenarios: ReadonlyArray<[FakeSpeachesScenario, string]> = [
      ["unauthorized", "authenticationRequired"],
      ["missing-model", "modelUnavailable"],
      ["rejected-voice", "voiceUnavailable"],
      ["empty-body", "invalidAudio"],
      ["invalid-content-type", "invalidAudio"],
      ["corrupt-audio", "invalidAudio"],
      ["timeout", "disconnected"]
    ];
    for (const [scenario, expected] of scenarios) {
      studyNarrator.fakeSpeaches.setScenario(scenario);
      await testButton.click();
      await expect(page.getByText(`Connection test: ${expected}.`)).toBeVisible();
      await expect(page.getByText("Signal path")).toBeVisible();
      await expect(page.getByRole("heading", { name: expected })).toBeVisible();
    }

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export redacted JSON" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    const exported = Buffer.concat(chunks).toString("utf8");
    expect(exported).toContain('"endpointClass": "loopback"');
    expect(exported).not.toContain("127.0.0.1");
    expect(exported).not.toContain("authorization");

    studyNarrator.fakeSpeaches.setScenario("healthy");
    await testButton.click();
    await expect(page.getByText("Connection test: connected.")).toBeVisible();
    await expect(page.getByText("Signal path")).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel("Address")).toHaveValue(studyNarrator.fakeSpeaches.baseUrl);
    await expect(page.getByLabel("Model")).toHaveValue(modelId);
    await expect(page.getByLabel("Default Voice")).toHaveValue("af_heart");
  });

  test("auditions a catalog voice without a player and persists pacing", async ({ page, studyNarrator }) => {
    await openRoute(page, studyNarrator, "/settings");
    await page.getByLabel("Search voice catalog").fill("Heart");
    await expect(page.getByRole("article").filter({ hasText: "Heart — American English — af_heart" })).toBeVisible();
    await expect(page.getByLabel("Voice test script")).toHaveValue("Welcome to StudyNarrator. This short sample lets you hear how this voice handles clear narration.");
    await expect(page.getByLabel("Strict override JSON")).toHaveCount(0);
    const script = "A precise browser voice audition.";
    await page.getByLabel("Voice test script").fill(script);
    studyNarrator.fakeSpeaches.reset();
    await page.getByRole("button", { name: /^Test Heart/u }).click();
    await expect.poll(() => studyNarrator.fakeSpeaches.getState().requests.filter(({ path, status }) => path === "/v1/audio/speech" && status === 200).length).toBe(1);
    expect(studyNarrator.fakeSpeaches.getState().requests.find(({ path }) => path === "/v1/audio/speech")).toMatchObject({
      model: modelId,
      voice: "af_heart",
      speed: 1,
      inputLength: script.length,
      inputHash: createHash("sha256").update(script).digest("hex")
    });
    await expect(page.locator("audio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Test Heart/u })).toBeVisible({ timeout: 5_000 });

    await page.getByLabel(/Default pause_medium duration/u).fill("1.25 s");
    await page.getByRole("button", { name: "Save pacing defaults" }).click();
    await expect(page.getByText("Pacing defaults saved. Existing projects were not changed.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Default pause_medium duration/u)).toHaveValue("1250 ms");
  });

  test("manages the fixed-scope global lexicon with validation and persistence", async ({ page, studyNarrator }) => {
    await openRoute(page, studyNarrator, "/settings#global-lexicon");
    const lexicon = page.getByRole("region", { name: "Global lexicon" });
    await expect(lexicon).toBeVisible();
    await expect(lexicon.getByLabel("Script Text").nth(1)).toHaveValue("API");
    await expect(lexicon.getByLabel("Spoken Text").nth(1)).toHaveValue("A P I");
    await expect(lexicon.getByText(/complete words regardless of capitalization/u)).toBeVisible();
    await expect(lexicon.getByText(/Case sensitive|Whole word|Sense ID|Notes/u)).toHaveCount(0);
    await lexicon.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("alert")).toContainText("Script Text and Spoken Text are required.");

    await lexicon.getByLabel("Script Text").first().fill("api");
    await lexicon.getByLabel("Spoken Text").first().fill("duplicate");
    await lexicon.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("alert")).toContainText("unique regardless of capitalization");
    await lexicon.getByLabel("Script Text").first().fill("CLI");
    await lexicon.getByLabel("Spoken Text").first().fill("C L I");
    await lexicon.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Global pronunciation added.")).toBeVisible();
    await page.reload();
    await expect(lexicon.getByRole("article", { name: "Global lexicon entry CLI" })).toBeVisible();

    const entry = lexicon.getByRole("article", { name: "Global lexicon entry CLI" });
    await entry.getByLabel("Spoken Text").fill("command line interface");
    await expect(entry.getByText("Saved")).toBeVisible();
    await entry.getByRole("checkbox", { name: "Enabled" }).uncheck();
    await expect(entry.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect(entry.getByLabel("Spoken Text")).toHaveValue("command line interface");
    await expect(entry.getByRole("checkbox", { name: "Enabled" })).not.toBeChecked();
    await lexicon.getByLabel("Search global lexicon").fill("not present");
    await expect(lexicon.getByText("No matching global lexicon entries.")).toBeVisible();
    await lexicon.getByLabel("Search global lexicon").fill("");
    await entry.getByRole("button", { name: "Delete" }).click();
    await expect(entry).toHaveCount(0);

    await page.route("**/api/lexicon/global", async (route) => {
      if (route.request().method() === "PUT") await route.abort();
      else await route.continue();
    });
    await lexicon.getByLabel("Script Text").first().fill("GraphQL");
    await lexicon.getByLabel("Spoken Text").first().fill("graph Q L");
    await lexicon.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(lexicon.getByLabel("Script Text").first()).toHaveValue("GraphQL");
  });
});

test.describe("Projects connected authoring", () => {
  test("defaults and persists catalog voices in bounded editor panels without requesting TTS", async ({ page, studyNarrator }) => {
    await configureConnection(page, studyNarrator);
    studyNarrator.fakeSpeaches.reset();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await createProject(page, "Automated narration", "Acceptance project");
    await expect(page.getByRole("heading", { name: "Script editor" })).toBeVisible();

    const longScript = ["[section: Start]", ...Array.from({ length: 48 }, (_value, index) => `[speaker_teacher] Welcome line ${String(index + 1)}.`), "[pause_short] Continue."].join("\n");
    await page.getByLabel("Script source").fill(longScript);
    await page.getByRole("tab", { name: "Settings" }).click();
    const voices = page.getByLabel("Voices");
    await expect(voices).toBeVisible();
    await expect(voices).toHaveValue("af_heart");
    await expect(page.getByLabel("Connection profile")).toHaveCount(0);
    await page.getByLabel("Optional model override").fill(modelId);
    await expect(voices).toHaveValue("af_heart");
    await expect(page.locator("strong").filter({ hasText: "Heart — American English — af_heart" })).toBeVisible();
    await expect(page.getByText("af_heart", { exact: true })).toBeVisible();
    await page.getByLabel("Optional model override").fill(FAKE_SPEACHES_SECONDARY_MODEL_ID);
    await expect(voices).toHaveValue(FAKE_SPEACHES_SECONDARY_VOICE_ID);
    await expect(voices.getByRole("option", { name: `Lessac — ${FAKE_SPEACHES_SECONDARY_VOICE_ID}` })).toBeAttached();
    await expect(voices.getByRole("option", { name: /Heart/u })).toHaveCount(0);
    await page.getByLabel("Optional model override").fill(modelId);
    await expect(voices).toHaveValue("af_heart");
    await voices.selectOption("af_sky");
    await expect(voices).toHaveValue("af_sky");
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/models"] ?? 0).toBe(1);
    expect(await voices.evaluate((element) => ({ tagName: element.tagName, hasManualOption: [...(element as HTMLSelectElement).options].some(({ value }) => value === "manual_voice_id") }))).toEqual({ tagName: "SELECT", hasManualOption: false });
    await page.getByRole("article").filter({ hasText: "pause_short" }).getByLabel("Duration").fill("400 ms");
    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByLabel("Dry run ordered segment table")).toContainText("Welcome line 48.");

    const scoreBody = page.getByRole("region", { name: "Narration score content" });
    const detailsLayout = await page.evaluate(() => {
      const score = document.querySelector('[aria-label="Narration score content"]');
      const scorePanel = score?.closest("section");
      if (!(score instanceof HTMLElement) || !(scorePanel instanceof HTMLElement)) throw new Error("Expected a bounded narration score panel.");
      return {
        scorePanelHeight: scorePanel.getBoundingClientRect().height,
        scoreOverflows: score.scrollHeight > score.clientHeight
      };
    });
    expect(detailsLayout.scorePanelHeight).toBeLessThanOrEqual(600);
    expect(detailsLayout.scoreOverflows).toBe(true);
    await scoreBody.evaluate((element) => { element.scrollTop = 250; });
    await expect.poll(() => scoreBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText("All changes saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Script Editor" }).click();
    await expect(page.getByLabel("Script source")).toHaveValue(longScript);
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(page.getByLabel("Connection profile")).toHaveCount(0);
    await expect(page.getByLabel("Optional model override")).toHaveValue(modelId);
    await expect(page.getByLabel("Voices")).toHaveValue("af_sky");
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/models"] ?? 0).toBe(2);
    studyNarrator.fakeSpeaches.setScenario("timeout");
    await page.reload();
    await expect(page.getByRole("button", { name: "Retry supported voices" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByLabel("Voices")).toBeDisabled();
    await expect(page.getByText("af_sky", { exact: true })).toBeVisible();
    studyNarrator.fakeSpeaches.setScenario("healthy");
    await page.getByRole("button", { name: "Retry supported voices" }).click();
    await expect(page.getByLabel("Voices")).toHaveValue("af_sky");
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/models"] ?? 0).toBe(4);
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });

  test("persists diagnostic suppression and supports complete project CRUD", async ({ page, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    await createProject(page, "Diagnostic study");
    await page.getByLabel("Script source").fill("[section Topic]\n[speaker_teacher] Second.");

    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByText("MALFORMED_SECTION_DIRECTIVE")).toBeVisible();
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText("All changes saved.")).toBeVisible();
    await page.getByRole("button", { name: "Ignore this pattern" }).click();
    await expect(page.getByRole("region", { name: "Ignored diagnostic patterns" })).toContainText("MALFORMED_SECTION_DIRECTIVE");
    await page.reload();
    await expect(page.getByRole("region", { name: "Ignored diagnostic patterns" })).toContainText("MALFORMED_SECTION_DIRECTIVE");

    await page.getByRole("button", { name: "Restore this pattern" }).click();
    await expect(page.getByText("MALFORMED_SECTION_DIRECTIVE")).toBeVisible();
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No projects yet. Create the first study guide.")).toBeVisible();
  });
});
