import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/server/src/**/*.test.ts",
      "apps/desktop/src/bridge.test.ts",
      "apps/desktop/src/bootstrap.test.ts",
      "packages/application/src/**/*.test.ts"
    ],
    testTimeout: 15_000
  }
});
