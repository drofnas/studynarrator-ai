import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const INTERNAL_WORKSPACE_PATTERN = "^@studynarrator\\/";
const NON_FOUNDATIONAL_WORKSPACE_PATTERN =
  "^@studynarrator\\/(?!core(?:\\/|$)|shared-types(?:\\/|$))";
const APP_WORKSPACE_PATTERN =
  "^@studynarrator\\/(?:desktop|fake-speaches|server|web)(?:\\/|$)";

function restrictInternalDependencies(pattern, message) {
  return {
    "no-restricted-imports": [
      "error",
      { patterns: [{ regex: pattern, message }] },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: `ImportExpression[source.value=/${pattern}/]`,
        message,
      },
      {
        selector: `ImportExpression > TemplateLiteral[expressions.length=0] > TemplateElement[value.raw=/${pattern}/]`,
        message,
      },
    ],
  };
}

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      ".tmp/",
      "graphify-out/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "packages/core/**/*.{js,mjs,cjs,ts,tsx}",
      "packages/shared-types/**/*.{js,mjs,cjs,ts,tsx}",
    ],
    rules: restrictInternalDependencies(
      INTERNAL_WORKSPACE_PATTERN,
      "Core and shared-types must not import internal workspaces.",
    ),
  },
  {
    files: [
      "packages/persistence/**/*.{js,mjs,cjs,ts,tsx}",
      "packages/rendering/**/*.{js,mjs,cjs,ts,tsx}",
      "packages/speaches-adapter/**/*.{js,mjs,cjs,ts,tsx}",
    ],
    rules: restrictInternalDependencies(
      NON_FOUNDATIONAL_WORKSPACE_PATTERN,
      "Persistence, rendering, and the Speaches adapter may only import core and shared-types.",
    ),
  },
  {
    files: ["apps/**/*.{js,mjs,cjs,ts,tsx}"],
    rules: restrictInternalDependencies(
      APP_WORKSPACE_PATTERN,
      "Apps may not import app workspaces.",
    ),
  },
);
