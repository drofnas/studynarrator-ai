import { contextBridge, ipcRenderer } from "electron";
import { createPreloadBridge } from "./bridge.js";

contextBridge.exposeInMainWorld(
  "studyNarrator",
  createPreloadBridge((channel, input) => ipcRenderer.invoke(channel, input) as Promise<unknown>)
);
