// The renderer is sandboxed; the preload exposes exactly this surface
// via contextBridge. Mirror the shape here so the renderer's tsconfig
// can stay scoped to renderer files only.
interface Api {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  getBackendUrl(): Promise<string>;
}

declare global {
  interface Window {
    api: Api;
  }
}

export const storage = {
  getToken: () => window.api.getToken(),
  setToken: (token: string) => window.api.setToken(token),
  clearToken: () => window.api.clearToken(),
  getBackendUrl: () => window.api.getBackendUrl(),
};
