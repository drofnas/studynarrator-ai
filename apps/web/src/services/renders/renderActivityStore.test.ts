// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readViewedRenders,
  storeViewedRenders,
} from "./renderActivityStore.js";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("viewed render storage", () => {
  it("round-trips only UUIDs and rejects corrupt or content-bearing records", () => {
    const ids = new Set(["00000000-0000-4000-8000-000000000091"]);
    storeViewedRenders(ids);
    expect(readViewedRenders()).toEqual(ids);
    for (const invalid of [
      "broken JSON",
      JSON.stringify(["sentinel-script-secret"]),
      JSON.stringify({ ids: [...ids], script: "sentinel-script-secret" }),
    ]) {
      localStorage.setItem("studynarrator.viewed-renders.v1", invalid);
      expect(readViewedRenders()).toEqual(new Set());
    }
  });
  it("keeps storage failures out of the render workflow", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("sentinel-private-path");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("sentinel-private-path");
    });
    expect(readViewedRenders()).toEqual(new Set());
    expect(() => storeViewedRenders(new Set())).not.toThrow();
  });
});
