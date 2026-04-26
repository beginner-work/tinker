const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("beginner", {
  version: () => ipcRenderer.invoke("app:version"),
  platform: () => ipcRenderer.invoke("app:platform"),
  setIcon: (dataUrl) => ipcRenderer.invoke("app:setIcon", dataUrl),
  searchQuery: (query) => ipcRenderer.invoke("search:query", query),
  linkedinPost: (message) => ipcRenderer.invoke("linkedin:post", message),
});
