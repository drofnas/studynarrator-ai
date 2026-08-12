import {
  ParseScriptInputSchema,
  ParseScriptResultSchema,
  parseScript,
  type ParseScriptInput,
  type ParseScriptResult
} from "@studynarrator/core";

export interface ParserWorkerRequest {
  requestId: number;
  input: ParseScriptInput;
}

export type ParserWorkerResponse =
  | { requestId: number; ok: true; result: ParseScriptResult }
  | { requestId: number; ok: false; error: string };

export function handleParserWorkerRequest(value: unknown): ParserWorkerResponse {
  let requestId = -1;
  try {
    if (typeof value === "object" && value !== null && "requestId" in value && typeof value.requestId === "number") {
      requestId = value.requestId;
    }
    if (typeof value !== "object" || value === null || !("input" in value)) {
      throw new Error("Parser worker request is missing its input.");
    }
    const input = ParseScriptInputSchema.parse(value.input);
    return { requestId, ok: true, result: ParseScriptResultSchema.parse(parseScript(input)) };
  } catch (error) {
    return {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "The parser worker could not process the script."
    };
  }
}
