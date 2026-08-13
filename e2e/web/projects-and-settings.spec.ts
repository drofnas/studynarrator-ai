import type { Page } from "@playwright/test";
import type { FakeSpeachesScenario } from "@studynarrator/fake-speaches";
import {
  continueOffline,
  expect,
  openRoute,
  test,
  type StudyNarratorTestApplication
} from "../support/studyNarratorTest.js";

const modelId = "speaches-ai/Kokoro-82M-v1.0-ONNX";

async function createSavedProfile(page: Page, application: StudyNarratorTestApplication): Promise<void> {
  await openRoute(page, application, "/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "New saved profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Playwright Speaches");
  await page.getByLabel("Endpoint root or /v1").fill(`${application.fakeSpeaches.baseUrl}/v1`);
  await page.getByLabel("Model ID").fill(modelId);
  await page.getByLabel("Default voice ID").fill("af_heart");
  await page.getByLabel("Timeout (seconds)").fill("1");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page.getByText("Playwright Speaches saved.")).toBeVisible();
}

test.describe("Settings and connection diagnostics", () => {
  test.beforeEach(async ({ page, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
  });

  test("manages profiles, normalizes /v1, stages every fake failure, and exports redacted JSON", async ({ page, studyNarrator }) => {
    await createSavedProfile(page, studyNarrator);
    const testButton = page.getByRole("button", { name: "Test Connection" });

    await testButton.click();
    await expect(page.getByText("Connection test: connected.")).toBeVisible();
    expect(studyNarrator.fakeSpeaches.getState().requests.every(({ path }) => !path.includes("/v1/v1"))).toBe(true);
    await expect(page.getByRole("heading", { name: "connected" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Connected" })).toBeVisible();

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
    }

    studyNarrator.fakeSpeaches.setScenario("healthy");
    await testButton.click();
    await expect(page.getByText("Connection test: connected.")).toBeVisible();
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

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "Playwright Speaches" })).toHaveCount(0);
  });

  test("searches and strictly replaces catalog overrides and persists pacing", async ({ page, studyNarrator }) => {
    await openRoute(page, studyNarrator, "/settings");
    await page.getByLabel("Search voice catalog").fill("Heart");
    await expect(page.getByRole("article").filter({ hasText: "Heart — American English — af_heart" })).toBeVisible();

    await page.getByLabel("Strict override JSON").fill(JSON.stringify({
      schemaVersion: 1,
      modelId,
      entries: [{ voiceId: "af_heart", label: "Heart renamed", enabled: false }, { voiceId: "manual_voice", label: "Manual catalog voice", enabled: true }]
    }));
    await page.getByRole("button", { name: "Replace model overrides" }).click();
    await expect(page.getByText(`Catalog overrides replaced for ${modelId}.`)).toBeVisible();
    await page.getByLabel("Search voice catalog").fill("Manual catalog");
    await expect(page.getByRole("article").filter({ hasText: "Manual catalog voice" })).toBeVisible();

    await page.getByLabel(/Default pause_medium duration/u).fill("1.25 s");
    await page.getByRole("button", { name: "Save pacing defaults" }).click();
    await expect(page.getByText("Pacing defaults saved. Existing projects were not changed.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Default pause_medium duration/u)).toHaveValue("1250 ms");
  });
});

test.describe("Projects connected authoring", () => {
  test("autosaves configuration, reloads catalog/manual voices, and never requests TTS", async ({ page, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    studyNarrator.fakeSpeaches.reset();
    await page.getByLabel("Project name").fill("Automated narration");
    await page.getByLabel("Description").first().fill("Acceptance project");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: "Script editor" })).toBeVisible();

    await page.getByLabel("Connection profile").selectOption("environment-speaches");
    await page.getByLabel("Optional model override").fill(modelId);
    await page.getByLabel("Script source").fill("[section: Start]\n[speaker_teacher] Welcome.\n[pause_short] Continue.");
    await expect(page.getByLabel("Voice catalog or manual ID")).toBeVisible();
    await page.getByLabel("Voice catalog or manual ID").fill("af_heart");
    await expect(page.locator("strong").filter({ hasText: "Heart — American English — af_heart" })).toBeVisible();
    await expect(page.getByText("af_heart", { exact: true })).toBeVisible();
    await page.getByLabel("Voice catalog or manual ID").fill("manual_voice_id");
    await expect(page.getByText("Manual voice ID")).toBeVisible();
    await expect(page.getByText("manual_voice_id", { exact: true })).toBeVisible();
    await page.getByRole("article").filter({ hasText: "pause_short" }).getByLabel("Duration").fill("400 ms");
    await expect(page.getByLabel("Dry run ordered segment table")).toContainText("Welcome.");

    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText("All changes saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Script source")).toHaveValue("[section: Start]\n[speaker_teacher] Welcome.\n[pause_short] Continue.");
    await expect(page.getByLabel("Connection profile")).toHaveValue("environment-speaches");
    await expect(page.getByLabel("Optional model override")).toHaveValue(modelId);
    await expect(page.getByLabel("Voice catalog or manual ID")).toHaveValue("manual_voice_id");
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });
});

test.describe("locked environment settings", () => {
  test.use({ studyNarratorEnvironment: { STUDYNARRATOR_LOCK_SPEACHES_SETTINGS: "true" } });

  test("keeps the environment profile active and its managed fields disabled", async ({ page, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    await openRoute(page, studyNarrator, "/settings");
    await expect(page.getByText(/Managed by environment/u)).toBeVisible();
    await expect(page.getByLabel("Endpoint root or /v1")).toBeDisabled();
    await expect(page.getByLabel("Active profile")).toBeDisabled();

    await page.getByRole("button", { name: "New saved profile" }).click();
    await expect(page.getByLabel("Active profile")).toHaveCount(0);
    await page.getByRole("button", { name: "Environment Speaches" }).click();
    await expect(page.getByLabel("Active profile")).toHaveValue("environment-speaches");
  });
});
