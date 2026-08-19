import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "web",
      testMatch: /web\/.*\.spec\.ts/u,
      use: { browserName: "chromium" },
    },
    {
      name: "electron",
      testMatch: /electron\/.*\.spec\.ts/u,
      workers: 1,
    },
  ],
});
