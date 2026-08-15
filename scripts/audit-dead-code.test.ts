import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function runAudit(root: string) {
  return spawnSync(process.execPath, [resolve("scripts/audit-dead-code.mjs"), "--root", root], {
    cwd: resolve("."),
    encoding: "utf8"
  });
}

describe("dead-code audit", () => {
  test("accepts the real monorepo", () => {
    const result = runAudit(resolve("."));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("DEAD CODE AUDIT: PASSED");
  });

  test("finds unused files, exports, and dependencies while preserving special entrypoints", () => {
    const root = mkdtempSync(join(tmpdir(), "studynarrator-dead-code-"));
    try {
      mkdirSync(join(root, "src", "workers"), { recursive: true });
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "fixture",
        type: "module",
        exports: "./src/index.ts",
        scripts: { migrate: "tsx src/migrate.ts", smoke: "tsx src/smoke.ts", test: "vitest" },
        dependencies: { "left-pad": "1.3.0" }
      }));
      writeFileSync(join(root, "src", "index.ts"), 'import "./styles.css";\nimport { used } from "./used.js";\nvoid used;\n');
      writeFileSync(join(root, "src", "used.ts"), "export const used = 1;\nexport const unused = 2;\n");
      writeFileSync(join(root, "src", "orphan.ts"), "const orphan = true;\nvoid orphan;\n");
      writeFileSync(join(root, "src", "styles.css"), ":root { color: black; }\n");
      writeFileSync(join(root, "src", "workers", "parser.worker.ts"), "self.onmessage = () => undefined;\n");
      writeFileSync(join(root, "src", "contracts.d.ts"), "declare const fixtureAmbient: string;\n");
      writeFileSync(join(root, "src", "serviceManifest.ts"), "export default Object.freeze({});\n");
      writeFileSync(join(root, "src", "migrate.ts"), "void 0;\n");
      writeFileSync(join(root, "src", "smoke.ts"), "void 0;\n");

      const result = runAudit(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("orphan.ts: unreachable-file");
      expect(result.stderr).toContain("used.ts:2: unused-export: unused");
      expect(result.stderr).toContain("package.json: unused-dependency: left-pad");
      expect(result.stderr).not.toMatch(/parser\.worker|contracts\.d\.ts|serviceManifest|migrate\.ts|smoke\.ts|styles\.css/u);
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});
