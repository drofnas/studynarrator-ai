import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { continueOffline, expect, openRoute, test } from "../support/studyNarratorTest.js";

const sourceMarker = "SESSION-ONLY-SOURCE: SQL cache invalidation changes observable reads.";

test.describe("external-LLM script generation", () => {
  test("generates, copies, downloads, and inspects both local artifacts without TTS", async ({ page, request, context, studyNarrator }) => {
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
    await page.getByRole("button", { name: "Build external-LLM prompt" }).click();
    await expect(page.getByRole("heading", { name: "Instruction workbench" })).toBeVisible();
    await expect(page.getByLabel("Purpose")).toHaveValue(created.description);
    await expect(page.getByLabel("Source material")).toHaveValue(sourceMarker);
    await page.getByRole("button", { name: "Assemble prompt" }).click();
    const preview = page.getByLabel("Generated prompt preview");
    await expect(preview).toContainText("[speaker_teacher]");
    await expect(preview).toContainText("[speaker_student]");
    await expect(preview).toContainText("SQL → sequel");
    await expect(preview).toContainText(sourceMarker);

    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: studyNarrator.baseUrl });
    await page.getByRole("button", { name: "Copy prompt" }).click();
    await expect(page.getByText("Prompt copied.", { exact: false })).toBeVisible();
    expect(await page.evaluate(async () => await navigator.clipboard.readText())).toContain(sourceMarker);

    const promptDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download prompt" }).click();
    const prompt = await promptDownload;
    expect(prompt.suggestedFilename()).toBe("external-llm-handoff-external-llm-prompt.md");
    const promptPath = await prompt.path();
    const promptText = await readFile(promptPath, "utf8");
    expect(promptText).toContain(sourceMarker);
    expect(promptText).toContain("Output only the raw script.");

    const skillDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download skill package" }).click();
    const skill = await skillDownload;
    expect(skill.suggestedFilename()).toBe("external-llm-handoff-script-skill.zip");
    const skillPath = await skill.path();
    const files = unzipSync(await readFile(skillPath));
    expect(Object.keys(files).sort()).toEqual(["LEXICON_ALIASES.md", "SCRIPT_FORMAT.md", "SKILL.md", "examples/single-narrator.txt", "examples/two-speaker-study-guide.txt"]);
    const skillText = Object.values(files).map((bytes) => strFromU8(bytes)).join("\n");
    expect(skillText).toContain("[speaker_teacher]");
    expect(skillText).toContain("SQL → sequel");
    expect(skillText).not.toContain(sourceMarker);

    await page.getByLabel("Source material").fill("temporary browser-only edit");
    await page.reload();
    await expect(page.getByLabel("Source material")).toHaveValue(sourceMarker);
    expect(studyNarrator.fakeSpeaches.getState().counters["/v1/audio/speech"] ?? 0).toBe(0);
  });
});
