export type AuditionPhase = "normal" | "processing" | "playing";

export function AuditionIcon({ phase }: { phase: AuditionPhase }) {
  if (phase === "processing") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 3a9 9 0 1 1-8.3 5.5" />
      </svg>
    );
  }
  if (phase === "playing") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M7 9v6M12 6v12M17 9v6" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8 5.75v12.5L18 12 8 5.75Z" />
    </svg>
  );
}
