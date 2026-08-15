export interface ResolvedRenderMedia {
  path: string;
  fileName: string;
  mimeType: "audio/mpeg" | "audio/wav";
  sizeBytes: number;
}

type RenderMediaRange =
  | { status: "full"; start: 0; end: number }
  | { status: "partial"; start: number; end: number }
  | { status: "unsatisfiable" };

export function parseRenderMediaRange(header: string | undefined, sizeBytes: number): RenderMediaRange {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) return { status: "unsatisfiable" };
  if (header === undefined) return { status: "full", start: 0, end: sizeBytes - 1 };
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return { status: "unsatisfiable" };
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return { status: "unsatisfiable" };
    return { status: "partial", start: Math.max(0, sizeBytes - suffix), end: sizeBytes - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : sizeBytes - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= sizeBytes || requestedEnd < start) {
    return { status: "unsatisfiable" };
  }
  return { status: "partial", start, end: Math.min(requestedEnd, sizeBytes - 1) };
}
