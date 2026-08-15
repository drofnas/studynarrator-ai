import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configureConnection, expect, openRoute, test } from "../support/studyNarratorTest.js";

const originalScript = "[speaker_teacher] Cache this exact sentence.";
const changedScript = "[speaker_teacher] Cache this changed sentence.";

test.describe("project preview cache", () => {
  test("accounts for keys, cross-workflow reuse, corruption replacement, and system-only cleanup", async ({ page, request, studyNarrator }) => {
    await configureConnection(page, studyNarrator);
    const createdResponse = await request.post(`${studyNarrator.baseUrl}/api/projects`, { data: { name: "Preview cache fixture" } });
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json() as {
      id: string;
      name: string;
      description: string;
      pausePresets: unknown[];
      transitionPauses: unknown;
    };
    const replacedResponse = await request.put(`${studyNarrator.baseUrl}/api/projects/${created.id}`, { data: {
      name: created.name,
      description: "Isolated Playwright request-accounting fixture.",
      scriptSource: originalScript,
      speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: "af_heart", speed: 1, gainDb: 0, roleDescription: "", sampleText: "" }],
      pausePresets: created.pausePresets,
      transitionPauses: created.transitionPauses,
      lexiconEntries: []
    } });
    expect(replacedResponse.ok()).toBe(true);
    studyNarrator.fakeSpeaches.reset();

    const speechRequests = () => studyNarrator.fakeSpeaches.getState().requests.filter(({ path, status }) => path === "/v1/audio/speech" && status === 200);
    const result = page.getByRole("region", { name: "Project preview result" });
    const previewFirstSegment = async () => {
      const completed = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/api/projects/${created.id}/preview`));
      await page.getByRole("button", { name: /^Preview$/u }).first().click();
      expect((await completed).ok()).toBe(true);
      await expect(result).toBeVisible();
    };

    await openRoute(page, studyNarrator, `/projects/${created.id}?tab=details`);
    await expect(page.getByRole("heading", { name: "Narration score" })).toBeVisible();
    await previewFirstSegment();
    await expect(result.getByText("Cache miss")).toBeVisible();
    expect(speechRequests()).toHaveLength(1);

    await previewFirstSegment();
    await expect(result.getByText("Cache hit")).toBeVisible();
    expect(speechRequests()).toHaveLength(1);

    await page.getByRole("tab", { name: "Script Editor" }).click();
    await page.getByLabel("Script source").fill(changedScript);
    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByLabel("Dry run ordered segment table")).toContainText("Cache this changed sentence.");
    await previewFirstSegment();
    await expect(result.getByText("Cache miss")).toBeVisible();
    expect(speechRequests()).toHaveLength(2);

    await page.getByRole("tab", { name: "Script Editor" }).click();
    await page.getByLabel("Script source").fill(originalScript);
    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByLabel("Dry run ordered segment table")).toContainText("Cache this exact sentence.");
    await previewFirstSegment();
    await expect(result.getByText("Cache hit")).toBeVisible();
    expect(speechRequests()).toHaveLength(2);

    await page.getByRole("tab", { name: "Script Editor" }).click();
    await page.getByLabel("Script source").fill(`${originalScript}\n[pause_short]`);
    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByLabel("Dry run ordered segment table")).toContainText("pause_short");
    await previewFirstSegment();
    await expect(result.getByText("Cache hit")).toBeVisible();
    expect(speechRequests()).toHaveLength(2);

    await openRoute(page, studyNarrator, "/scratchpad");
    await page.getByLabel("Passage").fill("Cache this exact sentence.");
    await page.getByRole("button", { name: "Synthesize passage" }).click();
    await expect(page.getByLabel(/Audio player for/u)).toBeVisible();
    expect(speechRequests()).toHaveLength(2);

    await openRoute(page, studyNarrator, `/projects/${created.id}?tab=settings`);
    await expect(page.getByLabel("Voices")).toHaveValue("af_heart");
    await page.getByLabel("Voices").selectOption("af_sky");
    await page.getByRole("tab", { name: "Details" }).click();
    await previewFirstSegment();
    await expect(result.getByText("Cache miss")).toBeVisible();
    expect(speechRequests()).toHaveLength(3);
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByLabel("Voices").selectOption("af_heart");
    await page.getByRole("tab", { name: "Details" }).click();
    await previewFirstSegment();
    await expect(result.getByText("Cache hit")).toBeVisible();
    expect(speechRequests()).toHaveLength(3);

    await page.getByRole("tab", { name: "Details" }).click();
    await previewFirstSegment();
    const cacheKey = (await result.locator("footer code").innerText()).trim();
    expect(cacheKey).toMatch(/^[a-f0-9]{64}$/u);
    const cacheFile = join(studyNarrator.dataDirectory, "cache", "speech", cacheKey.slice(0, 2), `${cacheKey}.wav`);
    await writeFile(cacheFile, "isolated corrupt fixture");
    await previewFirstSegment();
    await expect(result.getByText("Cache miss")).toBeVisible();
    expect(speechRequests()).toHaveLength(4);

    await expect(page.getByRole("button", { name: "Clear this cached entry" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear project cache" })).toHaveCount(0);
    await expect(page.getByLabel("Pronunciation test")).toHaveCount(0);

    await openRoute(page, studyNarrator, "/settings");
    await expect(page.getByRole("heading", { name: "Speech cache" })).toBeVisible();
    await expect(page.getByText(/Clear them here when you want every future preview/u)).toBeVisible();
    await expect(page.getByText(/entries/u).first()).toBeVisible();
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Clear all cached speech" }).click();
    await expect(page.getByText(/Cleared \d+ cached speech/u)).toBeVisible();

    await openRoute(page, studyNarrator, `/projects/${created.id}?tab=details`);
    await previewFirstSegment();
    expect(speechRequests()).toHaveLength(5);
    await expect(page.getByRole("button", { name: "Clear project cache" })).toHaveCount(0);
  });
});
