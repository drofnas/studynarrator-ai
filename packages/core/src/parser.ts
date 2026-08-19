import {
  CIR_SCHEMA_VERSION,
  ParseScriptInputSchema,
  ParseScriptResultSchema,
  SCRIPT_GRAMMAR_VERSION,
  SYSTEM_DEFAULT_SPEAKER_ID,
  type CirNode,
  type ParseDiagnostic,
  type ParseScriptInput,
  type ParseScriptResult,
  type PronunciationAnnotation,
  type SourceRange,
} from "./schemas.js";

const SPEAKER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const PAUSE_ID = /^pause_[A-Za-z0-9_-]*$/u;
const SENSE_ID = /^[A-Za-z0-9_-]+$/u;
const INLINE_DIRECTIVE =
  /\[(?:pause_(?:short|medium|long)|speaker_)[^\]\r\n]*\]/gu;

interface MutableNamedDiscovery {
  id: string;
  occurrences: Array<{ range: SourceRange }>;
}

interface MutableSectionDiscovery {
  title: string;
  occurrences: Array<{ range: SourceRange }>;
}

function range(
  line: number,
  startColumn: number,
  endColumn: number,
): SourceRange {
  return {
    start: { line, column: startColumn },
    end: { line, column: endColumn },
  };
}

function diagnostic(
  code: string,
  message: string,
  line: number,
  column: number,
  offendingText: string,
  suggestion: string,
  ignorePattern = offendingText,
): ParseDiagnostic {
  return {
    code,
    message,
    line,
    column,
    offendingText,
    ignorePattern,
    suggestion,
  };
}

function unclosedAnnotationPattern(
  rawText: string,
  startIndex: number,
): string {
  const remainder = rawText.slice(startIndex);
  const separator = remainder.indexOf("|");
  if (separator >= 2) {
    const sense =
      /^[A-Za-z0-9_-]*/u.exec(remainder.slice(separator + 1))?.[0] ?? "";
    return remainder.slice(0, separator + 1 + sense.length);
  }
  const whitespace = remainder.search(/\s/u);
  return whitespace === -1 ? remainder : remainder.slice(0, whitespace);
}

function sourceLines(source: string): string[] {
  if (source.length === 0) return [];
  const lines = source.split(/\r\n|\n|\r/u);
  if (source.length > 0 && /(?:\r\n|\n|\r)$/u.test(source)) lines.pop();
  return lines;
}

