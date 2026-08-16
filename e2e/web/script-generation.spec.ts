import { readFile } from "node:fs/promises";
import { continueOffline, expect, test } from "../support/studyNarratorTest.js";

test.describe("external-LLM script generation", () => {
  test("edits, copies, and downloads independent full-width prompts without TTS", async ({ page, request, context, studyNarrator }) => {
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
        caseSensitive: false,
        wholeWord: true,
        priority: 0,
        enabled: true,
        notes: ""
      }]
    });
    expect(lexiconResponse.ok()).toBe(true);
    studyNarrator.fakeSpeaches.reset();

    await page.getByRole("link", { name: "Prompt Kit" }).click();
    await expect(page.getByRole("heading", { name: "Script prompt kit" })).toBeVisible();
    const createTab = page.getByRole("tab", { name: /Create a script/u });
    const updateTab = page.getByRole("tab", { name: /Update a script/u });
    await expect(createTab).toHaveAttribute("aria-selected", "true");
    const creationEditor = page.getByRole("textbox", { name: "Create a script prompt editor" });
    await expect(creationEditor).toContainText("KNOWLEDGE TO GATHER AND TEACH");
    await expect(creationEditor).toContainText("AUTHORING GOALS");

    const [createBox, updateBox, tabListBox, panelBox] = await Promise.all([
      createTab.boundingBox(), updateTab.boundingBox(), page.getByRole("tablist", { name: "Choose a prompt template" }).boundingBox(), page.getByRole("tabpanel").boundingBox()
    ]);
    if (!createBox || !updateBox || !tabListBox || !panelBox) throw new Error("Expected Prompt Kit layout boxes.");
    expect(Math.abs(createBox.y - updateBox.y)).toBeLessThan(1);
    expect(Math.abs(createBox.width - updateBox.width)).toBeLessThan(1);
    expect(Math.abs(tabListBox.width - panelBox.width)).toBeLessThan(1);
    const editorLayout = await page.getByRole("tabpanel").evaluate((panel) => {
      const editor = panel.querySelector(".cm-editor");
      const scroller = panel.querySelector(".cm-scroller");
      if (!(editor instanceof HTMLElement) || !(scroller instanceof HTMLElement)) throw new Error("Expected CodeMirror layout elements.");
      return {
        availableWidth: panel.clientWidth,
        editorWidth: editor.getBoundingClientRect().width,
        editorMaxHeight: getComputedStyle(editor).maxHeight,
        scrollerMaxHeight: getComputedStyle(scroller).maxHeight,
        scrollerOverflowY: getComputedStyle(scroller).overflowY
      };
    });
    expect(editorLayout.editorWidth).toBeGreaterThanOrEqual(editorLayout.availableWidth - 42);
    expect(editorLayout.editorMaxHeight).toBe("none");
    expect(editorLayout.scrollerMaxHeight).toBe("none");
    expect(editorLayout.scrollerOverflowY).toBe("visible");
    await expect(page.getByRole("link", { name: "View Projects" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /both prompts/u })).toHaveCount(0);

    const editedCreation = "EDITED CREATION PROMPT";
    await creationEditor.fill(editedCreation);

    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: studyNarrator.baseUrl });
    await page.getByRole("button", { name: "Copy creation prompt" }).click();
    await expect(page.getByText("Create a script prompt copied.", { exact: false })).toBeVisible();
    expect(await page.evaluate(async () => await navigator.clipboard.readText())).toBe(editedCreation);

    const creationDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download creation prompt" }).click();
    const creation = await creationDownload;
    expect(creation.suggestedFilename()).toBe("studynarrator-creation-prompt.md");
    const creationText = await readFile(await creation.path(), "utf8");
    expect(creationText).toBe(editedCreation);

    await updateTab.click();
    const updateEditor = page.getByRole("textbox", { name: "Update a script prompt editor" });
    await expect(updateEditor).toContainText("SCRIPT AND CHANGE REQUEST");
    await expect(updateEditor).toContainText("Return the complete revised script, not a patch");
    const editedUpdate = "EDITED UPDATE PROMPT";
    await updateEditor.fill(editedUpdate);
    const updateDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download update prompt" }).click();
    const update = await updateDownload;
    expect(update.suggestedFilename()).toBe("studynarrator-update-prompt.md");
    const updateText = await readFile(await update.path(), "utf8");
    expect(updateText).toBe(editedUpdate);
    await createTab.click();
    await expect(page.getByRole("textbox", { name: "Create a script prompt editor" })).toHaveText(editedCreation);

    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });
});
