// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readStoredSpeakerSort,
  SPEAKER_SORT_STORAGE_KEY,
  sortSpeakerRows,
  useSortedSpeakers,
} from "./speakerSort.js";

const row = (speakerId: string, displayName: string, discovered = true) => ({
  speakerId,
  displayName,
  discovered,
});

const ids = (rows: ReadonlyArray<{ speakerId: string }>) =>
  rows.map(({ speakerId }) => speakerId);

describe("sortSpeakerRows", () => {
  const scriptOrder = [
    row("teacher", "Teacher"),
    row("student", "student"),
    row("old", "Archived", false),
    row("coach", "Coach"),
    row("zeta", "Zeta", false),
    row("alpha", "alpha", false),
  ];

  it("sorts discovered then undiscovered speakers by case-insensitive name", () => {
    const input = [...scriptOrder];

    const sorted = sortSpeakerRows(input, "name");

    expect(ids(sorted)).toEqual([
      "coach",
      "student",
      "teacher",
      "alpha",
      "old",
      "zeta",
    ]);
    expect(input).toEqual(scriptOrder);
  });

  it("keeps script order with undiscovered speakers last", () => {
    expect(ids(sortSpeakerRows(scriptOrder, "script"))).toEqual([
      "teacher",
      "student",
      "coach",
      "old",
      "zeta",
      "alpha",
    ]);
  });

  it("breaks name ties by speaker ID and compares numbers numerically", () => {
    const rows = [
      row("b", "Same"),
      row("a", " same "),
      row("s10", "Speaker 10"),
      row("s2", "Speaker 2"),
    ];

    expect(ids(sortSpeakerRows(rows, "name"))).toEqual(["a", "b", "s2", "s10"]);
  });
});

describe("speaker sort preference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("defaults to name, restores script order, and survives blocked storage", () => {
    expect(readStoredSpeakerSort()).toBe("name");
    window.localStorage.setItem(SPEAKER_SORT_STORAGE_KEY, "script");
    expect(readStoredSpeakerSort()).toBe("script");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredSpeakerSort()).toBe("name");
  });

  it("stores the chosen mode and keeps working when storage writes fail", () => {
    const rows = [row("b", "Bravo"), row("a", "Alpha")];
    const { result } = renderHook(() => useSortedSpeakers(rows));
    expect(ids(result.current.displayedSpeakers)).toEqual(["a", "b"]);

    act(() => result.current.setSpeakerSort("script"));
    expect(ids(result.current.displayedSpeakers)).toEqual(["b", "a"]);
    expect(window.localStorage.getItem(SPEAKER_SORT_STORAGE_KEY)).toBe(
      "script",
    );

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => result.current.setSpeakerSort("name"));
    expect(result.current.speakerSort).toBe("name");
  });

  it("freezes the visible order during a rename and re-sorts afterwards", () => {
    let rows = [row("a", "Alpha"), row("b", "Bravo")];
    const { result, rerender } = renderHook(() => useSortedSpeakers(rows));

    act(() => result.current.beginSpeakerNameEdit());
    rows = [row("a", "Zulu"), row("b", "Bravo"), row("c", "Charlie")];
    rerender();
    expect(ids(result.current.displayedSpeakers)).toEqual(["a", "b", "c"]);

    act(() => result.current.endSpeakerNameEdit());
    expect(ids(result.current.displayedSpeakers)).toEqual(["b", "c", "a"]);
  });
});
