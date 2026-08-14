import { configureConnection, expect, test } from "../support/studyNarratorTest.js";

test.describe("Frozen render plans", () => {
  test("creates and reopens immutable plans without synthesizing speech", async ({ page, studyNarrator }) => {
    await configureConnection(page, studyNarrator);
    studyNarrator.fakeSpeaches.reset();
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Project name").fill("Frozen plan acceptance");
    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByLabel("Script source").fill([
      "[section: Opening]",
      "[speaker_teacher] SQL one.",
      "",
      "[speaker_teacher] Same speaker paragraph.",
      "[speaker_student] Student reply.",
      "[section: Closing]",
      "[speaker_teacher] Final section.",
      "[pause_short]",
      "[speaker_teacher] After explicit pause."
    ].join("\n"));
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(page.getByLabel("Connection profile")).toHaveCount(0);
    await page.getByLabel("Optional model override").fill("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await expect(page.getByLabel("Voices").first()).toHaveValue("af_heart");

    await page.getByLabel("Paragraph transition mode").selectOption("duration");
    await page.getByLabel("Paragraph transition duration (ms)").fill("600");
    await page.getByLabel("Speaker change transition mode").selectOption("preset");
    await page.getByLabel("Speaker change transition preset").selectOption("pause_short");
    await page.getByLabel("Section transition mode").selectOption("duration");
    await page.getByLabel("Section transition duration (ms)").fill("1500");

    await page.getByRole("tab", { name: "Render" }).click();
    const freeze = page.getByRole("button", { name: "Freeze render plan" });
    await expect(freeze).toBeEnabled();
    await freeze.click();
    await expect(page.getByText(/Frozen render plan [0-9a-f-]+\. No speech was synthesized\./u)).toBeVisible();
    const table = page.getByRole("table", { name: "Frozen render plan ordered entries" });
    await expect.poll(() => table.evaluate((element) => ({
      maxHeight: getComputedStyle(element).maxHeight,
      overflowY: getComputedStyle(element).overflowY,
    }))).toEqual({ maxHeight: "600px", overflowY: "auto" });
    await expect(table).toContainText("automatic · paragraph");
    await expect(table).toContainText("automatic · speakerChange");
    await expect(table).toContainText("automatic · section");
    await expect(table).toContainText("explicit · explicit");
    await expect(table).toContainText("600 ms");
    await expect(table).toContainText("SQL one.");
    await expect(table).toContainText("miss");
    await expect(page.getByText("Matches current project").first()).toBeVisible();
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);

    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByLabel("Paragraph transition duration (ms)").fill("900");
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText("All changes saved.")).toBeVisible();
    await page.getByRole("tab", { name: "Render" }).click();
    await expect(page.getByText("Frozen from earlier project").first()).toBeVisible();
    await expect(table).toContainText("600 ms");

    await freeze.click();
    await expect(table).toContainText("900 ms");
    const savedPlans = page.getByLabel("Saved render plans");
    await expect(savedPlans.getByRole("button")).toHaveCount(2);
    await savedPlans.getByRole("button").nth(1).click();
    await expect(table).toContainText("600 ms");
    await expect(page.getByText("Frozen from earlier project").first()).toBeVisible();
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);

    await page.reload();
    await expect(savedPlans.getByRole("button")).toHaveCount(2);
    await savedPlans.getByRole("button").nth(1).click();
    await expect(page.getByRole("table", { name: "Frozen render plan ordered entries" })).toContainText("600 ms");
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });
});
