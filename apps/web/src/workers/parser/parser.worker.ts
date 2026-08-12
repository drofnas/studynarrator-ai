/// <reference lib="webworker" />
import { handleParserWorkerRequest } from "./parserWorkerProtocol.js";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  self.postMessage(handleParserWorkerRequest(event.data));
});
