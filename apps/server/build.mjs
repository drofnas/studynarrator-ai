import { build } from "esbuild";

await build({
  entryPoints: {
    index: "src/index.ts",
    smoke: "src/smoke.ts",
    migrate: "src/migrate.ts",
  },
  outdir: "dist",
  bundle: true,
  external: ["better-sqlite3", "express"],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  format: "esm",
  platform: "node",
  sourcemap: true,
  target: "node26",
});
