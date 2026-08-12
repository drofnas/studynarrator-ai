/// <reference lib="webworker" />
import { handleParserWorkerRequest } from "./parser-worker-protocol.js";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  self.postMessage(handleParserWorkerRequest(event.data));
});
