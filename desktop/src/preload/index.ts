import { contextBridge, ipcRenderer } from "electron";

// Minimal surface — token storage and the backend URL. Network calls happen
// in the renderer (sandboxed) using fetch with the JWT in the Authorization
// header; the main process never sees the request body or model traffic.
const api = {
  getToken: (): Promise<string | null> => ipcRenderer.invoke("auth:getToken"),
  setToken: (token: string): Promise<void> =>
    ipcRenderer.invoke("auth:setToken", token),
  clearToken: (): Promise<void> => ipcRenderer.invoke("auth:clearToken"),
  getBackendUrl: (): Promise<string> => ipcRenderer.invoke("app:backendUrl"),
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
