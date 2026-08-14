import { createHash } from "node:crypto";
import { continueOffline, expect, openRoute, test } from "../support/studyNarratorTest.js";

const original = "SQL indexes can improve database reads.";
const transformed = "sequel indexes can improve database reads.";

test.describe("Quick Scratchpad", () => {
  test("transforms, synthesizes, recovers from failures, and never mutates projects", async ({ page, request, studyNarrator }) => {
    await continueOffline(page, studyNarrator);

    const createdResponse = await request.post(`${studyNarrator.baseUrl}/api/projects`, {
      data: { name: "Scratchpad boundary project", description: "Must remain unchanged." }
    });
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json() as { id: string };
    const beforeResponse = await request.get(`${studyNarrator.baseUrl}/api/projects/${created.id}`);
    expect(beforeResponse.ok()).toBe(true);
    const projectBefore = await beforeResponse.json() as unknown;

    const lexiconResponse = await request.put(`${studyNarrator.baseUrl}/api/lexicon/global`, {
      data: [{
        id: "global-sql",
        scope: "global",
        entryType: "exactTerm",
        displayText: "SQL",
        spokenText: "sequel",
        caseSensitive: true,
        wholeWord: true,
        priority: 0,
        enabled: true,
        notes: ""
      }]
    });
    expect(lexiconResponse.ok()).toBe(true);
    studyNarrator.fakeSpeaches.reset();

    await openRoute(page, studyNarrator, "/scratchpad");
    await expect(page.getByRole("heading", { name: "Quick Scratchpad" })).toBeVisible();
    await expect(page.getByLabel("Connection profile")).toHaveValue(/.+/u);
    await expect(page.getByLabel("Model")).toHaveValue("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await expect(page.getByLabel("Voice")).toHaveValue("af_heart");
    await expect(page.getByText("Recent results")).toHaveCount(0);
    await expect(page.getByText("Sent to Speaches")).toHaveCount(0);
    await expect(page.getByText("No audio loaded")).toHaveCount(0);
    await expect(page.getByLabel(/Audio player/u)).toHaveCount(0);
    await page.getByLabel("Speed").fill("1.25");
    await page.getByLabel("Passage").fill(original);
    await page.reload();
    await expect(page.getByLabel("Passage")).toHaveValue(original);
    await expect(page.getByLabel("Model")).toHaveValue("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await expect(page.getByLabel("Voice")).toHaveValue("af_heart");
    await page.getByLabel("Speed").fill("1.25");
    await page.getByLabel("Apply global lexicon").check();

    await page.getByRole("button", { name: "Synthesize passage" }).click();
    const player = page.getByLabel(/Audio player for/u);
    await expect(player).toBeVisible();
    await expect(player.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await player.getByRole("button", { name: "Play", exact: true }).click();
    await expect(player.getByRole("status")).toHaveText("Playing");
    await expect(player.getByRole("status")).toHaveText("Playback complete", { timeout: 5_000 });

    const successfulRequests = () => studyNarrator.fakeSpeaches.getState().requests.filter(({ path, status }) => path === "/v1/audio/speech" && status === 200);
    expect(successfulRequests()).toHaveLength(1);
    expect(successfulRequests()[0]).toMatchObject({
      model: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      voice: "af_heart",
      speed: 1.25,
      inputLength: transformed.length,
      inputHash: createHash("sha256").update(transformed).digest("hex")
    });
    expect(JSON.stringify(studyNarrator.fakeSpeaches.getState())).not.toContain(original);

    await page.getByLabel("Voice").selectOption("af_sky");
    await page.getByRole("button", { name: "Synthesize passage" }).click();
    await expect.poll(() => successfulRequests().length).toBe(2);
    expect(successfulRequests()[1]).toMatchObject({ voice: "af_sky", speed: 1.25 });
    await expect(page.getByLabel(/Audio player/u)).toHaveCount(1);
    const cacheAfterReplacement = await request.get(`${studyNarrator.baseUrl}/api/speech-cache`);
    expect(cacheAfterReplacement.ok()).toBe(true);
    expect(await cacheAfterReplacement.json()).toMatchObject({ entryCount: 1 });

    studyNarrator.fakeSpeaches.setScenario("rejected-voice");
    await page.getByLabel("Passage").fill("A distinct rejected passage.");
    await page.getByRole("button", { name: "Synthesize passage" }).click();
    await expect(page.getByRole("alert")).toContainText("rejected the selected model or voice");
    await expect(page.getByLabel("Passage")).toHaveValue("A distinct rejected passage.");
    await expect(page.getByLabel(/Audio player/u)).toHaveCount(1);
    studyNarrator.fakeSpeaches.setScenario("healthy");
    await page.getByRole("button", { name: "Retry synthesis" }).click();
    await expect.poll(() => successfulRequests().length).toBe(3);
    await expect(page.getByLabel(/Audio player/u)).toHaveCount(1);

    studyNarrator.fakeSpeaches.setScenario("timeout");
    await page.getByLabel("Passage").fill("A distinct timeout passage.");
    await page.getByRole("button", { name: "Synthesize passage" }).click();
    await expect(page.getByRole("alert")).toContainText("service is unavailable", { timeout: 5_000 });
    await expect(page.getByLabel("Passage")).toHaveValue("A distinct timeout passage.");
    await expect(page.getByLabel(/Audio player/u)).toHaveCount(1);
    studyNarrator.fakeSpeaches.setScenario("healthy");
    await page.getByRole("button", { name: "Retry synthesis" }).click();
    await expect.poll(() => successfulRequests().length).toBe(4);
    await expect(page.getByLabel(/Audio player/u)).toHaveCount(1);
    const finalCache = await request.get(`${studyNarrator.baseUrl}/api/speech-cache`);
    expect(finalCache.ok()).toBe(true);
    expect(await finalCache.json()).toMatchObject({ entryCount: 1 });

    const afterResponse = await request.get(`${studyNarrator.baseUrl}/api/projects/${created.id}`);
    expect(afterResponse.ok()).toBe(true);
    expect(await afterResponse.json()).toEqual(projectBefore);
  });
});
