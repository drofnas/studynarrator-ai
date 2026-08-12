import {
  LEXICON_TRANSFORM_VERSION,
  TransformScriptInputSchema,
  TransformScriptResultSchema,
  type LexiconEntry,
  type LexiconMatchAudit,
  type PronunciationAnnotation,
  type SourceRange,
  type TransformDiagnostic,
  type TransformScriptInput,
  type TransformScriptResult
} from "./schemas.js";

interface ReadableProjection {
  text: string;
  sourceStarts: number[];
  sourceEnds: number[];
  annotations: Array<{
    annotation: PronunciationAnnotation;
    readableStart: number;
    readableEnd: number;
    sourceStartOffset: number;
    sourceEndOffset: number;
  }>;
}

interface ReplacementEvent {
  readableStart: number;
  readableEnd: number;
  replacement: string;
  audit?: LexiconMatchAudit;
}

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function sourceLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length;) {
    if (source[index] === "\r" && source[index + 1] === "\n") {
      starts.push(index + 2);
      index += 2;
      continue;
    }
    if (source[index] === "\r" || source[index] === "\n") starts.push(index + 1);
    index += 1;
  }
  return starts;
}

function rangeFromOffsets(lineStarts: number[], startOffset: number, endOffset: number): SourceRange {
  function position(offset: number) {
    let lineIndex = 0;
    while (lineIndex + 1 < lineStarts.length && (lineStarts[lineIndex + 1] ?? Infinity) <= offset) lineIndex += 1;
    return { line: lineIndex + 1, column: offset - (lineStarts[lineIndex] ?? 0) + 1 };
  }
  return { start: position(startOffset), end: position(endOffset) };
}

function codePointBefore(value: string, index: number): string {
  if (index <= 0) return "";
  const previous = value.charCodeAt(index - 1);
  if (previous >= 0xdc00 && previous <= 0xdfff && index >= 2) return value.slice(index - 2, index);
  return value.slice(index - 1, index);
}

function codePointAt(value: string, index: number): string {
  if (index >= value.length) return "";
  const point = value.codePointAt(index);
  return point === undefined ? "" : String.fromCodePoint(point);
}

function hasWholeWordBoundaries(value: string, start: number, end: number): boolean {
  return !WORD_CHARACTER.test(codePointBefore(value, start)) && !WORD_CHARACTER.test(codePointAt(value, end));
}