function parseSpeechText(
  rawText: string,
  lineNumber: number,
  startColumn: number,
  offendingText: string,
): {
  readableText: string;
  annotations: PronunciationAnnotation[];
  errors: ParseDiagnostic[];
} {
  let readableText = "";
  const annotations: PronunciationAnnotation[] = [];
  const errors: ParseDiagnostic[] = [];

  for (let index = 0; index < rawText.length;) {
    if (rawText.startsWith("\\{{", index)) {
      const literalClose = rawText.indexOf("}}", index + 3);
      if (literalClose === -1) {
        readableText += rawText.slice(index + 1);
        index = rawText.length;
        continue;
      }
      readableText += rawText.slice(index + 1, literalClose + 2);
      index = literalClose + 2;
      continue;
    }
    if (rawText.startsWith("\\[", index)) {
      readableText += "[";
      index += 2;
      continue;
    }
    if (rawText.startsWith("{{", index)) {
      const close = rawText.indexOf("}}", index + 2);
      if (close === -1) {
        errors.push(
          diagnostic(
            "UNCLOSED_PRONUNCIATION_ANNOTATION",
            "Pronunciation annotation is missing its closing braces.",
            lineNumber,
            startColumn + index,
            offendingText,
            "Close the annotation as {{display text|sense}} or escape literal braces as \\{{.",
            unclosedAnnotationPattern(rawText, index),
          ),
        );
        readableText += rawText.slice(index);
        break;
      }

      const rawAnnotation = rawText.slice(index, close + 2);
      const body = rawText.slice(index + 2, close);
      const separator = body.indexOf("|");
      if (separator <= 0 || separator !== body.lastIndexOf("|")) {
        errors.push(
          diagnostic(
            "INVALID_PRONUNCIATION_ANNOTATION",
            "Pronunciation annotation must contain one nonempty display text and one sense.",
            lineNumber,
            startColumn + index,
            offendingText,
            "Use the form {{display text|sense}} with exactly one | separator.",
            rawAnnotation,
          ),
        );
        readableText += rawAnnotation;
        index = close + 2;
        continue;
      }

      const displayText = body.slice(0, separator);
      const senseId = body.slice(separator + 1);
      if (displayText.trim().length === 0) {
        errors.push(
          diagnostic(
            "INVALID_PRONUNCIATION_ANNOTATION",
            "Pronunciation annotation display text cannot be blank.",
            lineNumber,
            startColumn + index + 2,
            offendingText,
            "Add visible display text before the | separator.",
            rawAnnotation,
          ),
        );
        readableText += rawAnnotation;
        index = close + 2;
        continue;
      }
      if (!SENSE_ID.test(senseId)) {
        errors.push(
          diagnostic(
            "INVALID_PRONUNCIATION_SENSE",
            "Pronunciation sense contains unsupported characters or is empty.",
            lineNumber,
            startColumn + index + separator + 3,
            offendingText,
            "Use only letters, numbers, underscores, or hyphens for the sense.",
            rawAnnotation,
          ),
        );
        readableText += rawAnnotation;
        index = close + 2;
        continue;
      }

      annotations.push({
        displayText,
        senseId,
        rawText: rawAnnotation,
        range: range(lineNumber, startColumn + index, startColumn + close + 2),
      });
      readableText += displayText;
      index = close + 2;
      continue;
    }
    if (rawText.startsWith("}}", index)) {
      errors.push(
        diagnostic(
          "UNMATCHED_PRONUNCIATION_CLOSE",
          "Pronunciation annotation has closing braces without an opening annotation.",
          lineNumber,
          startColumn + index,
          offendingText,
          "Remove the unmatched braces or add a complete {{display text|sense}} annotation.",
          "}}",
        ),
      );
      readableText += "}}";
      index += 2;
      continue;
    }
    readableText += rawText[index];
    index += 1;
  }

  return { readableText, annotations, errors };
}

