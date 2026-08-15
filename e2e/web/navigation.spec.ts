import { continueOffline, expect, openRoute, test } from "../support/studyNarratorTest.js";

test.describe("shell, onboarding, and runtime routes", () => {
  test("completes first-run offline setup once and opens connection settings from the monitor", async ({ page, studyNarrator }) => {
    await openRoute(page, studyNarrator, "/projects");

    await expect(page.getByRole("heading", { name: "Connect the voice workshop" })).toBeVisible();
    await expect(page.getByLabel("Speaches address")).toHaveValue("");
    await expect(page.getByText(/API key|profile|environment-managed/u)).toHaveCount(0);
    await page.getByRole("button", { name: "Continue offline" }).click();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await page.getByRole("link", { name: /^Configuration error\./u }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("discovers, reviews, saves, and tests the singleton from onboarding", async ({ page, studyNarrator }) => {
    await openRoute(page, studyNarrator, "/onboarding");
    await page.getByLabel("Speaches address").fill(`${studyNarrator.fakeSpeaches.baseUrl}/v1`);
    await page.getByRole("button", { name: "Load catalog" }).click();
    await expect(page.getByLabel("Model")).toHaveValue("speaches-ai/Kokoro-82M-v1.0-ONNX");
    await expect(page.getByLabel("Default Voice")).toHaveValue("af_heart");
    await page.getByLabel("Model").selectOption("speaches-ai/Piper-en_US-lessac-medium");
    await expect(page.getByLabel("Default Voice")).toHaveValue("en_US-lessac-medium");
    await page.getByRole("button", { name: "Save and Test" }).click();

    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Connected\./u })).toBeVisible();
    const paths = studyNarrator.fakeSpeaches.getState().requests.map(({ path }) => path);
    expect(paths).toContain("/health");
    expect(paths).toContain("/v1/models");
    expect(paths).toContain("/v1/audio/speech");
    expect(paths.every((path) => !path.includes("/v1/v1"))).toBe(true);
  });

  test("navigates every user-facing route and renders runtime diagnostics", async ({ page, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    const navigation = page.getByRole("navigation", { name: "StudyNarrator tools" });

    await expect(navigation.getByRole("link").allTextContents()).resolves.toEqual(["Prompt Kit", "Projects", "Quick Scratchpad", "Settings", "System diagnostics"]);
    await navigation.getByRole("link", { name: "Prompt Kit" }).click();
    await expect(page.getByRole("heading", { name: "Script prompt kit" })).toBeVisible();
    await navigation.getByRole("link", { name: "Quick Scratchpad" }).click();
    await expect(page.getByRole("heading", { name: "Quick Scratchpad" })).toBeVisible();
    await navigation.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(navigation.getByText("Review tools")).toHaveCount(0);
    await navigation.getByRole("link", { name: "System diagnostics" }).click();
    await expect(page.getByRole("heading", { name: "Runtime self-test" })).toBeVisible();
    await page.getByRole("button", { name: "Run self-test" }).click();
    await expect(page.getByText(/SQLite 3/u)).toBeVisible();
    await expect(page.getByText(/diagnostics schema 4/u)).toBeVisible();
    await expect(page.getByText("REST", { exact: true })).toBeVisible();
    await navigation.getByRole("link", { name: "Projects" }).click();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });

  test("supports keyboard navigation and avoids horizontal mobile overflow", async ({ page, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

    const menu = page.getByRole("button", { name: "Open navigation" });
    await menu.click();
    await expect(page.getByRole("button", { name: "Close navigation" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Prompt Kit" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();

    await menu.click();
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    await menu.click();
    await page.locator("[data-navigation-backdrop]").click({ position: { x: 360, y: 100 } });
    await expect(menu).toBeFocused();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("opens projects from the ledger and preserves accessible tab state", async ({ page, request, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    const response = await request.post(`${studyNarrator.baseUrl}/api/projects`, { data: { name: "Ledger workspace", description: "A project-index acceptance fixture." } });
    expect(response.status()).toBe(201);
    const created = await response.json() as { id: string };
    await page.reload();

    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText(["Name", "Description", "Created", "Last updated", "Open"]);
    const row = table.getByRole("row", { name: /Ledger workspace/u });
    await row.getByRole("link", { name: "Open" }).click();
    await expect(page.getByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Script Editor" }).press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(new RegExp(`/projects/${created.id}\\?tab=settings$`, "u"));
    await page.reload();
    await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");

    await openRoute(page, studyNarrator, `/projects/${created.id}?tab=not-a-tab`);
    await expect(page.getByRole("tab", { name: "Script Editor" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("link", { name: "← Back to Projects" }).click();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const scrollRegion = page.getByRole("table").locator("..");
    await expect(scrollRegion).toBeVisible();
    expect(await scrollRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    await page.getByRole("row", { name: /Ledger workspace/u }).getByRole("link", { name: "Open" }).click();
    const tabList = page.getByRole("tablist", { name: "Project workspace" });
    expect(await tabList.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByRole("heading", { name: "Narration score" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
});