function sameText(left: string, right: string, caseSensitive: boolean): boolean {
  return caseSensitive ? left === right : left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

function entryMatchesAt(entry: LexiconEntry, text: string, index: number): boolean {
  const candidate = text.slice(index, index + entry.displayText.length);
  if (!sameText(candidate, entry.displayText, entry.caseSensitive)) return false;
  return !entry.wholeWord || hasWholeWordBoundaries(text, index, index + entry.displayText.length);
}

function ordinaryRank(entry: LexiconEntry): number {
  if (entry.scope === "project" && entry.entryType === "exactPhrase") return 0;
  if (entry.scope === "global" && entry.entryType === "exactPhrase") return 1;
  if (entry.scope === "project" && entry.entryType === "exactTerm") return 2;
  return 3;
}

function compareOrdinary(left: LexiconEntry, right: LexiconEntry): number {
  return ordinaryRank(left) - ordinaryRank(right)
    || right.priority - left.priority
    || right.displayText.length - left.displayText.length
    || left.id.localeCompare(right.id, "en-US");
}

function compareNamed(left: LexiconEntry, right: LexiconEntry): number {
  return (left.scope === right.scope ? 0 : left.scope === "project" ? -1 : 1)
    || right.priority - left.priority
    || left.id.localeCompare(right.id, "en-US");
}

function projectReadableText(
  rawText: string,
  nodeStartOffset: number,
  nodeStartColumn: number,
  annotations: PronunciationAnnotation[]
): ReadableProjection {
  let text = "";
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  const projectedAnnotations: ReadableProjection["annotations"] = [];
  const orderedAnnotations = [...annotations].sort((left, right) => left.range.start.column - right.range.start.column);
  let annotationIndex = 0;

  function appendPlain(start: number, end: number): void {
    for (let index = start; index < end;) {
      if (rawText[index] === "\\" && (rawText[index + 1] === "[" || rawText.startsWith("{{", index + 1))) {
        index += 1;
      }
      sourceStarts[text.length] = nodeStartOffset + index;
      sourceEnds[text.length] = nodeStartOffset + index + 1;
      text += rawText[index] ?? "";
      index += 1;
    }
  }

  let cursor = 0;
  while (cursor < rawText.length) {
    const annotation = orderedAnnotations[annotationIndex];
    if (!annotation) {
      appendPlain(cursor, rawText.length);
      break;
    }
    const relativeStart = annotation.range.start.column - nodeStartColumn;
    const relativeEnd = annotation.range.end.column - nodeStartColumn;
    appendPlain(cursor, relativeStart);
    const readableStart = text.length;
    const displayStart = relativeStart + 2;
    for (let index = 0; index < annotation.displayText.length; index += 1) {
      sourceStarts[text.length] = nodeStartOffset + displayStart + index;
      sourceEnds[text.length] = nodeStartOffset + displayStart + index + 1;
      text += annotation.displayText[index] ?? "";
    }
    projectedAnnotations.push({
      annotation,
      readableStart,
      readableEnd: text.length,
      sourceStartOffset: nodeStartOffset + displayStart,
      sourceEndOffset: nodeStartOffset + displayStart + annotation.displayText.length
    });
    cursor = relativeEnd;
    annotationIndex += 1;
  }
  return { text, sourceStarts, sourceEnds, annotations: projectedAnnotations };
}

function auditFor(
  entry: LexiconEntry,
  originalText: string,
  nodeOrdinal: number,
  sourceStartOffset: number,
  sourceEndOffset: number,
  lineStarts: number[]
): LexiconMatchAudit {
  return {
    entryId: entry.id,
    scope: entry.scope,
    entryType: entry.entryType,
    displayText: entry.displayText,
    ...(entry.senseId ? { senseId: entry.senseId } : {}),
    originalText,
    replacement: entry.spokenText,
    nodeOrdinal,
    range: rangeFromOffsets(lineStarts, sourceStartOffset, sourceEndOffset),
    sourceStartOffset,
    sourceEndOffset
  };
}

function conflictWarning(
  candidates: LexiconEntry[],
  nodeOrdinal: number,
  sourceStartOffset: number,
  sourceEndOffset: number,
  originalText: string,
  lineStarts: number[]
): TransformDiagnostic | undefined {
  if (candidates.length < 2) return undefined;
  return {
    code: "LEXICON_MATCH_CONFLICT",
    message: `Multiple lexicon entries match this span; ${candidates[0]?.id ?? "the first entry"} wins deterministically.`,
    nodeOrdinal,
    range: rangeFromOffsets(lineStarts, sourceStartOffset, sourceEndOffset),
    sourceStartOffset,
    sourceEndOffset,
    offendingText: originalText,
    suggestion: "Disable or reprioritize overlapping entries if the selected pronunciation is not intended."
  };
}

export function transformScript(input: TransformScriptInput): TransformScriptResult {
  const parsedInput = TransformScriptInputSchema.parse(input);
  const { parsedScript } = parsedInput;
  const entries = parsedInput.entries.filter((entry) => entry.enabled && entry.spokenText.trim().length > 0);
  const namedEntries = entries.filter((entry) => entry.entryType === "namedSense");
  const ordinaryEntries = entries.filter((entry) => entry.entryType !== "namedSense");
  const lineStarts = sourceLineStarts(parsedScript.source);
  const segments: TransformScriptResult["segments"] = [];
  const allMatches: LexiconMatchAudit[] = [];
  const errors: TransformDiagnostic[] = [];
  const warnings: TransformDiagnostic[] = [];

  for (const node of parsedScript.nodes) {
    if (node.type !== "speech") continue;
    const nodeStartOffset = (lineStarts[node.range.start.line - 1] ?? 0) + node.range.start.column - 1;
    const projection = projectReadableText(node.rawText, nodeStartOffset, node.range.start.column, node.annotations);
    if (projection.text !== node.readableText) {
      throw new Error(`Readable projection differs from CIR speech node ${String(node.ordinal)}.`);
    }

    const events: ReplacementEvent[] = [];
    const protectedRanges = projection.annotations.map(({ readableStart, readableEnd }) => ({ readableStart, readableEnd }));
    for (const projected of projection.annotations) {
      const candidates = namedEntries.filter((entry) =>
        entry.senseId === projected.annotation.senseId
        && sameText(entry.displayText, projected.annotation.displayText, entry.caseSensitive)
      ).sort(compareNamed);
      const selected = candidates[0];
      if (!selected) {
        errors.push({
          code: "UNRESOLVED_NAMED_SENSE",
          message: `No enabled lexicon entry resolves ${projected.annotation.displayText}|${projected.annotation.senseId}.`,
          nodeOrdinal: node.ordinal,
          range: rangeFromOffsets(lineStarts, projected.sourceStartOffset, projected.sourceEndOffset),
          sourceStartOffset: projected.sourceStartOffset,
          sourceEndOffset: projected.sourceEndOffset,
          offendingText: projected.annotation.rawText,
          suggestion: `Add a named-sense entry for ${projected.annotation.displayText} + ${projected.annotation.senseId}.`
        });
        continue;
      }
      const audit = auditFor(
        selected,
        projected.annotation.displayText,
        node.ordinal,
        projected.sourceStartOffset,
        projected.sourceEndOffset,
        lineStarts
      );
      events.push({
        readableStart: projected.readableStart,
        readableEnd: projected.readableEnd,
        replacement: selected.spokenText,
        audit
      });
      const warning = conflictWarning(
        candidates,
        node.ordinal,
        projected.sourceStartOffset,
        projected.sourceEndOffset,
        projected.annotation.displayText,
        lineStarts
      );
      if (warning) warnings.push(warning);
    }

    let index = 0;
    while (index < projection.text.length) {
      const protectedRange = protectedRanges.find((item) => index >= item.readableStart && index < item.readableEnd);
      if (protectedRange) {
        index = protectedRange.readableEnd;
        continue;
      }
      const nextProtectedStart = protectedRanges
        .filter((item) => item.readableStart > index)
        .reduce((minimum, item) => Math.min(minimum, item.readableStart), projection.text.length);
      const candidates = ordinaryEntries.filter((entry) =>
        index + entry.displayText.length <= nextProtectedStart && entryMatchesAt(entry, projection.text, index)
      ).sort(compareOrdinary);
      const selected = candidates[0];
      if (!selected) {
        index += codePointAt(projection.text, index).length || 1;
        continue;
      }
      const readableEnd = index + selected.displayText.length;
      const sourceStartOffset = projection.sourceStarts[index] ?? nodeStartOffset;
      const sourceEndOffset = projection.sourceEnds[readableEnd - 1] ?? nodeStartOffset + node.rawText.length;
      const originalText = projection.text.slice(index, readableEnd);
      const audit = auditFor(selected, originalText, node.ordinal, sourceStartOffset, sourceEndOffset, lineStarts);
      events.push({ readableStart: index, readableEnd, replacement: selected.spokenText, audit });
      const warning = conflictWarning(
        candidates,
        node.ordinal,
        sourceStartOffset,
        sourceEndOffset,
        originalText,
        lineStarts
      );
      if (warning) warnings.push(warning);
      index = readableEnd;
    }

    events.sort((left, right) => left.readableStart - right.readableStart);
    let ttsText = "";
    let cursor = 0;
    const matches: LexiconMatchAudit[] = [];
    for (const event of events) {
      ttsText += projection.text.slice(cursor, event.readableStart) + event.replacement;
      cursor = event.readableEnd;
      if (event.audit) matches.push(event.audit);
    }
    ttsText += projection.text.slice(cursor);
    allMatches.push(...matches);
    segments.push({
      nodeOrdinal: node.ordinal,
      speakerId: node.speakerId,
      sourceRange: node.range,
      readableText: projection.text,
      ttsText,
      matches
    });
  }

  const result: TransformScriptResult = {
    transformVersion: LEXICON_TRANSFORM_VERSION,
    source: parsedScript.source,
    segments,
    readableTranscript: segments.map(({ readableText }) => readableText).join("\n"),
    ttsTranscript: segments.map(({ ttsText }) => ttsText).join("\n"),
    matches: allMatches,
    errors,
    warnings,
    synthesisReady: parsedScript.errors.length === 0 && errors.length === 0
  };
  return TransformScriptResultSchema.parse(result);
}
