import { continueOffline, expect, openRoute, test } from "../support/studyNarratorTest.js";

test.describe("shell, onboarding, and runtime routes", () => {
  test("completes first-run offline setup once and can reopen onboarding", async ({ page, studyNarrator }) => {
    await openRoute(page, studyNarrator, "/projects");

    await expect(page.getByRole("heading", { name: "Connect the voice workshop" })).toBeVisible();
    await expect(page.getByText(/Web endpoint settings are server-side/u)).toBeVisible();
    await expect(page.getByText("SPEACHES_BASE_URL=https://speech.example.test/v1")).toBeVisible();
    await page.getByRole("button", { name: "Continue offline" }).click();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Disconnected" }).click();
    await expect(page.getByRole("heading", { name: "Connect the voice workshop" })).toBeVisible();
  });

  test("creates and tests a healthy profile from onboarding", async ({ page, studyNarrator }) => {
    await openRoute(page, studyNarrator, "/onboarding");
    await page.getByLabel("Profile name").fill("Healthy loopback");
    await page.getByLabel("HTTP(S) endpoint").fill(studyNarrator.fakeSpeaches.baseUrl);
    await page.getByRole("button", { name: "Create + Test Connection" }).click();

    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Connected" })).toBeVisible();
    const paths = studyNarrator.fakeSpeaches.getState().requests.map(({ path }) => path);
    expect(paths).toContain("/health");
    expect(paths).toContain("/v1/models");
    expect(paths).toContain("/v1/audio/speech");
    expect(paths.every((path) => !path.includes("/v1/v1"))).toBe(true);
  });

  test("navigates every user-facing route and renders runtime diagnostics", async ({ page, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    const navigation = page.getByRole("navigation", { name: "StudyNarrator tools" });

    await navigation.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await navigation.getByText("Review tools").click();
    await navigation.getByRole("link", { name: "Script Lab" }).click();
    await expect(page.getByRole("heading", { name: "Script Lab" })).toBeVisible();
    await navigation.getByText("Review tools").click();
    await navigation.getByRole("link", { name: "Persistence Lab" }).click();
    await expect(page.getByRole("heading", { name: "Persistence Lab" })).toBeVisible();
    await navigation.getByText("Review tools").click();
    await navigation.getByRole("link", { name: "Runtime diagnostics" }).click();
    await expect(page.getByRole("heading", { name: "Runtime self-test" })).toBeVisible();
    await page.getByRole("button", { name: "Run self-test" }).click();
    await expect(page.getByText(/SQLite 3/u)).toBeVisible();
    await expect(page.getByText("REST")).toBeVisible();
    await navigation.getByRole("link", { name: "Projects" }).click();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });

  test("supports keyboard navigation and avoids horizontal mobile overflow", async ({ page, studyNarrator }) => {
    await continueOffline(page, studyNarrator);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Projects" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Settings" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
