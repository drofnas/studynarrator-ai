import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { continueOffline, expect, openRoute, test } from "../support/studyNarratorTest.js";

const sourceMarker = "SESSION-ONLY-SOURCE: SQL cache invalidation changes observable reads.";

test.describe("external-LLM script generation", () => {
  test("copies, downloads, and inspects creation, update, and reusable prompt-kit artifacts without TTS", async ({ page, request, context, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    const createdResponse = await request.post(`${studyNarrator.baseUrl}/api/projects`, {
      data: { name: "External LLM handoff", description: "Teach cache invalidation without inventing facts." }
    });
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
      description: created.description,
      scriptSource: sourceMarker,
      connectionProfileId: null,
      modelId: null,
      speakerMappings: [
        { speakerId: "teacher", displayName: "Teacher", voiceId: null, speed: 1, gainDb: 0, roleDescription: "Explains the source precisely.", sampleText: "" },
        { speakerId: "student", displayName: "Student", voiceId: null, speed: 1, gainDb: 0, roleDescription: "Asks focused questions.", sampleText: "" }
      ],
      pausePresets: created.pausePresets,
      transitionPauses: created.transitionPauses,
      lexiconEntries: [{ scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel" }]
    } });
    expect(replacedResponse.ok()).toBe(true);
    studyNarrator.fakeSpeaches.reset();

    await openRoute(page, studyNarrator, `/projects/${created.id}`);
    await page.getByRole("button", { name: "Open script prompt kit" }).click();
    await expect(page.getByRole("heading", { name: "Script prompt kit" })).toBeVisible();
    const creationPreview = page.getByLabel("Create a script prompt preview");
    await expect(creationPreview).toContainText("KNOWLEDGE TO GATHER AND TEACH");
    await expect(creationPreview).toContainText("[speaker_teacher]");
    await expect(creationPreview).toContainText("[speaker_student]");
    await expect(creationPreview).toContainText("SQL → sequel");
    await expect(creationPreview).toContainText("{{display text|new_sense_id}}");
    await expect(creationPreview).not.toContainText(sourceMarker);

    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: studyNarrator.baseUrl });
    await page.getByRole("button", { name: "Copy creation prompt" }).click();
    await expect(page.getByText("Create a script prompt copied.", { exact: false })).toBeVisible();
    expect(await page.evaluate(async () => await navigator.clipboard.readText())).toContain("KNOWLEDGE TO GATHER AND TEACH");

    const creationDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download creation prompt" }).click();
    const creation = await creationDownload;
    expect(creation.suggestedFilename()).toBe("external-llm-handoff-creation-prompt.md");
    const creationText = await readFile(await creation.path(), "utf8");
    expect(creationText).toContain("KNOWLEDGE TO GATHER AND TEACH");
    expect(creationText).not.toContain(sourceMarker);

    await page.getByRole("button", { name: /Update a script/u }).click();
    const updatePreview = page.getByLabel("Update a script prompt preview");
    await expect(updatePreview).toContainText("SCRIPT AND CHANGE REQUEST");
    await expect(updatePreview).toContainText("Return the complete revised script, not a patch");
    await expect(updatePreview).not.toContainText(sourceMarker);
    const updateDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download update prompt" }).click();
    const update = await updateDownload;
    expect(update.suggestedFilename()).toBe("external-llm-handoff-update-prompt.md");
    const updateText = await readFile(await update.path(), "utf8");
    expect(updateText).toContain("[PASTE THE CURRENT SCRIPT AND DESCRIBE THE CHANGES TO MAKE HERE.]");
    expect(updateText).not.toContain(sourceMarker);

    const skillDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download both prompts as a kit" }).click();
    const skill = await skillDownload;
    expect(skill.suggestedFilename()).toBe("external-llm-handoff-script-skill.zip");
    const skillPath = await skill.path();
    const files = unzipSync(await readFile(skillPath));
    expect(Object.keys(files).sort()).toEqual(["CREATION_PROMPT.md", "LEXICON_ALIASES.md", "SCRIPT_FORMAT.md", "SKILL.md", "UPDATE_PROMPT.md", "examples/single-narrator.txt", "examples/two-speaker-study-guide.txt"]);
    const skillText = Object.values(files).map((bytes) => strFromU8(bytes)).join("\n");
    expect(skillText).toContain("[speaker_teacher]");
    expect(skillText).toContain("SQL → sequel");
    expect(skillText).not.toContain(sourceMarker);

    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });
});