export function parseScript(input: ParseScriptInput): ParseScriptResult {
  const parsedInput = ParseScriptInputSchema.parse(input);
  const { source, defaultSpeakerId, ignoredDiagnostics = [] } = parsedInput;
  const effectiveDefaultSpeakerId =
    defaultSpeakerId ?? SYSTEM_DEFAULT_SPEAKER_ID;
  const lines = sourceLines(source);
  const nodes: CirNode[] = [];
  const errors: ParseDiagnostic[] = [];
  const warnings: ParseDiagnostic[] = [];
  const speakerMap = new Map<string, MutableNamedDiscovery>();
  const pauseMap = new Map<string, MutableNamedDiscovery>();
  const sectionMap = new Map<string, MutableSectionDiscovery>();
  const pronunciationDiscoveries: ParseScriptResult["discoveries"]["pronunciations"] =
    [];
  let activeSpeaker = effectiveDefaultSpeakerId;
  let blankStart: number | undefined;

  function nextOrdinal(): number {
    return nodes.length + 1;
  }

  function recordError(error: ParseDiagnostic): void {
    const ignored = ignoredDiagnostics.some(
      (item) =>
        item.code === error.code && item.pattern === error.ignorePattern,
    );
    if (!ignored) errors.push(error);
  }

  function recordWarning(warning: ParseDiagnostic): void {
    const ignored = ignoredDiagnostics.some(
      (item) =>
        item.code === warning.code && item.pattern === warning.ignorePattern,
    );
    if (!ignored) warnings.push(warning);
  }

  function recordSpeaker(
    id: string,
    occurrenceRange: SourceRange,
    lineText: string,
  ): void {
    const existing = speakerMap.get(id);
    if (existing) {
      existing.occurrences.push({ range: occurrenceRange });
      return;
    }

    const collision = [...speakerMap.keys()].find(
      (candidate) => candidate.toLowerCase() === id.toLowerCase(),
    );
    if (collision) {
      recordWarning(
        diagnostic(
          "SPEAKER_ID_CASE_COLLISION",
          `Speaker IDs ${collision} and ${id} differ only by case.`,
          occurrenceRange.start.line,
          occurrenceRange.start.column,
          lineText,
          "Use one consistent speaker ID spelling to avoid accidental duplicate mappings.",
        ),
      );
    }
    speakerMap.set(id, { id, occurrences: [{ range: occurrenceRange }] });
  }

  function recordNamed(
    map: Map<string, MutableNamedDiscovery>,
    id: string,
    occurrenceRange: SourceRange,
  ): void {
    const existing = map.get(id);
    if (existing) existing.occurrences.push({ range: occurrenceRange });
    else map.set(id, { id, occurrences: [{ range: occurrenceRange }] });
  }

  function flushParagraph(beforeLine: number): void {
    if (blankStart === undefined) return;
    const endLine = beforeLine - 1;
    nodes.push({
      type: "paragraphBreak",
      ordinal: nextOrdinal(),
      lineCount: endLine - blankStart + 1,
      range: {
        start: { line: blankStart, column: 1 },
        end: { line: beforeLine, column: 1 },
      },
    });
    blankStart = undefined;
  }

  function addSpeechSegment(
    rawText: string,
    lineNumber: number,
    startColumn: number,
    lineText: string,
  ): void {
    const speech = parseSpeechText(rawText, lineNumber, startColumn, lineText);
    for (const error of speech.errors) recordError(error);
    if (speech.readableText.length === 0) return;

    const ordinal = nextOrdinal();
    const speechRange = range(
      lineNumber,
      startColumn,
      startColumn + rawText.length,
    );
    nodes.push({
      type: "speech",
      ordinal,
      range: speechRange,
      speakerId: activeSpeaker,
      rawText,
      readableText: speech.readableText,
      annotations: speech.annotations,
    });
    if (
      activeSpeaker === effectiveDefaultSpeakerId &&
      !speakerMap.has(activeSpeaker)
    ) {
      recordSpeaker(activeSpeaker, speechRange, lineText);
    }
    for (const annotation of speech.annotations) {
      pronunciationDiscoveries.push({ ...annotation, nodeOrdinal: ordinal });
    }
  }

  function addSpeech(
    rawText: string,
    lineNumber: number,
    startColumn: number,
    lineText: string,
  ): void {
    INLINE_DIRECTIVE.lastIndex = 0;
    let cursor = 0;

    for (const match of rawText.matchAll(INLINE_DIRECTIVE)) {
      const matchIndex = match.index;
      if (matchIndex > 0 && rawText[matchIndex - 1] === "\\") continue;

      const token = match[0].slice(1, -1);
      const isPause = token.startsWith("pause_");
      const speakerId = isPause ? undefined : token.slice("speaker_".length);
      if (
        (isPause && !PAUSE_ID.test(token)) ||
        (speakerId !== undefined && !SPEAKER_ID.test(speakerId))
      ) {
        recordError(
          diagnostic(
            isPause ? "MALFORMED_PAUSE_DIRECTIVE" : "INVALID_SPEAKER_DIRECTIVE",
            isPause
              ? "Pause directive contains an invalid pause ID."
              : "Speaker directive does not contain a valid speaker name.",
            lineNumber,
            startColumn + matchIndex,
            lineText,
            isPause
              ? "Use a pause such as [pause_short], optionally surrounded by speech."
              : "Use [speaker_name] with a name containing only letters, numbers, underscores, or hyphens.",
            match[0],
          ),
        );
        continue;
      }

      let segmentEnd = matchIndex;
      while (segmentEnd > cursor && /\s/u.test(rawText[segmentEnd - 1] ?? ""))
        segmentEnd -= 1;
      if (segmentEnd > cursor) {
        addSpeechSegment(
          rawText.slice(cursor, segmentEnd),
          lineNumber,
          startColumn + cursor,
          lineText,
        );
      }

      const directiveRange = range(
        lineNumber,
        startColumn + matchIndex,
        startColumn + matchIndex + match[0].length,
      );
      if (isPause) {
        nodes.push({
          type: "pause",
          ordinal: nextOrdinal(),
          pauseId: token,
          range: directiveRange,
        });
        recordNamed(pauseMap, token, directiveRange);
      } else if (speakerId !== undefined) {
        activeSpeaker = speakerId;
        recordSpeaker(speakerId, directiveRange, lineText);
      }

      cursor = matchIndex + match[0].length;
      while (cursor < rawText.length && /\s/u.test(rawText[cursor] ?? ""))
        cursor += 1;
    }

    if (cursor < rawText.length) {
      addSpeechSegment(
        rawText.slice(cursor),
        lineNumber,
        startColumn + cursor,
        lineText,
      );
    }
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex] ?? "";
    const lineNumber = lineIndex + 1;
    if (/^\s*$/u.test(lineText)) {
      blankStart ??= lineNumber;
      continue;
    }
    flushParagraph(lineNumber);

    const firstContentIndex = lineText.search(/\S/u);
    const contentIndex = firstContentIndex < 0 ? 0 : firstContentIndex;
    const content = lineText.slice(contentIndex);

    if (content.startsWith("\\[")) {
      addSpeech(content, lineNumber, contentIndex + 1, lineText);
      continue;
    }

    if (!content.startsWith("[")) {
      addSpeech(content, lineNumber, contentIndex + 1, lineText);
      continue;
    }

    const close = content.indexOf("]");
    if (close === -1) {
      const error = diagnostic(
        "UNCLOSED_DIRECTIVE",
        "Beginning-of-line directive is missing its closing bracket.",
        lineNumber,
        contentIndex + 1,
        lineText,
        "Close the directive with ] or escape a literal opening bracket as \\[.",
        content,
      );
      recordError(error);
      addSpeech(content, lineNumber, contentIndex + 1, lineText);
      continue;
    }

    const token = content.slice(1, close);
    const trailing = content.slice(close + 1);
    const directiveRange = range(
      lineNumber,
      contentIndex + 1,
      contentIndex + close + 2,
    );

    if (
      token === "section" ||
      token.startsWith("section:") ||
      token.startsWith("section ")
    ) {
      const sectionMatch = /^section:\s*(.*)$/u.exec(token);
      if (
        !sectionMatch ||
        sectionMatch[1]?.trim().length === 0 ||
        trailing.trim().length > 0
      ) {
        const error = diagnostic(
          "MALFORMED_SECTION_DIRECTIVE",
          "Section directive must contain a title and occupy its own line.",
          lineNumber,
          contentIndex + 1,
          lineText,
          "Use [section: Section title] on a line by itself, or ignore this pattern to keep it as literal speech.",
          content.slice(0, close + 1),
        );
        recordError(error);
        addSpeech(content, lineNumber, contentIndex + 1, lineText);
        continue;
      }
      const title = sectionMatch[1]?.trim();
      if (!title) continue;
      const ordinal = nextOrdinal();
      nodes.push({ type: "section", ordinal, title, range: directiveRange });
      const existing = sectionMap.get(title);
      if (existing) existing.occurrences.push({ range: directiveRange });
      else
        sectionMap.set(title, {
          title,
          occurrences: [{ range: directiveRange }],
        });
      continue;
    }

    if (token.startsWith("pause_") || token.startsWith("speaker_")) {
      addSpeech(content, lineNumber, contentIndex + 1, lineText);
      continue;
    }

    const error = diagnostic(
      "MALFORMED_DIRECTIVE",
      "Beginning-of-line bracket text is not a recognized directive.",
      lineNumber,
      contentIndex + 1,
      lineText,
      "Use [speaker_name], [pause_name], or [section: Title], escape a literal [ as \\[, or ignore this pattern.",
      content.slice(0, close + 1),
    );
    recordError(error);
    addSpeech(content, lineNumber, contentIndex + 1, lineText);
  }

  flushParagraph(lines.length + 1);

  const result: ParseScriptResult = {
    grammarVersion: SCRIPT_GRAMMAR_VERSION,
    cirSchemaVersion: CIR_SCHEMA_VERSION,
    source,
    nodes,
    discoveries: {
      speakers: [...speakerMap.values()],
      pauses: [...pauseMap.values()],
      sections: [...sectionMap.values()],
      pronunciations: pronunciationDiscoveries,
    },
    summary: {
      speakerCount: speakerMap.size,
      pauseIdCount: pauseMap.size,
      sectionCount: nodes.filter((node) => node.type === "section").length,
      speechSegmentCount: nodes.filter((node) => node.type === "speech").length,
      explicitPauseSegmentCount: nodes.filter((node) => node.type === "pause")
        .length,
      pronunciationAnnotationCount: pronunciationDiscoveries.length,
      paragraphBreakCount: nodes.filter(
        (node) => node.type === "paragraphBreak",
      ).length,
      characterCount: source.length,
    },
    errors,
    warnings,
  };

  return ParseScriptResultSchema.parse(result);
}
