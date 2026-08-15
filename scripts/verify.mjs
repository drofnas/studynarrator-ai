#!/usr/bin/env node

import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");

function fail(message) {
  process.stderr.write(`VERIFY: ERROR: ${message}\n`);
  process.exit(1);
}

function run(command, args, environment = {}) {
  process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdio: "inherit",
    shell: false
  });
  if (result.error) fail(`${command} could not start`);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed with exit ${String(result.status)}`);
}

if (process.argv.length !== 2) fail("usage: npm run verify");
if (Number(process.versions.node.split(".")[0]) !== 26) {
  fail(`verification requires Node 26; current runtime is ${process.versions.node}`);
}

run("npm", ["run", "audit:dead-code"]);
run("npm", ["run", "lint"]);
run("npm", ["run", "typecheck"]);
run("npm", ["test"]);
run("npm", ["run", "test:api"]);
run("npm", ["run", "build"]);
run("npm", ["run", "rebuild:native", "--workspace", "@studynarrator/desktop"]);
run("playwright", ["test"]);

const verificationRoot = resolve(repositoryRoot, ".tmp", "verify");
mkdirSync(verificationRoot, { recursive: true, mode: 0o700 });
const verificationRun = mkdtempSync(resolve(verificationRoot, "run-"));
const serverData = resolve(verificationRun, "server");
const desktopData = resolve(verificationRun, "desktop");
mkdirSync(serverData, { recursive: true, mode: 0o700 });
mkdirSync(desktopData, { recursive: true, mode: 0o700 });

const serverNativeModule = realpathSync(resolve(repositoryRoot, "apps/server/node_modules/better-sqlite3"));
const desktopNativeModule = realpathSync(resolve(repositoryRoot, "apps/desktop/node_modules/better-sqlite3"));
if (serverNativeModule === desktopNativeModule) fail("server and Electron must not share a better-sqlite3 installation");

run("npm", ["run", "smoke", "--workspace", "@studynarrator/server"], { STUDYNARRATOR_DATA_DIR: serverData });
run("npm", ["run", "smoke", "--workspace", "@studynarrator/desktop"], { STUDYNARRATOR_DATA_DIR: desktopData });
run("npm", ["run", "smoke", "--workspace", "@studynarrator/server"], { STUDYNARRATOR_DATA_DIR: serverData });
run("npm", ["run", "verify:docker"]);

process.stdout.write("\nVERIFY: ALL CHECKS PASSED\n");
