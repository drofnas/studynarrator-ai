import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import type { FakeSpeachesScenario } from "@studynarrator/fake-speaches";
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
  await openRoute(page, application, "/settings/general");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
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
    await expect(page.getByRole("option", { name: "Heart (af_heart | en-US)" })).toBeAttached();
    const testButton = page.getByRole("button", { name: "Save and Test" });

    await testButton.click();
    await expect(page.getByText("Connection test: connected.")).toBeVisible();
    expect(studyNarrator.fakeSpeaches.getState().requests.every(({ path }) => !path.includes("/v1/v1"))).toBe(true);
    await expect(page.getByText("Signal path")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export redacted JSON" })).toHaveCount(0);
    const endpointHost = new URL(studyNarrator.fakeSpeaches.baseUrl).host.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    await expect(page.getByRole("link", { name: new RegExp(`Connected\\. ${endpointHost}\\. Manage connection\\.`, "u") })).toBeVisible();

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
      await expect(page.getByText(`Connection test: ${expected}.`)).toBeVisible({
        timeout: scenario === "timeout" ? 20_000 : 10_000
      });
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

  test("groups, favorites, and auditions catalog voices while persisting settings", async ({ page, studyNarrator }) => {
    await page.route("**/api/connection/speech-catalog", async (route) => {
      const response = await route.fetch();
      const catalog = await response.json() as { models: Array<{ voices: Array<{ voiceId: string; name: string | null }> }> };
      await route.fulfill({ response, json: {
        ...catalog,
        models: catalog.models.map((model) => ({ ...model, voices: model.voices.map((voice) => ({ ...voice, name: voice.voiceId.toUpperCase() })) }))
      } });
    });
    await page.getByRole("button", { name: "Refresh catalog" }).click();
    await expect(page.getByRole("option", { name: "Heart (af_heart | en-US)" })).toBeAttached();
    await openRoute(page, studyNarrator, "/settings/voices");
    await expect(page.getByText("Default model")).toBeVisible();
    const heartVoice = page.getByRole("article").filter({ hasText: "af_heart" });
    await expect(heartVoice.getByText("Heart", { exact: true })).toBeVisible();
    await expect(heartVoice.getByText("af_heart | en-US", { exact: true })).toBeVisible();
    await expect(heartVoice).not.toContainText(/\b(?:enabled|disabled)\b/u);
    await expect.poll(() => page.locator("section[aria-label$=' voices']").evaluateAll((groups) => groups.slice(0, 2).map((group) => group.getAttribute("aria-label")))).toEqual(["en-US voices", "en-GB voices"]);
    const voiceResults = page.getByRole("region", { name: "Voice catalog results" });
    await expect(voiceResults).toBeVisible();
    expect(await voiceResults.evaluate((element) => ({ maxHeight: getComputedStyle(element).maxHeight, overflowY: getComputedStyle(element).overflowY }))).toEqual({ maxHeight: "none", overflowY: "visible" });
    await openRoute(page, studyNarrator, "/settings/voices");
    await page.getByLabel("Search voice catalog").fill("en-US");
    await expect(page.getByLabel("en-US voices")).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "af_heart" })).toBeVisible();
    await expect(page.getByLabel("Voice test script")).toHaveValue("This short sample lets you hear how this voice handles clear narration.");
    await expect(page.getByLabel("Strict override JSON")).toHaveCount(0);
    await page.getByRole("button", { name: "Add Heart to favorites" }).click();
    await expect(page.getByLabel("Favorites voices")).toContainText("Heart");
    await expect(page.getByRole("button", { name: "Remove Heart from favorites" })).toHaveAttribute("aria-pressed", "true");
    await openRoute(page, studyNarrator, "/settings/general");
    await expect(page.getByLabel("Default Voice").locator('optgroup[label="Favorites"]')).toBeAttached();
    await expect.poll(() => page.getByLabel("Default Voice").locator("optgroup").evaluateAll((groups) => groups.map((group) => group.getAttribute("label")))).toEqual(["Favorites", "en-US"]);
    await openRoute(page, studyNarrator, "/settings/voices");
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

    await openRoute(page, studyNarrator, "/settings/timings");
    await page.getByLabel("pause_medium duration").fill("1.25 s");
    await page.getByRole("button", { name: "Save timing" }).click();
    await expect(page.getByText("Global timing saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("pause_medium duration")).toHaveValue("1250 ms");
    await openRoute(page, studyNarrator, "/settings/voices");
    await expect(page.getByLabel("Favorites voices")).toContainText("Heart");
    await expect(page.getByRole("button", { name: "Remove Heart from favorites" })).toHaveAttribute("aria-pressed", "true");
  });

  test("manages the fixed-scope global lexicon with validation and persistence", async ({ page, studyNarrator }) => {
    await openRoute(page, studyNarrator, "/settings/lexicon");
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
    await expect(lexicon.getByRole("article", { name: "Lexicon entry CLI" })).toBeVisible();

    const entry = lexicon.getByRole("article", { name: "Lexicon entry CLI" });
    const textAutosave = page.waitForResponse((response) => response.url().endsWith("/api/lexicon/global") && response.request().method() === "PUT" && response.ok());
    await entry.getByLabel("Spoken Text").fill("command line interface");
    await textAutosave;
    await expect(entry.getByText(/Saving…|Saved/u)).toHaveCount(0);
    const enablementAutosave = page.waitForResponse((response) => response.url().endsWith("/api/lexicon/global") && response.request().method() === "PUT" && response.ok());
    await entry.getByRole("checkbox", { name: "Enabled" }).uncheck();
    await enablementAutosave;
    await expect(entry.getByText(/Saving…|Saved/u)).toHaveCount(0);
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

    const longScript = [
      "[section: Start]",
      ...Array.from({ length: 48 }, (_value, index) => `[speaker_teacher] Welcome line ${String(index + 1)}.`),
      "[speaker_student] I am ready.",
      "[speaker_narrator] Let us begin.",
      "[speaker_coach] Watch the spacing.",
      "[speaker_guest] Test long labels and controls.",
      "[speaker_facilitator] Confirm the table scrolls locally.",
      "[pause_short] Continue."
    ].join("\n");
    await page.getByLabel("Script source").fill(longScript);
    await page.getByRole("tab", { name: "Settings" }).click();
    const speakers = page.getByRole("region", { name: "Project speakers" });
    const voices = page.getByLabel("Voice for speaker teacher");
    await expect(speakers.getByRole("columnheader")).toHaveText(["Name", "Voice", "Speed", "Gain dB"]);
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.getByRole("button", { name: "Open navigation" });
    const closeNavigation = page.getByRole("button", { name: "Close navigation" });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => closeNavigation.evaluate((element) => element.getBoundingClientRect().right <= 0)).toBe(true);
    expect(await speakers.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const speakerScroll = await speakers.evaluate((element) => {
      const table = element.querySelector("table");
      if (!table) throw new Error("Expected the speaker table inside its scroll region.");
      element.scrollLeft = 0;
      const start = element.scrollLeft;
      const leftEdgeVisible = table.getBoundingClientRect().left >= element.getBoundingClientRect().left - 1;
      element.scrollLeft = element.scrollWidth;
      const end = element.scrollLeft;
      const rightEdgeVisible = table.getBoundingClientRect().right <= element.getBoundingClientRect().right + 1;
      return { start, end, leftEdgeVisible, rightEdgeVisible };
    });
    expect(speakerScroll.start).toBe(0);
    expect(speakerScroll.end).toBeGreaterThan(0);
    expect(speakerScroll.leftEdgeVisible).toBe(true);
    expect(speakerScroll.rightEdgeVisible).toBe(true);
    await speakers.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(speakers).toBeFocused();
    expect(await speakers.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 3;
    })).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByText("Project Timings")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Copy to/u })).toHaveCount(0);
    await expect(voices).toBeVisible();
    await expect(voices).toHaveValue("af_heart");
    await expect(voices.getByRole("option", { name: "Heart (af_heart | en-US)" })).toBeAttached();
    await expect(voices.locator('optgroup[label="en-US"]')).toBeAttached();
    await expect(page.getByLabel("Optional model override")).toHaveCount(0);
    await expect(voices).toHaveValue("af_heart");
    await expect(page.locator("strong").filter({ hasText: "Heart — American English — af_heart" })).toHaveCount(0);
    await voices.selectOption("af_sky");
    await expect(voices).toHaveValue("af_sky");
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/models"] ?? 0).toBe(1);
    expect(await voices.evaluate((element) => ({ tagName: element.tagName, hasManualOption: [...(element as HTMLSelectElement).options].some(({ value }) => value === "manual_voice_id") }))).toEqual({ tagName: "SELECT", hasManualOption: false });
    const lexicon = page.getByRole("region", { name: "Project lexicon" });
    await expect(lexicon.getByLabel("Search project lexicon")).toHaveCount(0);
    await lexicon.getByLabel("Script Text").first().fill("GraphQL");
    await lexicon.getByLabel("Spoken Text").first().fill("graph Q L");
    await lexicon.getByRole("button", { name: "Add" }).click();
    await expect(lexicon.getByRole("article", { name: "Lexicon entry GraphQL" })).toBeVisible();
    await expect(lexicon.getByLabel("Search project lexicon")).toBeVisible();
    await expect(lexicon.getByText(/Type|Sense ID|Notes|Case sensitive|Whole word/u)).toHaveCount(0);
    await expect(page.getByLabel("Pronunciation test")).toHaveCount(0);
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
    await expect(page.getByText("All changes saved.")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Script Editor" }).click();
    await expect(page.getByLabel("Script source")).toHaveValue(longScript);
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(page.getByLabel("Optional model override")).toHaveCount(0);
    await expect(page.getByLabel("Voice for speaker teacher")).toHaveValue("af_sky");
    await expect(page.getByRole("region", { name: "Project lexicon" }).getByRole("article", { name: "Lexicon entry GraphQL" })).toBeVisible();
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/models"] ?? 0).toBe(2);
    studyNarrator.fakeSpeaches.setScenario("timeout");
    await page.reload();
    await expect(page.getByRole("button", { name: "Retry supported voices" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByLabel("Voice for speaker teacher")).toBeDisabled();
    await expect(page.getByText(/Speaches server is unavailable/u)).toBeVisible();
    await expect(page.getByText("af_sky", { exact: true })).toHaveCount(0);
    studyNarrator.fakeSpeaches.setScenario("healthy");
    await page.getByRole("button", { name: "Retry supported voices" }).click();
    await expect(page.getByLabel("Voice for speaker teacher")).toHaveValue("af_sky");
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
    await expect(page.getByText("All changes saved.")).toHaveCount(0);
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
