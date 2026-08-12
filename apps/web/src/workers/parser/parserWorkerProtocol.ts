import {
  LexiconEntrySchema,
  ParseScriptInputSchema,
  ParseScriptResultSchema,
  TransformScriptResultSchema,
  parseScript,
  transformScript,
  type LexiconEntry,
  type ParseScriptInput,
  type ParseScriptResult,
  type TransformScriptResult
} from "@studynarrator/core";

export interface ScriptAnalysisInput extends ParseScriptInput {
  entries: LexiconEntry[];
}

export interface ScriptAnalysisResult {
  parseResult: ParseScriptResult;
  transformResult: TransformScriptResult;
}

export interface ParserWorkerRequest {
  requestId: number;
  input: ScriptAnalysisInput;
}

export type ParserWorkerResponse =
  | { requestId: number; ok: true; result: ScriptAnalysisResult }
  | { requestId: number; ok: false; error: string };

export function validateScriptAnalysisInput(value: unknown): ScriptAnalysisInput {
  if (typeof value !== "object" || value === null || !("entries" in value) || !Array.isArray(value.entries)) {
    throw new Error("Script analysis input is missing lexicon entries.");
  }
  const { entries, ...parseInput } = value;
  const parsed = ParseScriptInputSchema.parse(parseInput);
  return { ...parsed, entries: entries.map((entry) => LexiconEntrySchema.parse(entry)) };
}

export function validateScriptAnalysisResult(value: unknown): ScriptAnalysisResult {
  if (typeof value !== "object" || value === null || !("parseResult" in value) || !("transformResult" in value)) {
    throw new Error("Script analysis result is incomplete.");
  }
  return {
    parseResult: ParseScriptResultSchema.parse(value.parseResult),
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
    const { entries, ...parseInput } = input;
    const parseResult = ParseScriptResultSchema.parse(parseScript(parseInput));
    const transformResult = TransformScriptResultSchema.parse(transformScript({
      parsedScript: parseResult,
      entries,
      ...(input.ignoredDiagnostics ? { ignoredDiagnostics: input.ignoredDiagnostics } : {})
    }));
    return { requestId, ok: true, result: { parseResult, transformResult } };
  } catch (error) {
    return {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "The analysis worker could not process the script."
    };
  }
}
