const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tinker", {
  version: () => ipcRenderer.invoke("app:version"),
  platform: () => ipcRenderer.invoke("app:platform"),
  setIcon: (dataUrl) => ipcRenderer.invoke("app:setIcon", dataUrl),
  searchQuery: (query) => ipcRenderer.invoke("search:query", query),
  // Open the chat client in its own window. The chat window has a separate
  // preload (preload-chat.js) and exposes window.api there — see chat/app.js.
  openChat: () => ipcRenderer.invoke("chat:open"),
  // The platform-mobile.js shim (loaded for Capacitor / plain web) sets
  // this to false so the renderer routes external URLs through the OS
  // browser instead of trying to mount an Electron <webview>.
  supportsWebview: true,
});
