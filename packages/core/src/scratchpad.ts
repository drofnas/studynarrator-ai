import { z } from "zod";
import { LexiconEntrySchema, type LexiconEntry } from "./schemas.js";
import { parseScript } from "./parser.js";
import { transformScript } from "./transformer.js";

export const SCRATCHPAD_PASSAGE_MAX_CHARACTERS = 1_200;

const ScratchpadPassageInputSchema = z.object({
  text: z.string().max(SCRATCHPAD_PASSAGE_MAX_CHARACTERS).refine((value) => value.trim().length > 0, "Enter a passage to synthesize."),
  entries: z.array(LexiconEntrySchema),
  applyGlobalLexicon: z.boolean()
}).strict();

export interface ScratchpadPassageProjection {
  originalText: string;
  readableText: string;
  transformedText: string;
  warnings: Array<{ code: string; message: string; line?: number; column?: number }>;
}

export class ScratchpadPassageError extends Error {
  readonly code = "SCRATCHPAD_PASSAGE_INVALID";
}

function warning(diagnostic: {
  code: string;
  message: string;
  line?: number;
  column?: number;
  range?: { start: { line: number; column: number } };
}): ScratchpadPassageProjection["warnings"][number] {
  const line = diagnostic.line ?? diagnostic.range?.start.line;
  const column = diagnostic.column ?? diagnostic.range?.start.column;
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column })
  };
}

export function transformScratchpadPassage(inputValue: {
  text: string;
  entries: readonly LexiconEntry[];
  applyGlobalLexicon: boolean;
}): ScratchpadPassageProjection {
  const input = ScratchpadPassageInputSchema.parse(inputValue);
  const parsed = parseScript({ source: input.text });
  const firstError = parsed.errors[0];
  if (firstError) {
    throw new ScratchpadPassageError(`${firstError.message} Use Projects for structured narration scripts.`);
  }
  const hasControlNode = parsed.nodes.some((node) => node.type === "section" || node.type === "pause");
  const hasSpeakerControl = /(^|[^\\])\[speaker_[A-Za-z0-9][A-Za-z0-9_-]*\]/u.test(input.text);
  if (hasControlNode || hasSpeakerControl) {
    throw new ScratchpadPassageError("Quick Scratchpad accepts speech text only. Use Projects for speaker, pause, and section controls.");
  }
  const entries = input.applyGlobalLexicon
    ? input.entries.filter((entry) => entry.scope === "global")
    : [];
  const transformed = transformScript({ parsedScript: parsed, entries });
  if (!transformed.synthesisReady || transformed.ttsTranscript.trim().length === 0) {
    throw new ScratchpadPassageError("The passage could not be prepared for synthesis. Review the source-linked message and try again.");
  }
  return {
    originalText: input.text,
    readableText: transformed.readableTranscript,
    transformedText: transformed.ttsTranscript,
    warnings: [...parsed.warnings.map(warning), ...transformed.warnings.map(warning)]
  };
}
