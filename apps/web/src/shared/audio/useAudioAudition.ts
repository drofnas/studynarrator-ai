import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditionPhase } from "./AuditionIcon.js";

interface AuditionAudio {
  base64: string;
}

interface AudioAuditionState<Key extends string | number> {
  key: Key;
  phase: Exclude<AuditionPhase, "normal">;
}

function decodedAudio(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function useAudioAudition<Key extends string | number>() {
  const [audition, setAudition] = useState<AudioAuditionState<Key> | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const generationRef = useRef(0);

  const stop = useCallback((resetState = true) => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try {
        sourceRef.current.stop();
      } catch {
        /* The source may not have started yet. */
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (contextRef.current) {
      void contextRef.current.close().catch(() => undefined);
      contextRef.current = null;
    }
    if (resetState) setAudition(null);
  }, []);

  useEffect(
    () => () => {
      stop(false);
    },
    [stop],
  );

  const play = useCallback(
    async (key: Key, load: (signal: AbortSignal) => Promise<AuditionAudio>) => {
      stop();
      const generation = generationRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const context = new AudioContext();
        contextRef.current = context;
        await context.resume();
        if (controller.signal.aborted || generation !== generationRef.current)
          return;
        setAudition({ key, phase: "processing" });
        const audio = await load(controller.signal);
        if (controller.signal.aborted || generation !== generationRef.current)
          return;
        const buffer = await context.decodeAudioData(
          decodedAudio(audio.base64),
        );
        if (controller.signal.aborted || generation !== generationRef.current)
          return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        sourceRef.current = source;
        source.onended = () => {
          if (generation !== generationRef.current) return;
          source.disconnect();
          sourceRef.current = null;
          contextRef.current = null;
          abortRef.current = null;
          setAudition(null);
          void context.close().catch(() => undefined);
        };
        setAudition({ key, phase: "playing" });
        source.start();
      } catch (error) {
        if (controller.signal.aborted || generation !== generationRef.current)
          return;
        stop();
        throw error;
      }
    },
    [stop],
  );

  return { audition, play, stop };
}
