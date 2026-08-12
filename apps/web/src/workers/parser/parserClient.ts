import {
  validateScriptAnalysisInput,
  validateScriptAnalysisResult,
  type ParserWorkerResponse,
  type ScriptAnalysisInput,
  type ScriptAnalysisResult
} from "./parserWorkerProtocol.js";

export interface ScriptAnalyzer {
  analyze(input: ScriptAnalysisInput): Promise<ScriptAnalysisResult>;
}

interface WorkerPort {
  postMessage(value: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

interface PendingRequest {
  resolve(result: ScriptAnalysisResult): void;
  reject(error: Error): void;
}

export class ScriptAnalysisWorkerClient implements ScriptAnalyzer {
  readonly #worker: WorkerPort;
  readonly #pending = new Map<number, PendingRequest>();
  #nextRequestId = 1;

  constructor(worker: WorkerPort) {
    this.#worker = worker;
    worker.addEventListener("message", (event) => this.#handleMessage(event.data));
    worker.addEventListener("error", (event) => this.#failAll(event.message || "The parser worker stopped unexpectedly."));
  }

  analyze(input: ScriptAnalysisInput): Promise<ScriptAnalysisResult> {
    const validatedInput = validateScriptAnalysisInput(input);
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      this.#worker.postMessage({ requestId, input: validatedInput });
    });
  }

  terminate(): void {
    this.#worker.terminate();
    this.#failAll("The parser worker was closed.");
  }

  #handleMessage(value: unknown): void {
    if (typeof value !== "object" || value === null || !("requestId" in value) || typeof value.requestId !== "number") {
      this.#failAll("The parser worker returned an invalid response.");
      return;
    }
    const response = value as ParserWorkerResponse;
    const pending = this.#pending.get(response.requestId);
    if (!pending) return;
    this.#pending.delete(response.requestId);
    if (!response.ok) {
      pending.reject(new Error(response.error));
      return;
    }
    try {
      pending.resolve(validateScriptAnalysisResult(response.result));
    } catch {
      pending.reject(new Error("The analysis worker returned data that failed validation."));
    }
  }

  #failAll(message: string): void {
    for (const pending of this.#pending.values()) pending.reject(new Error(message));
    this.#pending.clear();
  }
}

export function createScriptAnalysisWorkerClient(): ScriptAnalysisWorkerClient {
  return new ScriptAnalysisWorkerClient(new Worker(new URL("./parser.worker.ts", import.meta.url), { type: "module" }));
}
