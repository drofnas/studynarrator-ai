import { configureConnection, expect, test } from "../support/studyNarratorTest.js";

test.describe("Frozen render plans", () => {
  test("creates and reopens immutable plans without synthesizing speech", async ({ page, studyNarrator }) => {
    await configureConnection(page, studyNarrator);
    await page.getByRole("link", { name: "Timings" }).click();
    const paragraphTiming = page.getByRole("group", { name: "Paragraph" });
    expect(await paragraphTiming.getByRole("option").allTextContents()).toEqual(["None", "pause_short", "pause_medium", "pause_long"]);
    await paragraphTiming.getByLabel("Pause").selectOption("pause_medium");
    await page.getByLabel("pause_medium duration").fill("600 ms");
    const speakerChangeTiming = page.getByRole("group", { name: "Speaker change" });
    await speakerChangeTiming.getByLabel("Pause").selectOption("pause_short");
    const sectionTiming = page.getByRole("group", { name: "Section" });
    await sectionTiming.getByLabel("Pause").selectOption("pause_long");
    await page.getByRole("button", { name: "Save timing" }).click();
    await expect(page.getByText("Global timing saved.")).toBeVisible();
    await page.getByRole("link", { name: "Projects" }).click();
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
    await expect(page.getByLabel("Optional model override")).toHaveCount(0);
    await expect(page.getByLabel("Voice for speaker teacher").first()).toHaveValue("af_heart");

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
    await expect(table).toContainText("S Q L one.");
    await expect(table).toContainText("miss");
    await expect(page.getByText("Matches current project").first()).toBeVisible();
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);

    await page.getByRole("link", { name: "Timings" }).click();
    await page.getByLabel("pause_medium duration").fill("900 ms");
    await page.getByRole("button", { name: "Save timing" }).click();
    await expect(page.getByText("Global timing saved.")).toBeVisible();
    await page.getByRole("link", { name: "Projects" }).click();
    await page.getByRole("row", { name: /Frozen plan acceptance/u }).getByRole("link", { name: "Open" }).click();
    await page.getByRole("tab", { name: "Render" }).click();
    await page.getByLabel("Saved render plans").getByRole("button").click();
    await expect(table).toContainText("600 ms");

    await freeze.click();
    await expect(table).toContainText("900 ms");
    const savedPlans = page.getByLabel("Saved render plans");
    await expect(savedPlans.getByRole("button")).toHaveCount(2);
    await savedPlans.getByRole("button").nth(1).click();
    await expect(table).toContainText("600 ms");
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);

    await page.reload();
    await expect(savedPlans.getByRole("button")).toHaveCount(2);
    await savedPlans.getByRole("button").nth(1).click();
    await expect(page.getByRole("table", { name: "Frozen render plan ordered entries" })).toContainText("600 ms");
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });
});
