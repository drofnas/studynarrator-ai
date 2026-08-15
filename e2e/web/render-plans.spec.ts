import { configureConnection, expect, openRoute, test } from "../support/studyNarratorTest.js";

test.describe("Render and listen", () => {
  test("keeps one hidden current plan while repeated renders reuse cached speech", async ({ page, request, studyNarrator }) => {
    await configureConnection(page, studyNarrator);
    const created = await (await request.post(`${studyNarrator.baseUrl}/api/projects`, { data: { name: "Current plan acceptance" } })).json() as { id: string; name: string };
    await request.put(`${studyNarrator.baseUrl}/api/projects/${created.id}`, { data: {
      name: created.name,
      description: "One current render plan.",
      scriptSource: "[speaker_teacher] Reuse this narration.",
      speakerMappings: [{ speakerId: "teacher", displayName: "Teacher", voiceId: "af_heart", speed: 1, gainDb: 0, roleDescription: "", sampleText: "" }],
      lexiconEntries: []
    } });
    studyNarrator.fakeSpeaches.reset();

    await openRoute(page, studyNarrator, `/projects/${created.id}?tab=render`);
    await expect(page.getByRole("heading", { name: "Render and listen" })).toBeVisible();
    await expect(page.getByText(/first render may take longer while voice segments are generated/u)).toBeVisible();
    await expect(page.getByText(/Frozen render plan/u)).toHaveCount(0);
    await expect(page.getByLabel("Saved render plans")).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Render" })).toBeEnabled();
    await page.getByRole("button", { name: "Render" }).click();
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible({ timeout: 20_000 });
    const firstPlans = await (await request.get(`${studyNarrator.baseUrl}/api/projects/${created.id}/render-plans`)).json() as Array<{ id: string }>;
    expect(firstPlans).toHaveLength(1);
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path, status }) => path === "/v1/audio/speech" && status === 200)).toHaveLength(1);

    await page.getByRole("button", { name: "Render" }).click();
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible({ timeout: 20_000 });
    const currentPlans = await (await request.get(`${studyNarrator.baseUrl}/api/projects/${created.id}/render-plans`)).json() as Array<{ id: string }>;
    expect(currentPlans).toHaveLength(1);
    expect(currentPlans[0]!.id).toBe(firstPlans[0]!.id);
    expect(studyNarrator.fakeSpeaches.getState().requests.filter(({ path, status }) => path === "/v1/audio/speech" && status === 200)).toHaveLength(1);
  });
});
