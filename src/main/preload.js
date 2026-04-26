const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("beginner", {
  version: () => ipcRenderer.invoke("app:version"),
  platform: () => ipcRenderer.invoke("app:platform"),
  setIcon: (dataUrl) => ipcRenderer.invoke("app:setIcon", dataUrl),
  searchQuery: (query) => ipcRenderer.invoke("search:query", query),
  linkedinPost: (message) => ipcRenderer.invoke("linkedin:post", message),
  // The platform-mobile.js shim (loaded for Capacitor / plain web) sets
  // this to false so the renderer routes external URLs through the OS
  // browser instead of trying to mount an Electron <webview>.
  supportsWebview: true,
});
