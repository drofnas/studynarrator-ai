import { contextBridge, ipcRenderer } from "electron";
import { createPreloadBridge } from "./bridge.js";

contextBridge.exposeInMainWorld(
  "studyNarrator",
  createPreloadBridge((channel) => ipcRenderer.invoke(channel) as Promise<unknown>)
);
