import {
  configureConnection,
  continueOffline,
  expect,
  openRoute,
  test,
} from "../support/studyNarratorTest.js";

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`keeps the redesigned study workflows usable on ${viewport.name}`, async ({
    page,
    request,
    studyNarrator,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openRoute(page, studyNarrator, "/projects");
    await expect(
      page.getByRole("heading", { name: "Connect the voice workshop" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`onboarding-${viewport.name}.png`),
      fullPage: true,
    });
    await configureConnection(page, studyNarrator);
    await expect(
      page.getByRole("button", { name: "Create your first project" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`empty-${viewport.name}.png`),
      fullPage: true,
    });
    const projects = [
      {
        name: "Biology · Cell structure",
        description: "Membranes, organelles, and the work of a living cell.",
      },
      {
        name: "History · The industrial revolution",
        description:
          "A review of the ideas and inventions that changed everyday life.",
      },
      {
        name: "Spanish · Everyday conversations",
        description:
          "Short dialogues for listening and pronunciation practice.",
      },
    ];
    for (const project of projects) {
      const response = await request.post(
        `${studyNarrator.baseUrl}/api/projects`,
        { data: project },
      );
      expect(response.status()).toBe(201);
    }
    await page.reload();
    await expect(
      page.getByRole("link", { name: projects[0]!.name }),
    ).toBeVisible();
    const search = page.getByRole("searchbox", { name: "Search projects" });
    await search.fill("  PRONUNCIATION  ");
    await expect(page.getByRole("status")).toHaveText("1 matching project");
    await expect(
      page.getByRole("link", { name: projects[0]!.name }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: projects[2]!.name }),
    ).toBeVisible();
    await search.fill("No such project");
    await expect(
      page.getByRole("heading", { name: "No matching projects" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    if (viewport.name === "mobile") {
      const description = page.getByRole("cell", {
        name: projects[2]!.description,
        exact: true,
      });
      const descriptionWidth = await description.evaluate(
        (cell) => cell.getBoundingClientRect().width,
      );
      const rowWidth = await description
        .locator("..")
        .evaluate((row) => row.getBoundingClientRect().width);
      expect(Math.abs(rowWidth - descriptionWidth)).toBeLessThan(1);
    }
    await page.screenshot({
      path: testInfo.outputPath(`projects-${viewport.name}.png`),
      fullPage: true,
    });
    if (viewport.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("dialog", { name: "Application navigation" }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("navigation-mobile.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Close navigation" }).click();
      await expect(
        page.getByRole("dialog", { name: "Application navigation" }),
      ).not.toBeVisible();
    }
    await page.getByRole("link", { name: projects[0]!.name }).click();
    const script = page.getByRole("textbox", { name: "Script source" });
    await script.fill(
      "[section: The living cell]\n[speaker_teacher]\nEvery cell is a small, organized system. Its membrane controls what enters and what leaves.\n\nThe nucleus holds the instructions. Mitochondria release energy the cell can use.\n[pause_short]\nThink of a cell you know. What does its shape help it do?",
    );
    await page.getByRole("button", { name: "Save now" }).click();
    const projectId = new URL(page.url()).hash
      .split("/projects/")[1]!
      .split("?")[0];
    await expect
      .poll(async () => {
        const response = await request.get(
          `${studyNarrator.baseUrl}/api/projects/${projectId}`,
        );
        return ((await response.json()) as { scriptSource: string })
          .scriptSource;
      })
      .toContain("Every cell is a small, organized system.");
    await page.reload();
    await expect(script).toContainText(
      "Every cell is a small, organized system.",
    );
    await expect(
      page.getByRole("status", { name: "Estimate calibration status" }),
    ).not.toHaveText("Waiting for script analysis.");
    await script.scrollIntoViewIfNeeded();
    await page.locator(".cm-line").nth(6).scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const line = await page.locator(".cm-line").nth(6).boundingBox();
        const number = await page
          .locator(".cm-lineNumbers .cm-gutterElement")
          .filter({ hasText: /^7$/u })
          .boundingBox();
        return Math.abs((line?.y ?? 0) - (number?.y ?? 100));
      })
      .toBeLessThan(2);
    await page.evaluate(() => window.scrollTo(0, 0));
    const editorTop = await script.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    expect(editorTop).toBeLessThan(viewport.name === "mobile" ? 500 : 400);
    const tabs = page.getByRole("tablist", { name: "Project workspace" });
    expect(
      await tabs.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("tab", { name: "Render", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`editor-${viewport.name}.png`),
      fullPage: true,
    });
    const metadata = page.locator("summary", { hasText: "Project details" });
    await metadata.click();
    await expect(page.getByLabel("Project name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Duplicate" })).toBeVisible();
    await metadata.click();
    await expect(page.getByLabel("Project name")).toBeHidden();
    for (const name of ["Settings", "Details", "Render"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(
        page.getByRole("tab", { name, exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel")).toBeVisible();
      if (name === "Details") {
        await expect(page.getByText("Parsing…", { exact: true })).toHaveCount(
          0,
        );
      }
      if (name === "Render") {
        await page.getByRole("button", { name: "Render", exact: true }).click();
        await expect(
          page.getByRole("region", { name: /Audio player for/u }),
        ).toBeVisible();
      }
      await page.screenshot({
        path: testInfo.outputPath(
          `project-${name.toLowerCase()}-${viewport.name}.png`,
        ),
        fullPage: true,
      });
    }
    for (const [route, heading, name] of [
      ["/script-prompts", "Script prompt kit", "prompts"],
      ["/scratchpad", "Quick Scratchpad", "scratchpad"],
      ["/settings/general", "General", "general"],
      ["/settings/voices", "Voices", "voices"],
      ["/settings/lexicon", "Lexicon", "lexicon"],
      ["/settings/timings", "Timings", "timings"],
      ["/settings/retention", "Retention", "retention"],
      ["/diagnostics", "Runtime self-test", "diagnostics"],
    ]) {
      await openRoute(page, studyNarrator, route!);
      await expect(
        page.getByRole("heading", { name: heading!, exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      if (name === "diagnostics") {
        await page.getByRole("button", { name: "Run self-test" }).click();
        await expect(page.getByText(/SQLite 3/u)).toBeVisible();
      }
      if (name === "voices" || name === "lexicon") {
        await page.screenshot({
          path: testInfo.outputPath(`${name}-${viewport.name}-viewport.png`),
        });
      }
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${viewport.name}.png`),
        fullPage: true,
      });
    }
  });
}

test("creates a first project from the empty library and skips navigation by keyboard", async ({
  page,
  studyNarrator,
}) => {
  await continueOffline(page, studyNarrator);
  await page.getByRole("link", { name: "Skip to workspace" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace-content")).toBeFocused();
  await page.getByRole("button", { name: "Create your first project" }).click();
  await expect(
    page.getByRole("textbox", { name: "Project name" }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Project name" })
    .fill("My study guide");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Script Editor" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "My study guide" }),
  ).toBeVisible();
  await page.locator("summary", { hasText: "Project details" }).click();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue(
    "My study guide",
  );
});
