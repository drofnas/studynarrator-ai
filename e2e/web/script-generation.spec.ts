import { readFile } from "node:fs/promises";
import { continueOffline, expect, test } from "../support/studyNarratorTest.js";

test.describe("external-LLM script generation", () => {
  test("edits, copies, and downloads independent full-width prompts without TTS", async ({
    page,
    request,
    context,
    studyNarrator,
  }) => {
    await continueOffline(page, studyNarrator);
    const projectsResponse = await request.get(
      `${studyNarrator.baseUrl}/api/projects`,
    );
    expect(await projectsResponse.json()).toEqual([]);
    const lexiconResponse = await request.put(
      `${studyNarrator.baseUrl}/api/lexicon/custom`,
      {
        data: [
          {
            id: "global-sql",
            scope: "global",
            entryType: "exactTerm",
            displayText: "SQL",
            spokenText: "sequel",
            caseSensitive: false,
            wholeWord: true,
            priority: 0,
            enabled: true,
            notes: "",
          },
        ],
      },
    );
    expect(lexiconResponse.ok()).toBe(true);
    studyNarrator.fakeSpeaches.reset();

    await page.getByRole("link", { name: "Prompt Kit" }).click();
    await expect(
      page.getByRole("heading", { name: "Script prompt kit" }),
    ).toBeVisible();
    const createTab = page.getByRole("tab", { name: "Create Prompt" });
    const updateTab = page.getByRole("tab", { name: "Update Prompt" });
    await expect(createTab).toHaveAttribute("aria-selected", "true");
    const creationEditor = page.getByRole("textbox", {
      name: "Create a script prompt editor",
    });
    await expect(creationEditor).toContainText(
      "# StudyNarrator Script Creation Instructions",
    );
    await expect(
      page.getByText(
        /questions to customize this prompt are in the USER INPUT section at the end/u,
      ),
    ).toBeVisible();

    const tabList = page.getByRole("tablist", {
      name: "Choose a prompt template",
    });
    const promptActions = page.getByRole("group", { name: "Prompt actions" });
    const promptBar = tabList.locator("..");
    const [createBox, updateBox, actionsBox, barBox, panelBox] =
      await Promise.all([
        createTab.boundingBox(),
        updateTab.boundingBox(),
        promptActions.boundingBox(),
        promptBar.boundingBox(),
        page.getByRole("tabpanel").boundingBox(),
      ]);
    if (!createBox || !updateBox || !actionsBox || !barBox || !panelBox)
      throw new Error("Expected Prompt Kit layout boxes.");
    expect(Math.abs(createBox.y - updateBox.y)).toBeLessThan(1);
    expect(createBox.width).toBeGreaterThanOrEqual(150);
    expect(updateBox.width).toBeGreaterThanOrEqual(150);
    expect(Math.abs(createBox.x + createBox.width - updateBox.x)).toBeLessThan(
      1,
    );
    expect(updateBox.x + updateBox.width).toBeLessThanOrEqual(actionsBox.x + 1);
    expect(Math.abs(barBox.width - panelBox.width)).toBeLessThan(1);
    await expect(
      page
        .getByRole("tabpanel")
        .getByRole("button", { name: /Copy|Download/u }),
    ).toHaveCount(0);
    const editorLayout = await page.getByRole("tabpanel").evaluate((panel) => {
      const editor = panel.querySelector(".cm-editor");
      const scroller = panel.querySelector(".cm-scroller");
      if (
        !(editor instanceof HTMLElement) ||
        !(scroller instanceof HTMLElement)
      )
        throw new Error("Expected CodeMirror layout elements.");
      return {
        availableWidth: panel.clientWidth,
        editorWidth: editor.getBoundingClientRect().width,
        editorMaxHeight: getComputedStyle(editor).maxHeight,
        scrollerMaxHeight: getComputedStyle(scroller).maxHeight,
        scrollerOverflowY: getComputedStyle(scroller).overflowY,
      };
    });
    expect(editorLayout.editorWidth).toBeGreaterThanOrEqual(
      editorLayout.availableWidth - 42,
    );
    expect(editorLayout.editorMaxHeight).toBe("none");
    expect(editorLayout.scrollerMaxHeight).toBe("none");
    expect(editorLayout.scrollerOverflowY).toBe("visible");
    await expect(page.getByRole("link", { name: "View Projects" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: /both prompts/u }),
    ).toHaveCount(0);

    await creationEditor.evaluate((el) => el.scrollIntoView({ block: "end" }));
    await expect(creationEditor).toContainText(
      "[PASTE SOURCE MATERIAL HERE AND/OR ATTACH RELEVANT FILES TO THE CONVERSATION.]",
    );
    const editedCreation = "EDITED CREATION PROMPT";
    await creationEditor.fill(editedCreation);

    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: studyNarrator.baseUrl,
    });
    await page.getByRole("button", { name: "Copy creation prompt" }).click();
    await expect(
      page.getByText("Create a script prompt copied.", { exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => await navigator.clipboard.readText()),
    ).toBe(editedCreation);

    const creationDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download creation prompt" })
      .click();
    const creation = await creationDownload;
    expect(creation.suggestedFilename()).toBe(
      "studynarrator-creation-prompt.md",
    );
    const creationText = await readFile(await creation.path(), "utf8");
    expect(creationText).toBe(editedCreation);

    await updateTab.click();
    const updateEditor = page.getByRole("textbox", {
      name: "Update a script prompt editor",
    });
    await expect(updateEditor).toContainText(
      "# StudyNarrator Script Update Instructions",
    );
    await expect(
      page.getByText(
        /USER INPUT section at the end asks for the requested changes/u,
      ),
    ).toBeVisible();
    await updateEditor.evaluate((el) => el.scrollIntoView({ block: "end" }));
    await expect(updateEditor).toContainText(
      "[OPTIONAL — PROVIDE FACTS, RESEARCH, SOURCE MATERIAL, CONSTRAINTS, OR ATTACH RELEVANT FILES.]",
    );
    const editedUpdate = "EDITED UPDATE PROMPT";
    await updateEditor.fill(editedUpdate);
    const updateDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download update prompt" }).click();
    const update = await updateDownload;
    expect(update.suggestedFilename()).toBe("studynarrator-update-prompt.md");
    const updateText = await readFile(await update.path(), "utf8");
    expect(updateText).toBe(editedUpdate);
    await createTab.click();
    await expect(
      page.getByRole("textbox", { name: "Create a script prompt editor" }),
    ).toHaveText(editedCreation);

    await creationEditor.fill(
      Array.from(
        { length: 120 },
        (_value, index) => `PROMPT LINE ${String(index + 1)}`,
      ).join("\n"),
    );
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect
      .poll(() =>
        promptBar.evaluate((element) =>
          Math.round(element.getBoundingClientRect().top),
        ),
      )
      .toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect
      .poll(() =>
        promptBar.evaluate((element) =>
          Math.round(element.getBoundingClientRect().top),
        ),
      )
      .toBe(58);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    expect(
      studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0,
    ).toBe(0);
  });
});
