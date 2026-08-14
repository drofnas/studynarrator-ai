import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/docker",
  outputDir: "test-results/docker",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.STUDYNARRATOR_DOCKER_BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    { name: "docker-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "docker-firefox", use: { ...devices["Desktop Firefox"] } }
  ]
});
