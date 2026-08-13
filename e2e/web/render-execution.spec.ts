import { continueOffline, expect, openRoute, test } from "../support/studyNarratorTest.js";

test.describe("render execution", () => {
  test("renders a frozen plan, publishes the complete bundle, and restores completion after reload", async ({ page, request, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    const createdResponse = await request.post(`${studyNarrator.baseUrl}/api/projects`, { data: { name: "Render acceptance" } });
    const created = await createdResponse.json() as { id: string; name: string; pausePresets: unknown[]; transitionPauses: unknown };
    await request.put(`${studyNarrator.baseUrl}/api/projects/${created.id}`, { data: {
      name: created.name,
      description: "End-to-end render fixture.",
      scriptSource: "[section: Opening]\n[speaker_teacher] Render this sentence.\n[pause_medium]\n[speaker_teacher] Finish this render.",
      connectionProfileId: "environment-speaches",
      modelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: "af_heart", speed: 1, gainDb: 0, roleDescription: "", sampleText: "" }],
      pausePresets: created.pausePresets,
      transitionPauses: created.transitionPauses,
      lexiconEntries: []
    } });
    studyNarrator.fakeSpeaches.reset();

    await openRoute(page, studyNarrator, `/projects/${created.id}`);
    await expect(page.getByRole("button", { name: "Freeze render plan" })).toBeEnabled();
    await page.getByRole("button", { name: "Freeze render plan" }).click();
    await expect(page.getByRole("button", { name: "Render this frozen plan" })).toBeVisible();
    await page.getByRole("button", { name: "Render this frozen plan" }).click();
    await expect(page.getByText(/Phase: complete/u)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("list", { name: "Render artifacts" }).getByRole("listitem")).toHaveCount(7);
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path, status }) => path === "/v1/audio/speech" && status === 200)).toHaveLength(2);

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
  });

  test("reports synthesis failure, retries from cache-safe state, and cancels an active request", async ({ page, request, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    const created = await (await request.post(`${studyNarrator.baseUrl}/api/projects`, { data: { name: "Render recovery" } })).json() as { id: string; name: string; pausePresets: unknown[]; transitionPauses: unknown };
    await request.put(`${studyNarrator.baseUrl}/api/projects/${created.id}`, { data: {
      name: created.name, description: "Failure fixture.", scriptSource: "[speaker_teacher] Recover this render.",
      connectionProfileId: "environment-speaches", modelId: "speaches-ai/Kokoro-82M-v1.0-ONNX",
      speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: "af_heart", speed: 1, gainDb: 0, roleDescription: "", sampleText: "" }],
      pausePresets: created.pausePresets, transitionPauses: created.transitionPauses, lexiconEntries: []
    } });
    await openRoute(page, studyNarrator, `/projects/${created.id}`);
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
    await page.getByRole("button", { name: "Cancel render" }).click();
    await expect(page.getByText(/Phase: canceled/u)).toBeVisible();
  });
});
