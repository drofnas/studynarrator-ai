import { useCallback, useMemo, useState } from "react";

export type SpeakerSortMode = "name" | "script";

export const SPEAKER_SORT_STORAGE_KEY =
  "studynarrator.project-speakers.sort.v1";

interface SortableSpeaker {
  speakerId: string;
  displayName: string;
  discovered: boolean;
}

const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function compareByName(left: SortableSpeaker, right: SortableSpeaker): number {
  const byName = collator.compare(
    left.displayName.trim(),
    right.displayName.trim(),
  );
  if (byName !== 0) return byName;
  if (left.speakerId === right.speakerId) return 0;
  return left.speakerId < right.speakerId ? -1 : 1;
}

/**
 * Returns a display-only ordering. Discovered speakers always precede speakers
 * that are only saved mappings. "script" keeps the reconciled first-appearance
 * order; "name" sorts each group by display name, then speaker ID.
 */
export function sortSpeakerRows<T extends SortableSpeaker>(
  rows: readonly T[],
  mode: SpeakerSortMode,
): T[] {
  const discovered = rows.filter((row) => row.discovered);
  const undiscovered = rows.filter((row) => !row.discovered);
  if (mode === "name") {
    discovered.sort(compareByName);
    undiscovered.sort(compareByName);
  }
  return [...discovered, ...undiscovered];
}

export function readStoredSpeakerSort(): SpeakerSortMode {
  try {
    return window.localStorage.getItem(SPEAKER_SORT_STORAGE_KEY) === "script"
      ? "script"
      : "name";
  } catch {
    return "name";
  }
}

function storeSpeakerSort(mode: SpeakerSortMode): void {
  try {
    window.localStorage.setItem(SPEAKER_SORT_STORAGE_KEY, mode);
  } catch {
    // The in-memory preference still applies when browser storage is blocked.
  }
}

/**
 * Sorts speaker rows for display and freezes the visible order while a name
 * is being edited so the focused row never moves under the cursor.
 */
export function useSortedSpeakers<T extends SortableSpeaker>(
  rows: readonly T[],
) {
  const [speakerSort, setSpeakerSortState] = useState<SpeakerSortMode>(
    readStoredSpeakerSort,
  );
  const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
  const sorted = useMemo(
    () => sortSpeakerRows(rows, speakerSort),
    [rows, speakerSort],
  );
  const displayedSpeakers = useMemo(() => {
    if (!frozenOrder) return sorted;
    const position = new Map(frozenOrder.map((id, index) => [id, index]));
    const known = sorted.filter((row) => position.has(row.speakerId));
    known.sort(
      (left, right) =>
        (position.get(left.speakerId) ?? 0) -
        (position.get(right.speakerId) ?? 0),
    );
    return [...known, ...sorted.filter((row) => !position.has(row.speakerId))];
  }, [frozenOrder, sorted]);
  const setSpeakerSort = useCallback((mode: SpeakerSortMode) => {
    setFrozenOrder(null);
    setSpeakerSortState(mode);
    storeSpeakerSort(mode);
  }, []);
  const beginSpeakerNameEdit = useCallback(() => {
    setFrozenOrder(displayedSpeakers.map(({ speakerId }) => speakerId));
  }, [displayedSpeakers]);
  const endSpeakerNameEdit = useCallback(() => setFrozenOrder(null), []);
  return {
    speakerSort,
    setSpeakerSort,
    displayedSpeakers,
    beginSpeakerNameEdit,
    endSpeakerNameEdit,
  };
}
