#!/usr/bin/env node

import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const gate = process.argv[2];
const allowedGates = new Set(["G01", "G02", "G03", "G04", "G05", "G06"]);

function fail(message) {
  process.stderr.write(`GATE RESET: ERROR: ${message}\n`);
  process.exitCode = 1;
}

async function assertNoSymbolicLinks(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const child = join(path, entry.name);
    const metadata = await lstat(child);
    if (metadata.isSymbolicLink()) {
      throw new Error(`refusing to reset a directory containing a symbolic link: ${relative(repositoryRoot, child)}`);
    }
    if (metadata.isDirectory()) await assertNoSymbolicLinks(child);
  }
}

if (!gate || !allowedGates.has(gate) || process.argv.length !== 3) {
  fail("usage: npm run gate:reset -- G01|G02|G03|G04|G05|G06");
} else {
  const root = await realpath(repositoryRoot);
  const target = resolve(root, ".tmp", "gates", gate);
  const expected = join(root, ".tmp", "gates", gate);
  const targetRelative = relative(root, target);
  if (target !== expected || targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
    fail(`resolved target is outside the repository ${gate} temporary directory`);
  } else {
    try {
      await assertNoSymbolicLinks(target);
      await rm(target, { recursive: true, force: true });
      process.stdout.write(`GATE RESET: removed .tmp/gates/${gate}\n`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "reset failed");
    }
  }
}
