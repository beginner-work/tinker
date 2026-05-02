import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  session,
  shell,
} from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const isDev = !app.isPackaged;

// Display name in macOS menu bar.
app.setName("tinker");

// Encrypted token sits at <userData>/auth.bin. safeStorage encrypts with the
// OS keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux). We
// never write the plaintext JWT to disk.
function tokenPath(): string {
  const dir = app.getPath("userData");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "auth.bin");
}

function readToken(): string | null {
  const file = tokenPath();
  if (!existsSync(file)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = readFileSync(file);
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

function writeToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS keychain unavailable — cannot store token securely");
  }
  const buf = safeStorage.encryptString(token);
  writeFileSync(tokenPath(), buf, { mode: 0o600 });
}

function eraseToken(): void {
  const file = tokenPath();
  if (existsSync(file)) rmSync(file, { force: true });
}

function backendUrl(): string {
  // Production backend lives at www.beginner.work. We default to the www
  // host directly because the apex (beginner.work) issues a 301 redirect
  // to www, and Chromium refuses to follow redirects through a CORS
  // preflight — the request would fail before our header injection runs.
  // Override with BACKEND_URL (e.g. http://localhost:4000) when
  // developing against a local server.
  return process.env.BACKEND_URL || "https://www.beginner.work";
}

// CORS bypass for the configured backend.
//
// In dev the renderer loads from http://localhost:5173; in packaged builds
// it loads from file://. Either way, fetches to https://beginner.work are
// cross-origin and Chromium will preflight them. The backend opens CORS
// (`app.use(cors())`), but Electron's renderer is fussier than a real
// browser about preflight handling — and we'd rather not depend on the
// server's CORS config being perfectly tuned for every Electron origin.
//
// So we intercept all responses from the backend in the main process and
// inject permissive ACAO/ACAH/ACAM headers. We also force OPTIONS
// preflight responses to 200 so the renderer proceeds even if the server
// returns 4xx for the preflight. Side-stepping CORS is safe here because
// the *only* code allowed to issue these requests is our own renderer
// bundle (sandboxed, CSP-locked); there's no untrusted third-party
// JavaScript that could exploit the loosened headers.
function attachCorsBypass(): void {
  const url = backendUrl();
  let patterns: string[];
  try {
    const u = new URL(url);
    // Cover both apex and www variants so a redirect (or a typo in
    // BACKEND_URL) doesn't slip past the bypass.
    const host = u.host;
    const stripped = host.replace(/^www\./, "");
    const hosts = new Set([host, stripped, `www.${stripped}`]);
    patterns = [...hosts].map((h) => `${u.protocol}//${h}/*`);
  } catch {
    return;
  }
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: patterns },
    (details, callback) => {
      const headers: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(details.responseHeaders ?? {})) {
        // Drop server-supplied CORS headers — we replace them below to
        // avoid the "multiple Access-Control-Allow-Origin" browser error.
        if (k.toLowerCase().startsWith("access-control-")) continue;
        headers[k] = Array.isArray(v) ? v : [String(v)];
      }
      headers["Access-Control-Allow-Origin"] = ["*"];
      headers["Access-Control-Allow-Headers"] = ["*"];
      headers["Access-Control-Allow-Methods"] = ["GET, POST, OPTIONS"];
      headers["Access-Control-Expose-Headers"] = ["*"];

      const isPreflight = details.method === "OPTIONS";
      const statusLine =
        isPreflight && details.statusCode !== 200
          ? "HTTP/1.1 200 OK"
          : details.statusLine;

      callback({ responseHeaders: headers, statusLine });
    }
  );
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#FFFDF7",
    title: "tinker",
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // External links open in the user's default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // electron-vite serves the renderer over HTTP in dev so HMR works; in
  // packaged builds we load the bundled index.html from disk.
  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  attachCorsBypass();

  ipcMain.handle("auth:getToken", () => readToken());
  ipcMain.handle("auth:setToken", (_e, token: unknown) => {
    if (typeof token !== "string" || !token) {
      throw new Error("token must be a non-empty string");
    }
    writeToken(token);
  });
  ipcMain.handle("auth:clearToken", () => eraseToken());
  ipcMain.handle("app:backendUrl", () => backendUrl());

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
