import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ScratchpadPreviewResult } from "@studynarrator/shared-types";

interface ScratchpadSessionResult {
  result: ScratchpadPreviewResult;
  audioUrl: string;
}

interface ScratchpadSession {
  active: ScratchpadSessionResult | null;
  replace(result: ScratchpadPreviewResult): void;
}

const Context = createContext<ScratchpadSession | null>(null);

function audioUrl(result: ScratchpadPreviewResult): string {
  const binary = atob(result.audio.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: result.audio.mimeType }));
}

export function ScratchpadSessionProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ScratchpadSessionResult | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => () => {
    if (activeRef.current) URL.revokeObjectURL(activeRef.current.audioUrl);
  }, []);

  const replace = useCallback((result: ScratchpadPreviewResult) => {
    const next = { result, audioUrl: audioUrl(result) };
    setActive((current) => {
      if (current) URL.revokeObjectURL(current.audioUrl);
      return next;
    });
  }, []);

  const value = useMemo<ScratchpadSession>(() => ({
    active,
    replace
  }), [active, replace]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useScratchpadSession(): ScratchpadSession {
  const value = useContext(Context);
  if (!value) throw new Error("ScratchpadSessionProvider is missing.");
  return value;
}
