const { app, BrowserWindow, session, ipcMain, shell } = require("electron");
const path = require("path");

const isDev = process.argv.includes("--dev");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#FFFDF7",
    title: "beginner",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  // External windows (target=_blank, window.open) open in the user's
  // default OS browser instead of stealing focus inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// Reasonable, modern UA string. The default Electron UA leaks the
// Electron version and trips bot detection on some sites.
function userAgent() {
  const chromeVersion = process.versions.chrome;
  return `Mozilla/5.0 (${process.platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 beginner-browser/${app.getVersion()}`;
}

app.whenReady().then(() => {
  session.defaultSession.setUserAgent(userAgent());

  // Permission prompts — for now allow clipboard / fullscreen by default,
  // and deny camera/mic/notifications until we have a trust UI.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = ["clipboard-read", "clipboard-sanitized-write", "fullscreen"];
    cb(allowed.includes(permission));
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("app:platform", () => process.platform);
