import { join, resolve } from "node:path";
import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { createDesktopServices } from "./bootstrap.js";
import { registerConnectionHandlers, registerDiagnosticsHandler, registerPersistenceHandlers } from "./ipc.js";
import { SECURE_WEB_PREFERENCES } from "./security.js";

let runtime: Awaited<ReturnType<typeof createDesktopServices>> | undefined;

async function createWindow() {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: "#eaf0f2",
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: join(__dirname, "preload.cjs")
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) event.preventDefault();
  });

  const rendererUrl = process.env.STUDYNARRATOR_RENDERER_URL ?? "http://127.0.0.1:5173";
  if (app.isPackaged) {
    await window.loadFile(resolve(__dirname, "../../web/dist/index.html"));
  } else {
    await window.loadURL(rendererUrl);
  }

  if (process.env.STUDYNARRATOR_OPEN_DEVTOOLS === "true") {
    window.webContents.openDevTools({ mode: "detach" });
  }
}

void app.whenReady().then(async () => {
  runtime = await createDesktopServices({ defaultDataDirectory: app.getPath("userData"), safeStorage });
  registerDiagnosticsHandler(ipcMain, runtime.service, runtime.context);
  registerPersistenceHandlers(ipcMain, runtime.persistence);
  if (runtime.connections && runtime.voiceCatalog) registerConnectionHandlers(ipcMain, runtime.connections, runtime.voiceCatalog);
  await createWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  runtime?.service.close();
});
