const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_IMPORT =
  /@import\s+(?:url\(\s*)?(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s);]+))\s*\)?/gi;
const EXTERNAL_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * Converts local CSS @import rules into JavaScript imports so Knip follows
 * stylesheet reachability from TS/TSX imports and between CSS files.
 */
function compileCssImports(source) {
  const imports = [];
  const stylesheet = source.replace(CSS_COMMENT, "");
  let match;

  CSS_IMPORT.lastIndex = 0;
  while ((match = CSS_IMPORT.exec(stylesheet))) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (
      !specifier ||
      specifier.startsWith("/") ||
      specifier.startsWith("#") ||
      EXTERNAL_URL.test(specifier)
    ) {
      continue;
    }

    const localSpecifier = specifier.startsWith(".")
      ? specifier
      : `./${specifier}`;
    imports.push(`import ${JSON.stringify(localSpecifier)};`);
  }

  return imports.join("\n");
}

export default {
  $schema: "https://unpkg.com/knip@6/schema.json",
  include: ["files", "dependencies", "devDependencies", "exports", "types"],
  includeEntryExports: true,
  compilers: {
    css: compileCssImports,
  },
  ignoreIssues: {
    "**/*.config.ts": ["exports"],
  },
  treatConfigHintsAsErrors: true,
  workspaces: {
    ".": {
      entry: ["scripts/**/*.mjs", "*.config.ts", "e2e/**/*.spec.ts"],
      project: ["scripts/**/*.{mjs,css}", "*.config.ts", "e2e/**/*.spec.ts"],
    },
    "apps/desktop": {
      entry: [
        "src/main.ts",
        "src/preload.ts",
        "src/smoke.ts",
        "src/**/*.test.ts",
      ],
      project: ["src/**/*.{ts,css}"],
      // electron-builder runs through npm exec and is not statically discoverable.
      ignoreDependencies: ["electron-builder"],
    },
    "apps/fake-speaches": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.{ts,css}"],
    },
    "apps/server": {
      entry: ["src/migrate.ts", "src/smoke.ts", "src/**/*.test.ts"],
      project: ["src/**/*.{ts,css}"],
    },
    "apps/web": {
      entry: ["src/**/*.test.{ts,tsx}"],
      project: ["src/**/*.{ts,tsx,css}"],
    },
    "packages/*": {
      entry: ["src/**/*.test.ts"],
      project: ["src/**/*.{ts,css}"],
      ignoreIssues: {
        // Barrel exports remain reachable; report their underlying source exports.
        "src/index.ts": ["exports", "types"],
      },
    },
  },
};
