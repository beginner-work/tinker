const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("beginner", {
  version: () => ipcRenderer.invoke("app:version"),
  platform: () => ipcRenderer.invoke("app:platform"),
  setIcon: (dataUrl) => ipcRenderer.invoke("app:setIcon", dataUrl),
});
