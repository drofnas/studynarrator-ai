#!/usr/bin/env node

import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const gate = process.argv[2];
const repositoryRoot = resolve(import.meta.dirname, "../..");

function fail(message) {
  process.stderr.write(`GATE G01: ERROR: ${message}\n`);
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

if (gate !== "G01" || process.argv.length !== 3) {
  fail("usage: npm run verify:gate -- G01");
}

run("git", ["merge-base", "--is-ancestor", "gate-G00-approved", "HEAD"]);
run("node", ["-e", `
  const fs = require('node:fs');
  const approval = fs.readFileSync('docs/gates/approvals/G00.md', 'utf8');
  if (!/^APPROVED$/m.test(approval)) process.exit(1);
  const fixture = fs.readFileSync('fixtures/baseline/speaches-smoke.txt', 'utf8').trim();
  if (fixture !== 'This is the StudyNarrator baseline. SQL indexes can speed up database reads.') process.exit(1);
`]);
run("bash", ["-n", "scripts/gates/g00-speaches-baseline.sh"]);
run("bash", ["-n", "scripts/gates/g00-reset.sh"]);

run("npm", ["run", "lint"]);
run("npm", ["run", "typecheck"]);
run("npm", ["test"]);
run("npm", ["run", "build"]);

const nodeData = resolve(repositoryRoot, ".tmp/gates/G01/verify-node");
const electronData = resolve(repositoryRoot, ".tmp/gates/G01/verify-electron");
mkdirSync(nodeData, { recursive: true, mode: 0o700 });
mkdirSync(electronData, { recursive: true, mode: 0o700 });

const serverNativeModule = realpathSync(resolve(repositoryRoot, "apps/server/node_modules/better-sqlite3"));
const desktopNativeModule = realpathSync(resolve(repositoryRoot, "apps/desktop/node_modules/better-sqlite3"));
if (serverNativeModule === desktopNativeModule) {
  fail("server and Electron must not share a better-sqlite3 installation");
}

run("npm", ["run", "smoke", "--workspace", "@studynarrator/server"], {
  STUDYNARRATOR_DATA_DIR: nodeData
});
run("npm", ["run", "rebuild:native", "--workspace", "@studynarrator/desktop"]);
run("npm", ["run", "smoke", "--workspace", "@studynarrator/desktop"], {
  STUDYNARRATOR_DATA_DIR: electronData
});
run("npm", ["run", "smoke", "--workspace", "@studynarrator/server"], {
  STUDYNARRATOR_DATA_DIR: nodeData
});

process.stdout.write("\nGATE G01: AUTOMATED CHECKS PASSED\n");
