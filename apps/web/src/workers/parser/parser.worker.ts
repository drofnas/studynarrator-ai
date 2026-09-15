/// <reference lib="webworker" />
import "../../shared/validation.js";
import { handleParserWorkerRequest } from "./parserWorkerProtocol.js";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  self.postMessage(handleParserWorkerRequest(event.data));
});
