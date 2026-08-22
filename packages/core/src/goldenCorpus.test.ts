import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScript, transformScript } from "./index.js";

const CORPUS_DIRECTORY = fileURLToPath(
  new URL("../test-corpus/", import.meta.url),
);
const SCRIPT_SUFFIX = ".script";
const EXPECTED_SUFFIX = ".expected.json";

interface CorpusCase {
  caseName: string;
  scriptPath: string;
  expectedPath: string;
}

function discoverCorpus(): CorpusCase[] {
  const entries = readdirSync(CORPUS_DIRECTORY, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const scripts = fileNames
    .filter(
      (name) =>
        name.endsWith(SCRIPT_SUFFIX) && name.length > SCRIPT_SUFFIX.length,
    )
    .map((name) => ({
      caseName: name.slice(0, -SCRIPT_SUFFIX.length),
      path: join(CORPUS_DIRECTORY, name),
    }));
  const expectedCaseNames = new Set(
    fileNames
      .filter(
        (name) =>
          name.endsWith(EXPECTED_SUFFIX) &&
          name.length > EXPECTED_SUFFIX.length,
      )
      .map((name) => name.slice(0, -EXPECTED_SUFFIX.length)),
  );
  const recognizedNames = new Set([
    ...scripts.map(({ caseName }) => `${caseName}${SCRIPT_SUFFIX}`),
    ...[...expectedCaseNames].map(
      (caseName) => `${caseName}${EXPECTED_SUFFIX}`,
    ),
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
          `Missing expected output: ${caseName}${EXPECTED_SUFFIX}`,
      ),
    ...[...expectedCaseNames]
      .filter(
        (caseName) => !scripts.some((script) => script.caseName === caseName),
      )
      .map(
        (caseName) => `Orphan expected output: ${caseName}${EXPECTED_SUFFIX}`,
      ),
  ];

  if (problems.length > 0)
    throw new Error(
      `Invalid golden corpus at ${basename(CORPUS_DIRECTORY)}:\n${problems.join("\n")}`,
    );

  return scripts.map(({ caseName, path }) => ({
    caseName,
    scriptPath: path,
    expectedPath: join(CORPUS_DIRECTORY, `${caseName}${EXPECTED_SUFFIX}`),
  }));
}

function canonicalOutput(source: string): Buffer {
  const parsedScript = parseScript({ source });
  return Buffer.from(
    `${JSON.stringify(
      {
        parse: parsedScript,
        transform: transformScript({ parsedScript, entries: [] }),
      },
      null,
      2,
    )}\n`,
  );
}

describe("golden corpus", () => {
  it("matches every parser and transformer output byte for byte", () => {
    for (const corpusCase of discoverCorpus()) {
      const source = readFileSync(corpusCase.scriptPath, "utf8");
      const expected = readFileSync(corpusCase.expectedPath);

      expect(
        canonicalOutput(source).equals(expected),
        `Generated output differs from ${basename(corpusCase.expectedPath)}.`,
      ).toBe(true);
    }
  });
});
