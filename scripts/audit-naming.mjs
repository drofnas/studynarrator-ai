#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const listed = spawnSync("git", ["ls-files"], { cwd: repositoryRoot, encoding: "utf8", shell: false });
if (listed.status !== 0) {
  process.stderr.write("NAMING AUDIT: ERROR: git ls-files failed\n");
  process.exit(1);
}

const auditPath = "scripts/audit-naming.mjs";
const ignoredFiles = new Set([auditPath, "package-lock.json"]);
const forbiddenPathParts = ["docs/gates", "fixtures/gates", "scripts/gates", "scripts/g06", "gated-implementation-plan"];
const forbiddenContent = [
  new RegExp(`\\b${"Gate"} G\\d{2}\\b`, "u"),
  new RegExp(`\\bG\\d{2}\\b`, "u"),
  new RegExp(`\\bg\\d{2}(?:[._-]|\\b)`, "u"),
  new RegExp(`(?:^|/)\\.tmp/${"gates"}(?:/|\\b)`, "u"),
  new RegExp(`${"verify"}:${"gate"}|${"gate"}:reset`, "u"),
  new RegExp(`(?:docs|fixtures|scripts)/${"gates"}(?:/|\\b)`, "u")
];

const failures = [];
for (const path of listed.stdout.split("\n").filter(Boolean)) {
  if (ignoredFiles.has(path)) continue;
  if (forbiddenPathParts.some((part) => path.includes(part))) {
    failures.push(`${path}: forbidden delivery-scaffolding path`);
    continue;
  }
  const contents = readFileSync(resolve(repositoryRoot, path));
  if (contents.includes(0)) continue;
  const text = contents.toString("utf8");
  for (const [index, line] of text.split("\n").entries()) {
    if (forbiddenContent.some((pattern) => pattern.test(line))) failures.push(`${path}:${String(index + 1)}: ${line.trim()}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`NAMING AUDIT: ERROR: found ${String(failures.length)} delivery-specific reference(s)\n`);
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("NAMING AUDIT: PASSED\n");
