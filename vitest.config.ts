import { fileURLToPath, URL } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    exclude: [
      ...configDefaults.exclude,
      "apps/server/src/**/*.test.ts",
      "apps/desktop/src/bridge.test.ts",
      "apps/desktop/src/bootstrap.test.ts",
      "packages/application/src/**/*.test.ts",
    ],
    testTimeout: 10_000,
  },
});
