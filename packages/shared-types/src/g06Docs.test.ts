import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VoiceCatalogSchema } from "./connections.js";

const root = resolve(import.meta.dirname, "../../..");

describe("G06 gate documentation", () => {
  it("keeps the copy-ready catalog examples aligned with the public schema", () => {
    const manual = readFileSync(resolve(root, "docs/gates/G06-manual-test.md"), "utf8");
    const jsonBlocks = [...manual.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) => JSON.parse(match[1]!) as unknown);
    expect(jsonBlocks).toHaveLength(2);
    expect(VoiceCatalogSchema.parse(jsonBlocks[0]).entries).toHaveLength(2);
    const invalid = VoiceCatalogSchema.safeParse(jsonBlocks[1]);
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.error.message).toContain("unexpected");
  });

  it("keeps G06 inside the reset allowlist and repository-local safety boundary", () => {
    const reset = readFileSync(resolve(root, "scripts/gates/reset-gate.mjs"), "utf8");
    expect(reset).toContain('"G06"');
    expect(reset).toContain('resolve(root, ".tmp", "gates", gate)');
    expect(reset).toContain("assertNoSymbolicLinks(target)");
  });
});
