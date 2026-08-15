import { useEffect, useState } from "react";
import type { ProjectPreviewResult } from "@studynarrator/shared-types";
import { SharedAudioPlayer } from "@/shared/audio/SharedAudioPlayer.js";
import styles from "./PreviewResultCard.module.css";

function createAudioUrl(result: ProjectPreviewResult): string {
  const binary = atob(result.audio.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: result.audio.mimeType }));
}

export function PreviewResultCard({ result }: { result: ProjectPreviewResult }) {
  const [audioUrl, setAudioUrl] = useState("");
  useEffect(() => {
    const next = createAudioUrl(result);
    setAudioUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [result]);
  return <section className={styles.result} aria-label="Project preview result">
    <header><div><span>Audible preview</span><h3>{result.mode === "segment" ? `Segment ${String(result.nodeOrdinal)}` : "Pronunciation sample"}</h3></div><strong data-state={result.cache.status}>Cache {result.cache.status}</strong></header>
    <div className={styles.identity}><strong>{result.voiceLabel}</strong><code>{result.voiceId}</code><span>{result.modelId} · {String(result.speed)}× · {result.audio.byteLength.toLocaleString()} bytes</span></div>
    <div className={styles.projections}><article><span>Original</span><p>{result.originalText}</p></article><article><span>Readable</span><p>{result.readableText}</p></article><article><span>TTS text</span><p>{result.transformedText}</p></article></div>
    {audioUrl ? <SharedAudioPlayer label={`${result.voiceLabel} · ${result.voiceId}`} src={audioUrl} /> : null}
    <footer><code>{result.cache.key}</code></footer>
  </section>;
}
