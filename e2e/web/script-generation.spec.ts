import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { continueOffline, expect, test } from "../support/studyNarratorTest.js";

test.describe("external-LLM script generation", () => {
  test("copies, downloads, and inspects creation, update, and reusable prompt-kit artifacts without TTS", async ({ page, request, context, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    const projectsResponse = await request.get(`${studyNarrator.baseUrl}/api/projects`);
    expect(await projectsResponse.json()).toEqual([]);
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

    await page.getByRole("link", { name: "Script prompt kit" }).click();
    await expect(page.getByRole("heading", { name: "Script prompt kit" })).toBeVisible();
    const creationPreview = page.getByLabel("Create a script prompt preview");
    await expect(creationPreview).toContainText("KNOWLEDGE TO GATHER AND TEACH");
    await expect(creationPreview).toContainText("[speaker_narrator]");
    await expect(creationPreview).toContainText("[pause_medium]");
    await expect(creationPreview).toContainText("SQL → sequel");
    await expect(creationPreview).toContainText("{{display text|new_sense_id}}");

    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: studyNarrator.baseUrl });
    await page.getByRole("button", { name: "Copy creation prompt" }).click();
    await expect(page.getByText("Create a script prompt copied.", { exact: false })).toBeVisible();
    expect(await page.evaluate(async () => await navigator.clipboard.readText())).toContain("KNOWLEDGE TO GATHER AND TEACH");

    const creationDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download creation prompt" }).click();
    const creation = await creationDownload;
    expect(creation.suggestedFilename()).toBe("studynarrator-creation-prompt.md");
    const creationText = await readFile(await creation.path(), "utf8");
    expect(creationText).toContain("KNOWLEDGE TO GATHER AND TEACH");

    await page.getByRole("button", { name: /Update a script/u }).click();
    const updatePreview = page.getByLabel("Update a script prompt preview");
    await expect(updatePreview).toContainText("SCRIPT AND CHANGE REQUEST");
    await expect(updatePreview).toContainText("Return the complete revised script, not a patch");
    const updateDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download update prompt" }).click();
    const update = await updateDownload;
    expect(update.suggestedFilename()).toBe("studynarrator-update-prompt.md");
    const updateText = await readFile(await update.path(), "utf8");
    expect(updateText).toContain("[PASTE THE CURRENT SCRIPT AND DESCRIBE THE CHANGES TO MAKE HERE.]");

    const skillDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download both prompts as a kit" }).click();
    const skill = await skillDownload;
    expect(skill.suggestedFilename()).toBe("studynarrator-script-skill.zip");
    const skillPath = await skill.path();
    const files = unzipSync(await readFile(skillPath));
    expect(Object.keys(files).sort()).toEqual(["CREATION_PROMPT.md", "LEXICON_ALIASES.md", "SCRIPT_FORMAT.md", "SKILL.md", "UPDATE_PROMPT.md", "examples/single-narrator.txt"]);
    const skillText = Object.values(files).map((bytes) => strFromU8(bytes)).join("\n");
    expect(skillText).toContain("[speaker_narrator]");
    expect(skillText).toContain("SQL → sequel");

    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });
});
