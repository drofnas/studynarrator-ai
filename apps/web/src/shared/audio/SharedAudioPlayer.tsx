import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { RenderWaveform } from "@studynarrator/shared-types";
import styles from "./SharedAudioPlayer.module.css";

type PlaybackState = "loading" | "ready" | "playing" | "paused" | "complete" | "unavailable";

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function stateLabel(state: PlaybackState): string {
  if (state === "complete") return "Playback complete";
  if (state === "unavailable") return "Playback unavailable";
  return `${state[0]?.toUpperCase() ?? ""}${state.slice(1)}`;
}

export function SharedAudioPlayer({ label, src, waveform }: {
  label: string;
  src: string;
  waveform?: RenderWaveform | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<PlaybackState>("loading");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const availableWaveform = waveform?.status === "available" ? waveform : null;
  const effectiveDuration = duration || (availableWaveform?.durationMs ?? 0) / 1_000;
  const waveformPath = useMemo(() => {
    if (!availableWaveform?.peaks.length) return "";
    const count = availableWaveform.peaks.length;
    const top = availableWaveform.peaks.map((peak, index) => {
      const x = count === 1 ? 50 : index / (count - 1) * 100;
      return `${x.toFixed(3)},${(50 - peak / 255 * 46).toFixed(3)}`;
    });
    const bottom = [...availableWaveform.peaks].reverse().map((peak, reverseIndex) => {
      const index = count - reverseIndex - 1;
      const x = count === 1 ? 50 : index / (count - 1) * 100;
      return `${x.toFixed(3)},${(50 + peak / 255 * 46).toFixed(3)}`;
    });
    return `M ${[...top, ...bottom].join(" L ")} Z`;
  }, [availableWaveform]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    setState("loading");
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const seek = (next: number) => {
    const bounded = Math.max(0, Math.min(effectiveDuration, next));
    if (audioRef.current) audioRef.current.currentTime = bounded;
    setCurrentTime(bounded);
    if (state === "complete" && bounded < effectiveDuration) setState("paused");
  };
  const play = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (state === "complete") seek(0);
    try { await audio.play(); } catch { setState("unavailable"); }
  };
  const pause = () => audioRef.current?.pause();
  const stop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    seek(0);
    setState("ready");
  };
  const replay = async () => {
    seek(0);
    await play();
  };
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
  };
  const seekByKeyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    const jumps: Partial<Record<string, number>> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 };
    const jump = jumps[event.key];
    if (jump !== undefined) {
      event.preventDefault();
      seek(currentTime + jump);
    } else if (event.key === "Home") {
      event.preventDefault();
      seek(0);
    } else if (event.key === "End") {
      event.preventDefault();
      seek(effectiveDuration);
    }
  };
  const seekByPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (effectiveDuration <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    seek((event.clientX - bounds.left) / bounds.width * effectiveDuration);
  };

  return (
    <section className={styles.player} aria-label={`Audio player for ${label}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration); setState("ready"); }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setState("playing")}
        onPause={() => setState((current) => current === "complete" || current === "loading" || current === "unavailable" ? current : "paused")}
        onEnded={() => { setCurrentTime(audioRef.current?.duration ?? effectiveDuration); setState("complete"); }}
        onError={() => setState("unavailable")}
      />
      <div className={styles.identity}><span>Loaded audio</span><strong>{label}</strong></div>
      <div className={styles.transport}>
        {state === "playing"
          ? <button type="button" onClick={pause}>Pause</button>
          : <button type="button" onClick={() => void play()} disabled={state === "loading" || state === "unavailable"}>Play</button>}
        <button type="button" className={styles.secondary} onClick={stop} disabled={state === "loading" || state === "unavailable"}>Stop</button>
        <button type="button" className={styles.secondary} onClick={() => void replay()} disabled={state === "loading" || state === "unavailable"}>Replay</button>
      </div>
      <div className={styles.signal} role="group" aria-label={availableWaveform ? "Playback waveform" : "Playback progress"} onPointerDown={seekByPointer}>
        {availableWaveform
          ? <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none"><path d={waveformPath} /></svg>
          : <span className={styles.fallback}><i style={{ width: `${String(effectiveDuration > 0 ? Math.min(100, currentTime / effectiveDuration * 100) : 0)}%` }} /></span>}
        <input
          aria-label="Seek playback"
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(effectiveDuration)}`}
          type="range"
          min="0"
          max={effectiveDuration || 0}
          step="0.01"
          value={Math.min(currentTime, effectiveDuration || 0)}
          disabled={effectiveDuration <= 0 || state === "unavailable"}
          onChange={(event) => seek(Number(event.target.value))}
          onKeyDown={seekByKeyboard}
        />
        <span className={styles.played} style={{ width: `${String(effectiveDuration > 0 ? Math.min(100, currentTime / effectiveDuration * 100) : 0)}%` }} aria-hidden="true" />
      </div>
      <div className={styles.timeline} aria-label="Playback time"><span>{formatTime(currentTime)}</span><span>{formatTime(effectiveDuration)}</span></div>
      <div className={styles.volume}>
        <button type="button" className={styles.secondary} onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
        <label>Volume<input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (audioRef.current) audioRef.current.volume = next; }} /></label>
      </div>
      <p className={styles.state} role="status" aria-live="polite">{stateLabel(state)}</p>
    </section>
  );
}
