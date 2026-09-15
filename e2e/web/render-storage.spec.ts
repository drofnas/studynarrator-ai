import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  RenderJobSchema,
  SpeechCacheCleanupResultSchema,
  SpeechCacheStatusSchema,
} from "@studynarrator/shared-types";
import {
  configureConnection,
  expect,
  openRoute,
  test,
} from "../support/studyNarratorTest.js";

test("refreshes render storage and preserves pinned files through cache and clip cleanup", async ({
  page,
  request,
  studyNarrator,
}, testInfo) => {
  await configureConnection(page, studyNarrator);
  const api = studyNarrator.baseUrl;
  await openRoute(page, studyNarrator, "/settings/general");
  const storage = page.getByRole("article", { name: "Product Renders" });
  await expect(storage).toContainText("0 B stored");
  await expect(storage).toContainText("0 B reclaimable");

  const renders: string[] = [];
  for (const name of ["Protected storage", "Disposable storage"]) {
    const created = (await (
      await request.post(`${api}/api/projects`, {
        data: { name },
      })
    ).json()) as { id: string };
    expect(
      (
        await request.put(`${api}/api/projects/${created.id}`, {
          data: {
            name,
            description: "Storage acceptance fixture.",
            scriptSource: `[speaker_teacher] ${name}.`,
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
        })
      ).ok(),
    ).toBe(true);
    const started = await request.post(
      `${api}/api/projects/${created.id}/renders`,
      { data: {} },
    );
    expect(started.status()).toBe(202);
    const render = RenderJobSchema.parse(await started.json());
    renders.push(render.id);
    await expect
      .poll(
        async () =>
          RenderJobSchema.parse(
            await (await request.get(`${api}/api/renders/${render.id}`)).json(),
          ).state,
      )
      .toBe("complete");
  }
  // Rendering completed while General stayed open: no navigation or manual refresh.
  await expect(storage).toContainText(/\d+\.\d+ KiB stored/u);
  const pinned = renders[0]!;
  const disposable = renders[1]!;
  expect(
    (
      await request.put(`${api}/api/renders/${pinned}/pin`, {
        data: { pinned: true },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const before = SpeechCacheStatusSchema.parse(
    await (await request.get(`${api}/api/speech-cache`)).json(),
  );
  expect(before.projectRenders!.totalBytes).toBeGreaterThan(
    before.projectRenders!.reclaimableBytes,
  );
  expect(before.projectRenders!.reclaimableBytes).toBeGreaterThan(0);
  const protectedBytes =
    before.projectRenders!.totalBytes - before.projectRenders!.reclaimableBytes;
  const pinnedPath = join(studyNarrator.dataDirectory, "renders", pinned);
  const pinnedFiles = await readdir(pinnedPath, { recursive: true });
  expect(pinnedFiles.length).toBeGreaterThan(0);

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await storage.scrollIntoViewIfNeeded();
    await expect(storage).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`render-storage-${String(width)}.png`),
      fullPage: true,
    });
  }

  const clear = page.getByRole("button", { name: "Clear all cached speech" });
  const checkbox = page.getByLabel("Include Rendered Project Clips");
  await expect(checkbox).not.toBeChecked();
  page.once("dialog", (dialog) => dialog.accept());
  await clear.click();
  await expect(
    page.getByText(/Cleared 2 cached speech entries/u),
  ).toBeVisible();
  const cacheOnly = SpeechCacheStatusSchema.parse(
    await (await request.get(`${api}/api/speech-cache`)).json(),
  );
  expect(cacheOnly.entryCount).toBe(0);
  expect(cacheOnly.projectRenders).toEqual(before.projectRenders);
  expect(
    (
      await stat(join(studyNarrator.dataDirectory, "renders", disposable))
    ).isDirectory(),
  ).toBe(true);

  await checkbox.check();
  expect(
    (
      await stat(join(studyNarrator.dataDirectory, "renders", disposable))
    ).isDirectory(),
  ).toBe(true);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Eligible project audio:");
    expect(dialog.message()).toContain(
      "Pinned and unfinished renders are protected.",
    );
    await dialog.accept();
  });
  const cleanup = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith("/api/speech-cache"),
  );
  await clear.click();
  const removed = SpeechCacheCleanupResultSchema.parse(
    await (await cleanup).json(),
  );
  expect(removed.bytesFreed).toBe(before.projectRenders!.reclaimableBytes);
  expect(removed.renderedProjectClips).toEqual({
    entriesRemoved: 1,
    bytesFreed: removed.bytesFreed,
  });
  await expect(page.getByText(/and audio for 1 project render/u)).toBeVisible();
  await expect(storage).toContainText("0 B reclaimable");
  const after = SpeechCacheStatusSchema.parse(
    await (await request.get(`${api}/api/speech-cache`)).json(),
  );
  expect(after.projectRenders).toEqual({
    totalBytes: protectedBytes,
    reclaimableBytes: 0,
  });
  expect(await readdir(pinnedPath, { recursive: true })).toEqual(pinnedFiles);
  await expect(
    stat(join(studyNarrator.dataDirectory, "renders", disposable)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect((await request.get(`${api}/api/renders/${pinned}/audio`)).ok()).toBe(
    true,
  );
  expect(
    RenderJobSchema.parse(
      await (await request.get(`${api}/api/renders/${disposable}`)).json(),
    ).state,
  ).toBe("complete");

  // A deletion from another client is reflected by the page's next refresh.
  expect(
    (
      await request.put(`${api}/api/renders/${pinned}/pin`, {
        data: { pinned: false },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.delete(`${api}/api/speech-cache`, {
        data: { includeRenderedProjectClips: true },
      })
    ).ok(),
  ).toBe(true);
  await expect(storage).toContainText("0 B stored");
});
