#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScript, transformScript } from "@studynarrator/core";

const corpusDirectory = fileURLToPath(
  new URL("../packages/core/test-corpus/", import.meta.url),
);
const scriptSuffix = ".script";
const expectedSuffix = ".expected.json";

function discoverCorpus() {
  const entries = readdirSync(corpusDirectory, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const scripts = fileNames
    .filter(
      (name) =>
        name.endsWith(scriptSuffix) && name.length > scriptSuffix.length,
    )
    .map((name) => ({
      caseName: name.slice(0, -scriptSuffix.length),
      path: join(corpusDirectory, name),
    }));
  const expectedCaseNames = new Set(
    fileNames
      .filter(
        (name) =>
          name.endsWith(expectedSuffix) && name.length > expectedSuffix.length,
      )
      .map((name) => name.slice(0, -expectedSuffix.length)),
  );
  const recognizedNames = new Set([
    ...scripts.map(({ caseName }) => `${caseName}${scriptSuffix}`),
    ...[...expectedCaseNames].map((caseName) => `${caseName}${expectedSuffix}`),
  ]);
  const problems = [
    ...entries
      .filter((entry) => !entry.isFile())
      .map((entry) => `Corpus entry is not a file: ${entry.name}`),
    ...fileNames
      .filter((name) => !recognizedNames.has(name))
      .map((name) => `Unexpected corpus file: ${name}`),
    ...(scripts.length === 0 ? ["Corpus contains no .script inputs."] : []),
    ...scripts
      .filter(({ caseName }) => !expectedCaseNames.has(caseName))
      .map(
        ({ caseName }) =>
          `Missing expected output: ${caseName}${expectedSuffix}`,
      ),
    ...[...expectedCaseNames]
      .filter(
        (caseName) => !scripts.some((script) => script.caseName === caseName),
      )
      .map(
        (caseName) => `Orphan expected output: ${caseName}${expectedSuffix}`,
      ),
  ];

  if (problems.length > 0)
    throw new Error(
      `Invalid golden corpus at ${basename(corpusDirectory)}:\n${problems.join("\n")}`,
    );

  return scripts.map(({ caseName, path }) => ({
    caseName,
    scriptPath: path,
    expectedPath: join(corpusDirectory, `${caseName}${expectedSuffix}`),
  }));
}

function canonicalOutput(source) {
  const parsedScript = parseScript({ source });
  return `${JSON.stringify(
    {
      parse: parsedScript,
      transform: transformScript({ parsedScript, entries: [] }),
    },
    null,
    2,
  )}\n`;
}

try {
  const corpus = discoverCorpus();
  for (const corpusCase of corpus) {
    const source = readFileSync(corpusCase.scriptPath, "utf8");
    writeFileSync(corpusCase.expectedPath, canonicalOutput(source), "utf8");
  }
  process.stdout.write(
    `Regenerated ${String(corpus.length)} corpus output(s).\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`CORPUS: ERROR: ${message}\n`);
  process.exitCode = 1;
}
