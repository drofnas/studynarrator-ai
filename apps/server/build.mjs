import { build } from "esbuild";

await build({
  entryPoints: {
    index: "src/index.ts",
    smoke: "src/smoke.ts",
    migrate: "src/migrate.ts"
  },
  outdir: "dist",
  bundle: true,
  external: ["better-sqlite3", "express"],
  format: "esm",
  platform: "node",
  sourcemap: true,
  target: "node26"
});
