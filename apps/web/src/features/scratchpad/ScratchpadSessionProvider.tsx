import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ScratchpadPreviewResult } from "@studynarrator/shared-types";

export interface ScratchpadSessionResult {
  result: ScratchpadPreviewResult;
  audioUrl: string;
}

interface ScratchpadSession {
  results: ScratchpadSessionResult[];
  active: ScratchpadSessionResult | null;
  add(result: ScratchpadPreviewResult): void;
  select(id: string): void;
  clear(): void;
}

const Context = createContext<ScratchpadSession | null>(null);

function audioUrl(result: ScratchpadPreviewResult): string {
  const binary = atob(result.audio.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: result.audio.mimeType }));
}

export function ScratchpadSessionProvider({ children }: { children: ReactNode }) {
  const [results, setResults] = useState<ScratchpadSessionResult[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const resultsRef = useRef(results);
  resultsRef.current = results;

  useEffect(() => () => {
    for (const item of resultsRef.current) URL.revokeObjectURL(item.audioUrl);
  }, []);

  const add = useCallback((result: ScratchpadPreviewResult) => {
    const next = { result, audioUrl: audioUrl(result) };
    setResults((current) => {
      const retained = [next, ...current].slice(0, 5);
      for (const removed of [next, ...current].slice(5)) URL.revokeObjectURL(removed.audioUrl);
      return retained;
    });
    setActiveId(result.id);
  }, []);

  const clear = useCallback(() => {
    setResults((current) => {
      for (const item of current) URL.revokeObjectURL(item.audioUrl);
      return [];
    });
    setActiveId(null);
  }, []);

  const value = useMemo<ScratchpadSession>(() => ({
    results,
    active: results.find(({ result }) => result.id === activeId) ?? results[0] ?? null,
    add,
    select: setActiveId,
    clear
  }), [activeId, add, clear, results]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useScratchpadSession(): ScratchpadSession {
  const value = useContext(Context);
  if (!value) throw new Error("ScratchpadSessionProvider is missing.");
  return value;
}
