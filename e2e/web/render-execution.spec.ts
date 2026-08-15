import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { configureConnection, expect, openRoute, test } from "../support/studyNarratorTest.js";

test.describe("render execution", () => {
  test("renders a frozen plan, publishes the complete bundle, and restores completion after reload", async ({ page, request, studyNarrator }) => {
    await configureConnection(page, studyNarrator);
    const createdResponse = await request.post(`${studyNarrator.baseUrl}/api/projects`, { data: { name: "Render acceptance" } });
    const created = await createdResponse.json() as { id: string; name: string };
    await request.put(`${studyNarrator.baseUrl}/api/projects/${created.id}`, { data: {
      name: created.name,
      description: "End-to-end render fixture.",
      scriptSource: "[section: Opening]\n[speaker_teacher] SQL renders this sentence.\n[pause_medium]\n[speaker_teacher] Finish this render.",
      speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: "af_heart", speed: 1, gainDb: 0, roleDescription: "", sampleText: "" }],
      lexiconEntries: [{
        scope: "project", entryType: "exactTerm", displayText: "SQL", spokenText: "sequel",
        caseSensitive: false, wholeWord: true, priority: 0, enabled: true, notes: ""
      }]
    } });
    studyNarrator.fakeSpeaches.reset();

    await openRoute(page, studyNarrator, `/projects/${created.id}?tab=render`);
    await expect(page.getByRole("button", { name: "Freeze render plan" })).toBeEnabled();
    await page.getByRole("button", { name: "Freeze render plan" }).click();
    await expect(page.getByRole("button", { name: "Render this frozen plan" })).toBeVisible();
    await page.getByRole("button", { name: "Render this frozen plan" }).click();
    await expect(page.getByText(/Phase: complete/u)).toBeVisible({ timeout: 20_000 });
    const history = page.getByLabel("Saved renders");
    const disclosure = history.getByRole("button", { expanded: true }).first();
    await expect(disclosure).toBeVisible();
    await expect(page.getByRole("list", { name: "Render artifacts" }).getByRole("listitem")).toHaveCount(7);
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path, status }) => path === "/v1/audio/speech" && status === 200)).toHaveLength(2);

    await page.getByRole("button", { name: "Play completed render" }).click();
    const completedPlayer = page.getByLabel(/Audio player for Completed render/u);
    await expect(completedPlayer.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    const seek = completedPlayer.getByLabel("Seek playback");
    await seek.focus();
    await seek.press("End");
    expect(Number(await seek.inputValue())).toBeGreaterThan(0);
    const waveform = completedPlayer.getByRole("group", { name: "Playback waveform" });
    await waveform.click({ position: { x: 12, y: 20 } });
    expect(Number(await seek.inputValue())).toBeLessThan(Number(await seek.getAttribute("max")));

    const segmentRows = page.getByLabel("Ordered segment rows");
    const firstSpeech = segmentRows.getByRole("article").filter({ has: page.getByRole("button", { name: /Play segment/u }) }).first();
    await firstSpeech.getByRole("button", { name: /Play segment/u }).click();
    await expect(page.getByLabel(/Audio player for Teacher · segment/u)).toBeVisible();
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path, status }) => path === "/v1/audio/speech" && status === 200)).toHaveLength(2);

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: studyNarrator.baseUrl });
    await firstSpeech.getByRole("button", { name: "Copy readable" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("SQL renders");
    await firstSpeech.getByRole("button", { name: "Copy TTS" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("sequel renders");
    const downloadPromise = page.waitForEvent("download");
    await firstSpeech.getByRole("button", { name: "Download segment" }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/^\d{6}\.wav$/u);
    await firstSpeech.getByRole("button", { name: /Source line/u }).click();
    await expect(page.getByLabel("Script source")).toBeFocused();
    await expect(page.getByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Render" }).click();

    const renders = await request.get(`${studyNarrator.baseUrl}/api/projects/${created.id}/renders`);
    const [render] = await renders.json() as Array<{ id: string; state: string }>;
    expect(render?.state).toBe("complete");
    const artifactsResponse = await request.get(`${studyNarrator.baseUrl}/api/renders/${render!.id}/artifacts`);
    const artifacts = await artifactsResponse.json() as Array<{ id: string; type: string; fileName: string }>;
    expect(artifacts.map(({ type }) => type).sort()).toEqual(["checksums", "manifest", "mp3", "originalScript", "projectSnapshot", "readableTranscript", "ttsTranscript"].sort());
    const checksums = artifacts.find(({ type }) => type === "checksums")!;
    const checksumDownload = await request.get(`${studyNarrator.baseUrl}/api/render-artifacts/${checksums.id}`);
    expect(await checksumDownload.text()).toContain("render-acceptance.mp3");

    await page.reload();
    await expect(page.getByText(/Phase: complete/u)).toBeVisible();
    await expect(page.getByRole("list", { name: "Render artifacts" }).getByRole("listitem")).toHaveCount(7);

    const segmentResponse = await request.get(`${studyNarrator.baseUrl}/api/renders/${render!.id}/segments`);
    const reviewSegments = await segmentResponse.json() as Array<{ ordinal: number; type: string }>;
    const retainedSpeech = reviewSegments.find(({ type }) => type === "speech")!;
    await unlink(join(studyNarrator.dataDirectory, "renders", render!.id, "segments", `${String(retainedSpeech.ordinal).padStart(6, "0")}.wav`));
    const reloadedDisclosure = page.getByLabel("Saved renders").getByRole("button", { name: new RegExp(render!.id, "u") });
    await reloadedDisclosure.click();
    await reloadedDisclosure.click();
    await expect(page.getByText(/no retained synthesis media/u)).toBeVisible();
    await page.getByRole("button", { name: "Rerender this frozen plan" }).click();
    await expect(page.getByLabel("Saved renders").locator(":scope > article")).toHaveCount(2);
    await expect(page.getByLabel("Saved renders").locator(":scope > article").first().getByText(/Phase: complete/u)).toBeVisible({ timeout: 20_000 });
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path, status }) => path === "/v1/audio/speech" && status === 200)).toHaveLength(2);
  });

  test("reports synthesis failure, retries from cache-safe state, and cancels an active request", async ({ page, request, studyNarrator }) => {
    await configureConnection(page, studyNarrator);
    const created = await (await request.post(`${studyNarrator.baseUrl}/api/projects`, { data: { name: "Render recovery" } })).json() as { id: string; name: string };
    await request.put(`${studyNarrator.baseUrl}/api/projects/${created.id}`, { data: {
      name: created.name, description: "Failure fixture.", scriptSource: "[speaker_teacher] Recover this render.",
      speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: "af_heart", speed: 1, gainDb: 0, roleDescription: "", sampleText: "" }],
      lexiconEntries: []
    } });
    await openRoute(page, studyNarrator, `/projects/${created.id}?tab=render`);
    await page.getByRole("button", { name: "Freeze render plan" }).click();
    await expect(page.getByRole("button", { name: "Render this frozen plan" })).toBeVisible();

    studyNarrator.fakeSpeaches.setScenario("rejected-voice");
    await page.getByRole("button", { name: "Render this frozen plan" }).click();
    await expect(page.getByText(/Phase: failed/u)).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "RENDER_SYNTHESIS_FAILED" })).toBeVisible();
    studyNarrator.fakeSpeaches.setScenario("healthy");
    await page.getByRole("button", { name: "Retry render" }).click();
    await expect(page.getByText(/Phase: complete/u)).toBeVisible({ timeout: 20_000 });

    studyNarrator.fakeSpeaches.setScenario("timeout");
    await request.delete(`${studyNarrator.baseUrl}/api/speech-cache`);
    await page.getByRole("button", { name: "Render this frozen plan" }).click();
    await expect(page.getByText(/Phase: synthesizing/u)).toBeVisible();
    await page.getByRole("button", { name: "Cancel render" }).dispatchEvent("click");
    await expect(page.getByText(/Phase: canceled/u)).toBeVisible();
  });
});
