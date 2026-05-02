// Preload for the chat window. Exposes ONLY the auth + config surface —
// no browser IPC, no Anthropic client, no webview tag. The renderer is
// sandboxed and context-isolated; this is the entire bridge.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // JWT storage backed by safeStorage (OS keychain). Returns null if no
  // token or the platform can't encrypt; setToken returns boolean for
  // whether persistence succeeded.
  getToken: () => ipcRenderer.invoke("auth:getToken"),
  setToken: (token) => ipcRenderer.invoke("auth:setToken", token),
  clearToken: () => ipcRenderer.invoke("auth:clearToken"),

  // Resolved backend URL (dev / preview / prod). Resolved once in main
  // process at startup; the chat client caches its first read.
  getBackendUrl: () => ipcRenderer.invoke("config:backendUrl"),
});
