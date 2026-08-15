import {
  LexiconEntrySchema,
  ParagraphPauseConfigurationSchema,
  ParseScriptInputSchema,
  ParseScriptResultSchema,
  ResolveParagraphPausesResultSchema,
  TransformScriptResultSchema,
  parseScript,
  resolveParagraphPauses,
  transformScript,
  type LexiconEntry,
  type ParagraphPauseConfiguration,
  type ParseScriptInput,
  type ParseScriptResult,
  type ResolveParagraphPausesResult,
  type TransformScriptResult
} from "@studynarrator/core";

export interface ScriptAnalysisInput extends ParseScriptInput {
  entries: LexiconEntry[];
  paragraphPause: ParagraphPauseConfiguration;
}

export interface ScriptAnalysisResult {
  parseResult: ParseScriptResult;
  pacingResult: ResolveParagraphPausesResult;
  transformResult: TransformScriptResult;
}

export type ParserWorkerResponse =
  | { requestId: number; ok: true; result: ScriptAnalysisResult }
  | { requestId: number; ok: false; error: string };

export function validateScriptAnalysisInput(value: unknown): ScriptAnalysisInput {
  if (
    typeof value !== "object"
    || value === null
    || !("entries" in value)
    || !Array.isArray(value.entries)
    || !("paragraphPause" in value)
  ) {
    throw new Error("Script analysis input is missing lexicon entries or paragraph-pause configuration.");
  }
  const { entries, paragraphPause, ...parseInput } = value;
  const parsed = ParseScriptInputSchema.parse(parseInput);
  return {
    ...parsed,
    entries: entries.map((entry) => LexiconEntrySchema.parse(entry)),
    paragraphPause: ParagraphPauseConfigurationSchema.parse(paragraphPause)
  };
}

export function validateScriptAnalysisResult(value: unknown): ScriptAnalysisResult {
  if (
    typeof value !== "object"
    || value === null
    || !("parseResult" in value)
    || !("pacingResult" in value)
    || !("transformResult" in value)
  ) {
    throw new Error("Script analysis result is incomplete.");
  }
  return {
    parseResult: ParseScriptResultSchema.parse(value.parseResult),
    pacingResult: ResolveParagraphPausesResultSchema.parse(value.pacingResult),
    transformResult: TransformScriptResultSchema.parse(value.transformResult)
  };
}

export function handleParserWorkerRequest(value: unknown): ParserWorkerResponse {
  let requestId = -1;
  try {
    if (typeof value === "object" && value !== null && "requestId" in value && typeof value.requestId === "number") {
      requestId = value.requestId;
    }
    if (typeof value !== "object" || value === null || !("input" in value)) {
      throw new Error("Parser worker request is missing its input.");
    }
    const input = validateScriptAnalysisInput(value.input);
    const { entries, paragraphPause, ...parseInput } = input;
    const parseResult = ParseScriptResultSchema.parse(parseScript(parseInput));
    const pacingResult = ResolveParagraphPausesResultSchema.parse(resolveParagraphPauses({
      parsedScript: parseResult,
      configuration: paragraphPause
    }));
    const transformResult = TransformScriptResultSchema.parse(transformScript({
      parsedScript: parseResult,
      entries,
      ...(input.ignoredDiagnostics ? { ignoredDiagnostics: input.ignoredDiagnostics } : {})
    }));
    return { requestId, ok: true, result: { parseResult, pacingResult, transformResult } };
  } catch (error) {
    return {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "The analysis worker could not process the script."
    };
  }
}
