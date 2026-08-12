import { describe, expect, it, vi } from "vitest";
import { parseScript } from "@studynarrator/core";
import { ScriptParserWorkerClient, createScriptParserWorkerClient } from "./parserClient.js";

class FakeWorker {
  readonly postMessage = vi.fn<(value: unknown) => void>();
  readonly terminate = vi.fn();
  messageListener?: (event: MessageEvent<unknown>) => void;
  errorListener?: (event: ErrorEvent) => void;

  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)): void {
    if (type === "message") this.messageListener = listener as (event: MessageEvent<unknown>) => void;
    else this.errorListener = listener as (event: ErrorEvent) => void;
  }

  respond(data: unknown): void {
    this.messageListener?.({ data } as MessageEvent<unknown>);
  }
}

describe("parser worker client", () => {
  it("posts validated parser input and resolves validated output", async () => {
    const worker = new FakeWorker();
    const client = new ScriptParserWorkerClient(worker);
    const pending = client.parse({ source: "[speaker_teacher] Hello." });
    expect(worker.postMessage).toHaveBeenCalledWith({ requestId: 1, input: { source: "[speaker_teacher] Hello." } });
    worker.respond({ requestId: 1, ok: true, result: parseScript({ source: "[speaker_teacher] Hello." }) });
    await expect(pending).resolves.toMatchObject({ summary: { speechSegmentCount: 1 } });
  });

  it("rejects worker failures and invalid result envelopes", async () => {
    const worker = new FakeWorker();
    const client = new ScriptParserWorkerClient(worker);
    const failed = client.parse({ source: "text", defaultSpeakerId: "narrator" });
    worker.respond({ requestId: 1, ok: false, error: "Worker failed safely." });
    await expect(failed).rejects.toThrow("Worker failed safely.");

    const invalid = client.parse({ source: "[speaker_teacher] Text." });
    worker.respond({ requestId: 2, ok: true, result: { secret: "invalid" } });
    await expect(invalid).rejects.toThrow("failed validation");
  });

  it("constructs a module Worker instead of parsing on the UI thread", () => {
    const instances: Array<{ url: string; options?: WorkerOptions }> = [];
    class WorkerStub extends FakeWorker {
      constructor(url: URL, options?: WorkerOptions) {
        super();
        instances.push({ url: url.toString(), ...(options ? { options } : {}) });
      }
    }
    vi.stubGlobal("Worker", WorkerStub);
    const client = createScriptParserWorkerClient();
    expect(client).toBeInstanceOf(ScriptParserWorkerClient);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.url).toContain("parser.worker.ts");
    expect(instances[0]?.options).toEqual({ type: "module" });
    vi.unstubAllGlobals();
  });
});
