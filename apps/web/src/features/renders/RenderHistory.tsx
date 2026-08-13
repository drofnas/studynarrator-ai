import { useEffect, useMemo, useState } from "react";
import type {
  RenderArtifact,
  RenderClient,
  RenderHistorySegment,
  RenderJob,
  RenderWaveform,
  VoiceCatalog
} from "@studynarrator/shared-types";
import { SharedAudioPlayer } from "@/shared/audio/SharedAudioPlayer.js";
import styles from "./RenderHistory.module.css";

const PAGE_SIZE = 100;

interface ReviewDetails {
  loading: boolean;
  error: string;
  artifacts: RenderArtifact[];
  segments: RenderHistorySegment[];
  waveform: RenderWaveform | null;
  visibleSegments: number;
}

interface PlaybackSelection {
  key: string;
  label: string;
  src: string;
  waveform?: RenderWaveform;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Render review could not be loaded.";
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  const totalSeconds = Math.round(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1_024) return `${String(bytes)} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function RenderHistory({
  jobs,
  expandedJob,
  client,
  onExpand,
  onCancel,
  onRetry,
  onRerender,
  onSourceLine,
  onNotice,
  onError,
  voiceCatalog
}: {
  jobs: RenderJob[];
  expandedJob: RenderJob | undefined;
  client: RenderClient;
  onExpand: (job: RenderJob | undefined) => void;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
  onRerender: (job: RenderJob) => Promise<void>;
  onSourceLine: (line: number) => void;
  onNotice: (notice: string) => void;
  onError: (error: string) => void;
  voiceCatalog: VoiceCatalog | null;
}) {
  const [reviews, setReviews] = useState<Record<string, ReviewDetails>>({});
  const [playback, setPlayback] = useState<PlaybackSelection>();
  const expandedId = expandedJob?.id;
  const review = expandedId ? reviews[expandedId] : undefined;

  useEffect(() => {
    if (!expandedJob) return;
    let active = true;
    setReviews((current) => ({ ...current, [expandedJob.id]: {
      loading: true,
      error: "",
      artifacts: current[expandedJob.id]?.artifacts ?? [],
      segments: current[expandedJob.id]?.segments ?? [],
      waveform: current[expandedJob.id]?.waveform ?? null,
      visibleSegments: current[expandedJob.id]?.visibleSegments ?? PAGE_SIZE
    } }));
    void Promise.all([
      client.listArtifacts(expandedJob.id),
      client.listSegments(expandedJob.id),
      client.getWaveform(expandedJob.id)
    ]).then(([artifacts, segments, waveform]) => {
      if (!active) return;
      setReviews((current) => ({ ...current, [expandedJob.id]: {
        loading: false,
        error: "",
        artifacts,
        segments,
        waveform,
        visibleSegments: current[expandedJob.id]?.visibleSegments ?? PAGE_SIZE
      } }));
    }).catch((error: unknown) => {
      if (!active) return;
      setReviews((current) => ({ ...current, [expandedJob.id]: {
        loading: false,
        error: errorMessage(error),
        artifacts: [],
        segments: [],
        waveform: null,
        visibleSegments: PAGE_SIZE
      } }));
    });
    return () => { active = false; };
  }, [client, expandedJob?.id, expandedJob?.state]);

  useEffect(() => { setPlayback(undefined); }, [expandedId]);

  const speechModel = useMemo(() => review?.segments.find((segment) => segment.type === "speech")?.modelId ?? null, [review?.segments]);
  if (jobs.length === 0) return <p>No render jobs yet.</p>;

  const copy = async (label: "Readable text" | "TTS text", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      onNotice(`${label} copied.`);
    } catch (error) { onError(errorMessage(error)); }
  };

  return <div className={styles.history} aria-label="Saved renders">
    {jobs.map((job) => {
      const expanded = job.id === expandedId;
      const jobReview = expanded ? review : reviews[job.id];
      const mp3 = jobReview?.artifacts.find(({ type }) => type === "mp3");
      const unavailableSpeech = jobReview?.segments.some((segment) => segment.type === "speech" && segment.audio.status === "unavailable") ?? false;
      const panelId = `render-review-${job.id}`;
      return <article className={styles.entry} data-state={job.state} key={job.id}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => onExpand(expanded ? undefined : job)}
        >
          <span><strong>{new Date(job.createdAt).toLocaleString()}</strong><small>{job.id}</small></span>
          <span className={styles.state}>{job.state.replaceAll("_", " ")}</span>
          <span>{job.progress.completedChunks}/{job.progress.totalChunks} chunks</span>
          <span>{job.progress.cacheHits} hits · {job.progress.cacheMisses} misses · {job.progress.ttsRequests} requests</span>
          <b aria-hidden="true">{expanded ? "−" : "+"}</b>
        </button>
        {expanded ? <div className={styles.review} id={panelId}>
          <div className={styles.summary} aria-label="Render summary">
            <span><small>State</small><strong>{job.state.replaceAll("_", " ")}</strong></span>
            <span><small>Duration</small><strong>{formatDuration(mp3?.durationMs ?? null)}</strong></span>
            <span><small>Size</small><strong>{formatBytes(mp3?.sizeBytes ?? null)}</strong></span>
            <span><small>Model</small><code title={speechModel ?? undefined}>{speechModel ?? (jobReview?.loading ? "Loading…" : "No speech model")}</code></span>
            <span><small>Elapsed</small><strong>{(job.progress.elapsedMs / 1_000).toFixed(1)} s</strong></span>
          </div>
          <p className={styles.progress} aria-live="polite"><strong>Phase: {job.state.replaceAll("_", " ")}</strong> · {job.progress.sectionTitle ?? "No active section"} · speech {job.progress.speechOrdinal}/{job.progress.speechCount} · {job.progress.voiceId ?? "no active voice"}</p>
          {job.progress.excerpt ? <blockquote>{job.progress.excerpt}</blockquote> : null}
          {job.error ? <p className={styles.error} role="alert"><strong>{job.error.code}</strong> — {job.error.message}{job.error.entryOrdinal ? ` Entry ${String(job.error.entryOrdinal)}.` : ""}</p> : null}
          <div className={styles.actions}>
            {!(["complete", "failed", "canceled"] as string[]).includes(job.state) ? <button type="button" className={styles.danger} onClick={() => void onCancel()}>Cancel render</button> : null}
            {job.state === "failed" ? <button type="button" onClick={() => void onRetry()}>Retry render</button> : null}
            {job.state === "complete" && mp3 ? <button type="button" onClick={() => setPlayback({ key: job.id, label: `Completed render from ${new Date(job.createdAt).toLocaleString()}`, src: client.renderAudioSource(job.id), ...(jobReview?.waveform ? { waveform: jobReview.waveform } : {}) })}>Play completed render</button> : null}
            {(unavailableSpeech || (job.state === "complete" && !mp3)) ? <button type="button" onClick={() => void onRerender(job)}>Rerender this frozen plan</button> : null}
          </div>
          {jobReview?.loading ? <p role="status">Loading render review…</p> : null}
          {jobReview?.error ? <p className={styles.error} role="alert">{jobReview.error}</p> : null}
          {jobReview?.waveform?.status === "unavailable" && mp3 ? <p className={styles.waveformNote}>Waveform unavailable; the seek slider remains available.</p> : null}
          {playback ? <SharedAudioPlayer key={playback.key} label={playback.label} src={playback.src} {...(playback.waveform ? { waveform: playback.waveform } : {})} /> : null}
          {jobReview && jobReview.segments.length > 0 ? <section className={styles.segments} aria-label="Render segments">
            <header><div><span>Exact review</span><h5>Ordered segments</h5></div><b>{jobReview.segments.length}</b></header>
            <div className={styles.segmentList} aria-label="Ordered segment rows">
              {jobReview.segments.slice(0, jobReview.visibleSegments).map((segment) => <article className={styles.segment} data-type={segment.type} key={segment.ordinal}>
                <span className={styles.ordinal}>{String(segment.ordinal).padStart(3, "0")}</span>
                <div className={styles.segmentIdentity}>
                  <strong>{segment.type === "section" ? segment.title : segment.type === "pause" ? `${segment.pauseKind} pause` : `${segment.speakerLabel} · ${voiceCatalog?.modelId === segment.modelId ? voiceCatalog.entries.find(({ voiceId }) => voiceId === segment.voiceId)?.label ?? segment.voiceId : segment.voiceId}`}</strong>
                  <small>{segment.sectionTitle ?? "Untitled section"} · {segment.state}{segment.cacheStatus ? ` · cache ${segment.cacheStatus}` : ""}</small>
                  {segment.type === "speech" ? <code title={`Voice ID: ${segment.voiceId}`}>{segment.voiceId}</code> : null}
                </div>
                <p>{segment.type === "speech" ? segment.readableText : segment.type === "pause" ? `${String(segment.durationMs)} ms · ${segment.reason}` : "Section marker"}</p>
                <span className={styles.segmentDuration}>{formatDuration(segment.audioDurationMs)}</span>
                <div className={styles.segmentActions}>
                  {segment.sourceRange ? <button type="button" onClick={() => onSourceLine(segment.sourceRange!.start.line)}>Source line {segment.sourceRange.start.line}</button> : null}
                  {segment.type === "speech" ? <>
                    <button type="button" onClick={() => void copy("Readable text", segment.readableText)}>Copy readable</button>
                    <button type="button" onClick={() => void copy("TTS text", segment.ttsText)}>Copy TTS</button>
                    {segment.audio.status === "available" ? <>
                      <button type="button" onClick={() => setPlayback({ key: `${job.id}:${String(segment.ordinal)}`, label: `${segment.speakerLabel} · segment ${String(segment.ordinal)}`, src: client.segmentAudioSource(job.id, segment.ordinal) })}>Play segment {segment.ordinal}</button>
                      <button type="button" onClick={() => void client.exportSegment(job.id, segment.ordinal).catch((error: unknown) => onError(errorMessage(error)))}>{window.studyNarrator ? "Save segment" : "Download segment"}</button>
                    </> : <span className={styles.unavailable}>No review audio is available; this row has no retained synthesis media.</span>}
                  </> : <span className={styles.unavailable}>This plan row does not synthesize or export audio.</span>}
                </div>
              </article>)}
            </div>
            {jobReview.visibleSegments < jobReview.segments.length ? <button type="button" className={styles.loadMore} onClick={() => setReviews((current) => ({ ...current, [job.id]: { ...current[job.id]!, visibleSegments: current[job.id]!.visibleSegments + PAGE_SIZE } }))}>Load 100 more segments</button> : null}
          </section> : null}
          {jobReview && jobReview.artifacts.length > 0 ? <ul className={styles.artifacts} aria-label="Render artifacts">{jobReview.artifacts.map((artifact) => <li key={artifact.id}><span><strong>{artifact.fileName}</strong><small>{artifact.type} · {formatBytes(artifact.sizeBytes)}</small></span><button type="button" onClick={() => void client.exportArtifact(artifact.id).catch((error: unknown) => onError(errorMessage(error)))}>{window.studyNarrator ? "Save As" : "Download"}</button></li>)}</ul> : null}
        </div> : null}
      </article>;
    })}
  </div>;
}
