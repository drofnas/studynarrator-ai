import { build } from "esbuild";

const shared = {
  bundle: true,
  external: ["electron", "better-sqlite3"],
  format: "cjs",
  platform: "node",
  sourcemap: true,
  target: "node24"
};

await Promise.all([
  build({ ...shared, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs" }),
  build({ ...shared, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs" }),
  build({ ...shared, entryPoints: ["src/smoke.ts"], outfile: "dist/smoke.cjs" })
]);
