import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
  DEFAULT_PARAGRAPH_PAUSE_ID,
  parseScript,
  resolveParagraphPauses,
  transformScript,
} from "@studynarrator/core";
import {
  ScriptAnalysisWorkerClient,
  createScriptAnalysisWorkerClient,
} from "./parserClient.js";

class FakeWorker {
  readonly postMessage = vi.fn<(value: unknown) => void>();
  readonly terminate = vi.fn();
  messageListener?: (event: MessageEvent<unknown>) => void;
  errorListener?: (event: ErrorEvent) => void;

  addEventListener(
    type: "message" | "error",
    listener:
      ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === "message")
      this.messageListener = listener as (event: MessageEvent<unknown>) => void;
    else this.errorListener = listener as (event: ErrorEvent) => void;
  }

  respond(data: unknown): void {
    this.messageListener?.({ data } as MessageEvent<unknown>);
  }
}

describe("script analysis worker client", () => {
  it("posts validated analysis input and resolves validated parser and transform output", async () => {
    const worker = new FakeWorker();
    const client = new ScriptAnalysisWorkerClient(worker);
    const paragraphPause = {
      enabled: true,
      pauseId: DEFAULT_PARAGRAPH_PAUSE_ID,
      durationMs: DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
    };
    const input = {
      source: "[speaker_teacher] Hello.",
      entries: [],
      paragraphPause,
    };
    const pending = client.analyze(input);
    expect(worker.postMessage).toHaveBeenCalledWith({ requestId: 1, input });
    const parseResult = parseScript({ source: input.source });
    worker.respond({
      requestId: 1,
      ok: true,
      result: {
        parseResult,
        pacingResult: resolveParagraphPauses({
          parsedScript: parseResult,
          configuration: paragraphPause,
        }),
        transformResult: transformScript({
          parsedScript: parseResult,
          entries: [],
        }),
      },
    });
    await expect(pending).resolves.toMatchObject({
      parseResult: { summary: { speechSegmentCount: 1 } },
      transformResult: { synthesisReady: true },
    });
  });

  it("rejects worker failures and invalid result envelopes", async () => {
    const worker = new FakeWorker();
    const client = new ScriptAnalysisWorkerClient(worker);
    const paragraphPause = {
      enabled: true,
      pauseId: DEFAULT_PARAGRAPH_PAUSE_ID,
      durationMs: DEFAULT_PARAGRAPH_PAUSE_DURATION_MS,
    };
    const failed = client.analyze({
      source: "text",
      defaultSpeakerId: "narrator",
      entries: [],
      paragraphPause,
    });
    worker.respond({ requestId: 1, ok: false, error: "Worker failed safely." });
    await expect(failed).rejects.toThrow("Worker failed safely.");

    const invalid = client.analyze({
      source: "[speaker_teacher] Text.",
      entries: [],
      paragraphPause,
    });
    worker.respond({ requestId: 2, ok: true, result: { secret: "invalid" } });
    await expect(invalid).rejects.toThrow("failed validation");
  });

  it("constructs a module Worker instead of analyzing on the UI thread", () => {
    const instances: Array<{ url: string; options?: WorkerOptions }> = [];
    class WorkerStub extends FakeWorker {
      constructor(url: URL, options?: WorkerOptions) {
        super();
        instances.push({
          url: url.toString(),
          ...(options ? { options } : {}),
        });
      }
    }
    vi.stubGlobal("Worker", WorkerStub);
    const client = createScriptAnalysisWorkerClient();
    expect(client).toBeInstanceOf(ScriptAnalysisWorkerClient);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.url).toContain("parser.worker.ts");
    expect(instances[0]?.options).toEqual({ type: "module" });
    vi.unstubAllGlobals();
  });
});
