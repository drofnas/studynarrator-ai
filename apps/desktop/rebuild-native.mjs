import { createRequire } from "node:module";
import { rebuild } from "@electron/rebuild";

const require = createRequire(import.meta.url);
const electronVersion = require("electron/package.json").version;

await rebuild({
  buildPath: import.meta.dirname,
  projectRootPath: import.meta.dirname,
  electronVersion,
  onlyModules: ["better-sqlite3"],
  force: true
});

process.stdout.write("Rebuilt apps/desktop/node_modules/better-sqlite3 for Electron.\n");
