import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDesktopDataDirectory } from "./bootstrap.js";

describe("desktop data directory", () => {
  it("resolves a relative configured directory from the initiating workspace", () => {
    expect(resolveDesktopDataDirectory("/default/data", {
      INIT_CWD: "/workspace/studynarrator",
      STUDYNARRATOR_DATA_DIR: ".tmp/gates/G04/manual"
    })).toBe(resolve("/workspace/studynarrator/.tmp/gates/G04/manual"));
  });
});
