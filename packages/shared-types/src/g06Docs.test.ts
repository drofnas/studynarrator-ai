import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("G06 gate documentation", () => {
  it("keeps human review UX-only and gated behind automation", () => {
    const manual = readFileSync(resolve(root, "docs/gates/G06-manual-test.md"), "utf8");
    expect(manual).toContain("G06 functional acceptance is automated");
    expect(manual).toContain("GATE G06: AUTOMATED CHECKS PASSED");
    expect(manual).toContain("## Human Web UX review");
    expect(manual).toContain("## Human Electron UX review");
    expect(manual).toContain("npm run dev:web");
    expect(manual).toContain("npm run dev:desktop");
    expect(manual).toContain("STUDYNARRATOR_DATA_DIR=.tmp/gates/G06/ux-web");
    expect(manual).toContain("STUDYNARRATOR_DATA_DIR=.tmp/gates/G06/ux-electron");
    expect(manual).toContain("A functional defect requires an automated regression test before approval");
  });

  it("documents the repository-wide Playwright and API contract mandate", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("## Mandatory automated acceptance and API contracts");
    expect(agents).toContain("must add or update Playwright coverage in the same checkpoint");
    expect(agents).toContain("must update its explicit manifest and manifest-driven unit or contract tests");
    expect(agents).toContain("Human gate review is UX-only after automation is green");
  });

  it("requires a signed approval record when G06 is checked", () => {
    const plan = readFileSync(resolve(root, "docs/gated-implementation-plan-v1.md"), "utf8");
    if (!plan.includes("- [x] G06 —")) return;
    const approval = readFileSync(resolve(root, "docs/gates/approvals/G06.md"), "utf8");
    expect(approval).toContain("Reviewed implementation commit SHA: `02a48d9`");
    expect(approval).toContain("\nAPPROVED\n");
  });

  it("keeps G06 inside the reset allowlist and repository-local safety boundary", () => {
    const reset = readFileSync(resolve(root, "scripts/gates/reset-gate.mjs"), "utf8");
    expect(reset).toContain('"G06"');
    expect(reset).toContain('resolve(root, ".tmp", "gates", gate)');
    expect(reset).toContain("assertNoSymbolicLinks(target)");
  });
});
