import { useEffect, useRef, useState } from "react";
import styles from "./BasicAudioPlayer.module.css";

type PlaybackState = "loading" | "ready" | "playing" | "paused" | "complete";

function time(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

export function BasicAudioPlayer({ label, src }: { label: string; src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<PlaybackState>("loading");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    setState("loading");
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const play = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (state === "complete") audio.currentTime = 0;
    await audio.play();
  };
  const pause = () => audioRef.current?.pause();
  const replay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    await audio.play();
  };
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
  };

  return (
    <section className={styles.player} aria-label={`Audio player for ${label}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration); setState("ready"); }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setState("playing")}
        onPause={() => setState((current) => current === "complete" || current === "loading" ? current : "paused")}
        onEnded={() => { setCurrentTime(audioRef.current?.duration ?? duration); setState("complete"); }}
      />
      <div className={styles.identity}><span>Loaded result</span><strong>{label}</strong></div>
      <div className={styles.transport}>
        {state === "playing"
          ? <button type="button" onClick={pause}>Pause</button>
          : <button type="button" onClick={() => void play()} disabled={state === "loading"}>Play</button>}
        <button type="button" className={styles.secondary} onClick={() => void replay()} disabled={state === "loading"}>Replay</button>
      </div>
      <div className={styles.timeline} aria-label="Playback time">
        <span>{time(currentTime)}</span><div><i style={{ width: `${String(duration > 0 ? Math.min(100, currentTime / duration * 100) : 0)}%` }} /></div><span>{time(duration)}</span>
      </div>
      <div className={styles.volume}>
        <button type="button" className={styles.secondary} onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
        <label>Volume<input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (audioRef.current) audioRef.current.volume = next; }} /></label>
      </div>
      <p className={styles.state} role="status" aria-live="polite">{state === "complete" ? "Playback complete" : state[0]?.toUpperCase() + state.slice(1)}</p>
    </section>
  );
}
