import { continueOffline, expect, openRoute, test } from "../support/studyNarratorTest.js";

test.describe("Script Lab acceptance", () => {
  test.beforeEach(async ({ page, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    await openRoute(page, studyNarrator, "/script-lab");
    await expect(page.getByRole("heading", { name: "Script Lab" })).toBeVisible();
  });

  test("parses, transforms, paces, warns, and preserves source", async ({ page }) => {
    const source = "[section: Topic]\n[speaker_teacher] Read resume.\n\nSecond paragraph.\n[pause_short]";
    await page.getByLabel("Script source").fill(source);
    await page.getByLabel("Display text").fill("resume");
    await page.getByLabel("Spoken text").fill("résumé");
    await page.getByRole("button", { name: "Add entry" }).click();
    await page.getByRole("button", { name: "Analyze" }).click();

    await expect(page.getByLabel("Discovery summary")).toContainText("1Speakers");
    await expect(page.getByRole("table", { name: "Ordered canonical nodes" })).toContainText("Read resume.");
    await expect(page.getByRole("table", { name: "Paragraph pacing preview" })).toBeVisible();
    await page.getByRole("tab", { name: "Source" }).click();
    await expect(page.getByLabel("Original source")).toHaveText(source);
    await page.getByRole("tab", { name: "TTS transcript" }).click();
    await expect(page.getByRole("tabpanel", { name: "TTS transcript" })).toContainText("Read résumé.");
    await expect(page.getByLabel("Script source")).toHaveValue(source);
  });

  test("announces validation failures and restores ignored warning patterns", async ({ page }) => {
    await page.getByLabel("Script source").fill("[speaker_Teacher] First.\n[speaker_teacher] Second.");
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByRole("heading", { name: "Warnings (1)" })).toBeVisible();
    await page.getByRole("button", { name: "Ignore this pattern" }).click();
    await expect(page.getByRole("heading", { name: "Ignored diagnostic patterns (1)" })).toBeVisible();
    await page.getByRole("button", { name: "Restore this pattern" }).click();
    await expect(page.getByRole("heading", { name: "Warnings (1)" })).toBeVisible();

    await page.getByRole("button", { name: "Edit as JSON" }).click();
    await page.getByLabel("Lexicon entries JSON").fill("not-json");
    await page.getByRole("button", { name: "Save JSON" }).click();
    await expect(page.getByRole("alert")).toContainText("JSON could not be saved");
  });
});

test.describe("Persistence Lab acceptance", () => {
  test.beforeEach(async ({ page, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    await openRoute(page, studyNarrator, "/persistence-lab");
    await expect(page.getByRole("heading", { name: "Persistence Lab" })).toBeVisible();
    await expect(page.getByText("Reloaded durable state from SQLite.")).toBeVisible();
  });

  test("validates, creates, atomically saves, reloads, and deletes a project", async ({ page }) => {
    await page.getByLabel("New project name").fill("Persistent study");
    await page.getByLabel("Description").first().fill("Cross-layer acceptance");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText("Project created with an independent copy of the current pacing defaults.")).toBeVisible();

    await page.getByLabel("Exact script source").fill("[speaker_teacher] Durable source.");
    await page.getByLabel("Speaker mappings JSON").fill("not-json");
    await page.getByRole("button", { name: "Save project" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid JSON syntax");
    await page.getByLabel("Speaker mappings JSON").fill("[]");
    await page.getByRole("button", { name: "Save project" }).click();
    await expect(page.getByText("Project aggregate saved atomically.")).toBeVisible();

    await page.getByRole("button", { name: "Reload from database" }).click();
    await expect(page.getByLabel("Exact script source")).toHaveValue("[speaker_teacher] Durable source.");
    await page.getByRole("button", { name: "Delete project…" }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByText("Project and its owned records were deleted.")).toBeVisible();
    await expect(page.getByText("No projects in this database.")).toBeVisible();
  });

  test("persists installation defaults and JSON collections", async ({ page }) => {
    await page.getByLabel("Paragraph duration (ms)").fill("975");
    await page.getByRole("button", { name: "Save system defaults" }).click();
    await expect(page.getByText("System pacing defaults saved. Existing projects were not changed.")).toBeVisible();

    await page.getByLabel("Global lexicon JSON").fill(JSON.stringify([{
      scope: "global", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel",
      caseSensitive: true, wholeWord: true, priority: 0, enabled: true, notes: ""
    }]));
    await page.getByRole("button", { name: "Replace global lexicon" }).click();
    await expect(page.getByText("Global lexicon replaced atomically.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Paragraph duration (ms)")).toHaveValue("975");
    await expect(page.getByLabel("Global lexicon JSON")).toContainText("sequel");
  });
});
