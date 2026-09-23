const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppPath: () => ipcRenderer.invoke("get-app-path"),
  areCookiesFresh: () => ipcRenderer.invoke("are-cookies-fresh"),
  platform: process.platform,

  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  onWindowState: (cb) => ipcRenderer.on("window-state", (_e, state) => cb(state)),

  transcribeAudio: (arrayBuffer) => ipcRenderer.invoke("stt-transcribe", arrayBuffer),

  // Agent workspace
  openDirectory: () => ipcRenderer.invoke("dialog-open-directory"),
  readDir: (dirPath) => ipcRenderer.invoke("fs-read-dir", dirPath),

  // Screen recorder
  screenGetSources: () => ipcRenderer.invoke("screen-get-sources"),
  screenGetDefaultPath: () => ipcRenderer.invoke("screen-get-default-path"),
  screenSaveDialog: (suggestedName) => ipcRenderer.invoke("screen-save-dialog", suggestedName),
  screenSaveFile: (filePath, data) => ipcRenderer.invoke("screen-save-file", { filePath, data }),
  screenOpenFolder: (filePath) => ipcRenderer.invoke("screen-open-folder", filePath),
});
