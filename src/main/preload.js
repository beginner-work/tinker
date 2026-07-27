const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tinker", {
  version: () => ipcRenderer.invoke("app:version"),
  platform: () => ipcRenderer.invoke("app:platform"),
  setIcon: (dataUrl) => ipcRenderer.invoke("app:setIcon", dataUrl),
  searchQuery: (query) => ipcRenderer.invoke("search:query", query),
  // Closes the focused window — backs the post-publish "Close app" button.
  close: () => ipcRenderer.invoke("app:close"),
  // The platform-mobile.js shim (loaded for plain web / Expo) sets
  // this to false so the renderer routes external URLs through the OS
  // browser instead of trying to mount an Electron <webview>.
  supportsWebview: true,
});
