import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveServerDataDirectory } from "./bootstrap.js";

describe("server data directory", () => {
  it("resolves a relative configured directory from the initiating workspace", () => {
    expect(resolveServerDataDirectory({
      INIT_CWD: "/workspace/studynarrator",
      STUDYNARRATOR_DATA_DIR: ".tmp/gates/G04/manual"
    })).toBe(resolve("/workspace/studynarrator/.tmp/gates/G04/manual"));
  });
});
