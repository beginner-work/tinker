const { app, BrowserWindow, session, ipcMain, shell, nativeImage } = require("electron");
const path = require("path");

const isDev = process.argv.includes("--dev");

// Show "beginner" in the macOS menu bar / app menus instead of "Electron".
// (Note: the dock label still comes from the bundle Info.plist when the app
// is packaged. Setting it here covers the unpackaged dev case.)
app.setName("beginner");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#FFFDF7",
    title: "beginner",
    autoHideMenuBar: true,
    // Drop the native title bar — our chrome paints the whole top.
    // 'hiddenInset' keeps the macOS traffic lights but removes the bar;
    // on Windows/Linux it falls back gracefully to a frameless window.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
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

// Renderer renders the seed-mark SVG to a PNG data URL and hands it
// here so we can set the dock / window icon. (nativeImage doesn't
// read SVG, so we delegate the rasterization to the renderer.)
ipcMain.handle("app:setIcon", (_event, dataUrl) => {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png")) {
    return false;
  }
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) return false;
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(img);
  }
  for (const w of BrowserWindow.getAllWindows()) {
    w.setIcon(img);
  }
  return true;
});
