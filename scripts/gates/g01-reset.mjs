#!/usr/bin/env node

import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const gate = process.argv[2];

function fail(message) {
  process.stderr.write(`GATE G01 RESET: ERROR: ${message}\n`);
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

if (gate !== "G01" || process.argv.length !== 3) {
  fail("usage: npm run gate:reset -- G01");
} else {
  const root = await realpath(repositoryRoot);
  const target = resolve(root, ".tmp/gates/G01");
  const expected = join(root, ".tmp", "gates", "G01");
  const targetRelative = relative(root, target);
  if (target !== expected || targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
    fail("resolved target is outside the repository G01 temporary directory");
  } else {
    try {
      await assertNoSymbolicLinks(target);
      await rm(target, { recursive: true, force: true });
      process.stdout.write("GATE G01 RESET: removed .tmp/gates/G01\n");
    } catch (error) {
      fail(error instanceof Error ? error.message : "reset failed");
    }
  }
}
