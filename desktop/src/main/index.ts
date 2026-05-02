import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const isDev = !app.isPackaged;

// Display name in macOS menu bar.
app.setName("tinker chat");

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
  return process.env.BACKEND_URL || "http://localhost:4000";
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#FFFDF7",
    title: "tinker chat",
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
