import { describe, expect, it } from "vitest";
import { parseRenderMediaRange } from "./renderMedia.js";

describe("render media ranges", () => {
  it("accepts full, bounded, open-ended, and suffix requests", () => {
    expect(parseRenderMediaRange(undefined, 100)).toEqual({
      status: "full",
      start: 0,
      end: 99,
    });
    expect(parseRenderMediaRange("bytes=10-19", 100)).toEqual({
      status: "partial",
      start: 10,
      end: 19,
    });
    expect(parseRenderMediaRange("bytes=90-", 100)).toEqual({
      status: "partial",
      start: 90,
      end: 99,
    });
    expect(parseRenderMediaRange("bytes=-10", 100)).toEqual({
      status: "partial",
      start: 90,
      end: 99,
    });
  });

  it.each([
    "bytes=",
    "items=0-1",
    "bytes=100-101",
    "bytes=20-10",
    "bytes=0-1,5-6",
  ])("rejects unsupported range %s", (header) =>
    expect(parseRenderMediaRange(header, 100)).toEqual({
      status: "unsatisfiable",
    }),
  );
});
