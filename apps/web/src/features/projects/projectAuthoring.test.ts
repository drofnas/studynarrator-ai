// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MAX_SCRIPT_CHARACTERS, readUtf8TextFile, replaceLiteral, stripSingleSurroundingCodeFence } from "./projectAuthoring.js";

describe("authoring input helpers", () => {
  it("reads LF, CRLF, and Unicode text without rewriting it", async () => {
    for (const source of ["one\ntwo", "one\r\ntwo", "Résumé 🧠"]) {
      await expect(readUtf8TextFile(new File([source], "guide.txt", { type: "text/plain" }))).resolves.toBe(source);
    }
  });

  it("rejects wrong extensions and invalid UTF-8", async () => {
    await expect(readUtf8TextFile(new File(["text"], "guide.md"))).rejects.toThrow(".txt");
    await expect(readUtf8TextFile(new File([new Uint8Array([0xc3, 0x28])], "guide.txt"))).rejects.toThrow("UTF-8");
    await expect(readUtf8TextFile(new File(["x".repeat(MAX_SCRIPT_CHARACTERS + 1)], "guide.txt"))).rejects.toThrow("five-million-character");
  });

  it("only strips one explicit surrounding code fence", () => {
    expect(stripSingleSurroundingCodeFence("```text\nSQL\n```")).toBe("SQL");
    expect(stripSingleSurroundingCodeFence("before\n```text\nSQL\n```")).toBeUndefined();
    expect(stripSingleSurroundingCodeFence("SQL")).toBeUndefined();
  });

  it("replaces literal text with optional case sensitivity", () => {
    expect(replaceLiteral("SQL sql", "SQL", "database", true)).toBe("database sql");
    expect(replaceLiteral("SQL sql", "SQL", "database", false)).toBe("database database");
    expect(replaceLiteral("a+b a+b", "a+b", "sum", true)).toBe("sum sum");
  });
});
