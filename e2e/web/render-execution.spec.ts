import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import {
  configureConnection,
  expect,
  openRoute,
  test,
} from "../support/studyNarratorTest.js";

function formatAudioDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1_000);
  return `${String(Math.floor(totalSeconds / 60))}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

test.describe("render execution", () => {
  test("renders, reuses unchanged edits, downloads MP3 and the exact evidence package, and restores the latest render", async ({
    page,
    request,
    studyNarrator,
  }) => {
    await configureConnection(page, studyNarrator);
    const created = (await (
      await request.post(`${studyNarrator.baseUrl}/api/projects`, {
        data: { name: "Render acceptance" },
      })
    ).json()) as { id: string; name: string };
    const projectInput = {
      name: created.name,
      description: "End-to-end render fixture.",
      scriptSource:
        "[speaker_teacher] Render this sentence.\n\n[speaker_teacher] Keep this sentence.",
      speakerMappings: [
        {
          speakerId: "teacher",
          displayName: "Teacher",
          voiceId: "af_heart",
          speed: 1,
          gainDb: 0,
          roleDescription: "",
          sampleText: "",
        },
      ],
      lexiconEntries: [],
    };
    await request.put(`${studyNarrator.baseUrl}/api/projects/${created.id}`, {
      data: projectInput,
    });
    studyNarrator.fakeSpeaches.reset();
    studyNarrator.fakeSpeaches.setScenario("slow");

    await openRoute(page, studyNarrator, `/projects/${created.id}?tab=render`);
    const diskSpaceCheck = page.getByRole("checkbox", {
      name: "Block renders when disk space is insufficient",
    });
    await expect(diskSpaceCheck).toBeChecked();
    await diskSpaceCheck.uncheck();
    await page.reload();
    await expect(diskSpaceCheck).not.toBeChecked();
    await diskSpaceCheck.check();
    await page.reload();
    await expect(diskSpaceCheck).toBeChecked();
    await expect(page.getByRole("button", { name: "Render" })).toBeEnabled();
    const renderEventsRequest = page.waitForRequest(
      (renderRequest) =>
        renderRequest.method() === "GET" &&
        /\/api\/renders\/[^/]+\/events$/u.test(renderRequest.url()),
    );
    await page.getByRole("button", { name: "Render" }).click();
    await renderEventsRequest;
    await expect(
      page.getByRole("button", { name: "Rendering…" }),
    ).toBeDisabled();
    const progress = page.getByRole("progressbar", {
      name: "Render chunk progress",
    });
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute("max", "2");
    await expect
      .poll(async () => Number(await progress.getAttribute("value")))
      .toBeGreaterThan(0);
    const completedPlayer = page.getByLabel(
      /Audio player for Completed project render/u,
    );
    await expect(completedPlayer).toBeVisible({ timeout: 20_000 });
    expect(
      studyNarrator.fakeSpeaches
        .getState()
        .requests.filter(
          ({ path, status }) => path === "/v1/audio/speech" && status === 200,
        ),
    ).toHaveLength(2);

    await page.getByRole("tab", { name: "Script Editor" }).click();
    await page
      .getByLabel("Script source")
      .fill(
        "[speaker_teacher] Render an edited sentence.\n\n[speaker_teacher] Keep this sentence.",
      );
    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/projects/${created.id}`) &&
        response.request().method() === "PUT" &&
        response.ok(),
    );
    await page.getByRole("button", { name: "Save now" }).click();
    await saveResponse;
    await expect(
      page.getByText(/Unsaved changes|Saving…|Save failed|Invalid changes/u),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "Render" }).click();
    await page.getByRole("button", { name: "Render" }).click();
    await expect(
      page.getByRole("button", { name: "Rendering…" }),
    ).toBeDisabled();
    await expect(completedPlayer).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByRole("button", { name: "Download", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Download Details" }),
    ).toBeDisabled();
    await expect(completedPlayer).toHaveAttribute("aria-disabled", "false", {
      timeout: 20_000,
    });
    await expect(
      page.getByRole("button", { name: "Download", exact: true }),
    ).toBeEnabled();
    expect(
      studyNarrator.fakeSpeaches
        .getState()
        .requests.filter(
          ({ path, status }) => path === "/v1/audio/speech" && status === 200,
        ),
    ).toHaveLength(3);

    const audioDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const audio = await audioDownload;
    expect(audio.suggestedFilename()).toBe("render-acceptance.mp3");
    expect((await readFile(await audio.path())).subarray(0, 3).toString()).toBe(
      "ID3",
    );

    const detailsDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Details" }).click();
    const details = await detailsDownload;
    expect(details.suggestedFilename()).toBe(
      "render-acceptance-render-details.zip",
    );
    const files = unzipSync(await readFile(await details.path()));
    expect(Object.keys(files).sort()).toEqual(
      [
        "checksums.txt",
        "original-script.txt",
        "project-snapshot.json",
        "readable-transcript.txt",
        "render-acceptance.mp3",
        "render-manifest.json",
        "tts-transcript.txt",
      ].sort(),
    );
    expect(strFromU8(files["tts-transcript.txt"]!)).toContain(
      "Render an edited sentence",
    );
    expect(
      Object.keys(files).some(
        (name) => name.includes("segment") || name.includes("waveform"),
      ),
    ).toBe(false);

    const renders = (await (
      await request.get(
        `${studyNarrator.baseUrl}/api/projects/${created.id}/renders`,
      )
    ).json()) as Array<{ id: string }>;
    expect(renders).toHaveLength(2);
    await page.reload();
    await expect(
      page.getByLabel(/Audio player for Completed project render/u),
    ).toBeVisible();
    await expect(page.getByText(renders[1]!.id)).toHaveCount(0);
    const summaries = (await (
      await request.get(`${studyNarrator.baseUrl}/api/projects`)
    ).json()) as Array<{
      id: string;
      scriptLineCount: number | null;
      audioDurationMs: number | null;
    }>;
    const summary = summaries.find(({ id }) => id === created.id);
    expect(summary).toMatchObject({ scriptLineCount: 3 });
    expect(summary?.audioDurationMs).not.toBeNull();
    await page.getByRole("link", { name: "← Back to Projects" }).click();
    const row = page.getByRole("row", { name: /Render acceptance/u });
    await expect(row).toContainText("3");
    await expect(row).toContainText(
      formatAudioDuration(summary!.audioDurationMs!),
    );
  });

  test("shows a concise failure and retries from the same project action", async ({
    page,
    request,
    studyNarrator,
  }) => {
    await configureConnection(page, studyNarrator);
    const created = (await (
      await request.post(`${studyNarrator.baseUrl}/api/projects`, {
        data: { name: "Render recovery" },
      })
    ).json()) as { id: string; name: string };
    await request.put(`${studyNarrator.baseUrl}/api/projects/${created.id}`, {
      data: {
        name: created.name,
        description: "Failure fixture.",
        scriptSource: "[speaker_teacher] Recover this render.",
        speakerMappings: [
          {
            speakerId: "teacher",
            displayName: "Teacher",
            voiceId: "af_heart",
            speed: 1,
            gainDb: 0,
            roleDescription: "",
            sampleText: "",
          },
        ],
        lexiconEntries: [],
      },
    });
    await openRoute(page, studyNarrator, `/projects/${created.id}?tab=render`);
    studyNarrator.fakeSpeaches.setScenario("rejected-voice");
    await page.getByRole("button", { name: "Render" }).click();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("alert")).toContainText(
      "Speech generation failed",
    );
    studyNarrator.fakeSpeaches.setScenario("healthy");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByRole("button", { name: "Download", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("keeps one render per project while repeated renders reuse cached speech", async ({
    page,
    request,
    studyNarrator,
  }) => {
    await configureConnection(page, studyNarrator);
    const created = (await (
      await request.post(`${studyNarrator.baseUrl}/api/projects`, {
        data: { name: "One render per project" },
      })
    ).json()) as { id: string; name: string };
    await request.put(`${studyNarrator.baseUrl}/api/projects/${created.id}`, {
      data: {
        name: created.name,
        description: "One render per project.",
        scriptSource: "[speaker_teacher] Reuse this narration.",
        speakerMappings: [
          {
            speakerId: "teacher",
            displayName: "Teacher",
            voiceId: "af_heart",
            speed: 1,
            gainDb: 0,
            roleDescription: "",
            sampleText: "",
          },
        ],
        lexiconEntries: [],
      },
    });
    studyNarrator.fakeSpeaches.reset();

    await openRoute(page, studyNarrator, `/projects/${created.id}?tab=render`);
    await expect(
      page.getByRole("heading", { name: "Render and listen" }),
    ).toBeVisible();
    await expect(page.getByText(/Frozen render plan/u)).toHaveCount(0);
    await expect(page.getByLabel("Saved render plans")).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Render" })).toBeEnabled();
    await page.getByRole("button", { name: "Render" }).click();
    await expect(
      page.getByRole("button", { name: "Download", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    const firstRenders = (await (
      await request.get(
        `${studyNarrator.baseUrl}/api/projects/${created.id}/renders`,
      )
    ).json()) as Array<{ id: string }>;
    expect(firstRenders).toHaveLength(1);
    expect(
      studyNarrator.fakeSpeaches
        .getState()
        .requests.filter(
          ({ path, status }) => path === "/v1/audio/speech" && status === 200,
        ),
    ).toHaveLength(1);

    await page.getByRole("button", { name: "Render" }).click();
    await expect(
      page.getByRole("button", { name: "Download", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    const currentRenders = (await (
      await request.get(
        `${studyNarrator.baseUrl}/api/projects/${created.id}/renders`,
      )
    ).json()) as Array<{ id: string }>;
    expect(currentRenders).toHaveLength(1);
    expect(currentRenders[0]!.id).toBe(firstRenders[0]!.id);
    expect(
      studyNarrator.fakeSpeaches
        .getState()
        .requests.filter(
          ({ path, status }) => path === "/v1/audio/speech" && status === 200,
        ),
    ).toHaveLength(1);
  });
});
