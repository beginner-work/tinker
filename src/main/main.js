const { app, BrowserWindow, Menu, session, ipcMain, shell, dialog, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

// Production Tinker. The desktop shell is a hardened BrowserWindow around
// this origin — web product changes ship without a new dmg; only shell
// changes (menus, notes IPC, packaging) need a rebuild.
const APP_ORIGIN = "https://tinker.beginner.work";
const APP_URL = process.env.TINKER_DESKTOP_URL || APP_ORIGIN;

const isDev = process.argv.includes("--dev");

// Show "tinker" in the macOS menu bar / app menus instead of "Electron".
app.setName("tinker");

const STATE_PATH = () => path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH(), "utf8"));
    if (!raw || typeof raw !== "object") return defaultWindowState();
    return {
      x: Number.isFinite(raw.x) ? raw.x : undefined,
      y: Number.isFinite(raw.y) ? raw.y : undefined,
      width: Number.isFinite(raw.width) && raw.width >= 720 ? raw.width : 1280,
      height: Number.isFinite(raw.height) && raw.height >= 480 ? raw.height : 820,
      isMaximized: !!raw.isMaximized,
    };
  } catch {
    return defaultWindowState();
  }
}

function defaultWindowState() {
  return { width: 1280, height: 820, isMaximized: false };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const state = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized(),
  };
  try {
    fs.writeFileSync(STATE_PATH(), JSON.stringify(state));
  } catch {
    // Ignore disk errors — losing window size is fine.
  }
}

function isTinkerUrl(url) {
  try {
    const u = new URL(url);
    return u.origin === APP_ORIGIN || (isDev && u.origin === new URL(APP_URL).origin);
  } catch {
    return false;
  }
}

function appIconPath() {
  // Packaged: resources/icon.png (electron-builder). Dev: renderer icons.
  const packaged = path.join(process.resourcesPath || "", "icon.png");
  if (process.resourcesPath && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "..", "renderer", "icons", "tinker-icon-512.png");
}

function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: (_item, win) => {
            if (win) win.reload();
          },
        },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(isMac
          ? [
              { role: "pasteAndMatchStyle" },
              { role: "delete" },
              { role: "selectAll" },
              { type: "separator" },
              {
                label: "Speech",
                submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
              },
            ]
          : [{ role: "delete" }, { type: "separator" }, { role: "selectAll" }]),
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        ...(isDev
          ? [{ type: "separator" }, { role: "toggleDevTools" }]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" }, { role: "front" }]
          : [{ role: "close" }]),
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Open Tinker in browser",
          click: () => {
            shell.openExternal(APP_ORIGIN);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const state = loadWindowState();
  const icon = appIconPath();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#FFFDF7",
    title: "tinker",
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // Persist sign-in (localStorage JWT) and site data across launches.
      partition: "persist:tinker",
      spellcheck: true,
    },
  });

  if (state.isMaximized) win.maximize();

  win.once("ready-to-show", () => {
    win.show();
  });

  const persist = () => saveWindowState(win);
  win.on("resize", persist);
  win.on("move", persist);
  win.on("close", persist);

  // Stay on the Tinker origin; everything else opens in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isTinkerUrl(url)) {
      win.loadURL(url);
    } else {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!isTinkerUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.loadURL(APP_URL);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}

app.whenReady().then(() => {
  // Modern Chrome UA without advertising Electron (some auth / bot checks
  // treat the default Electron UA as non-browser).
  const chromeVersion = process.versions.chrome;
  const ua = `Mozilla/5.0 (${process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : process.platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  session.fromPartition("persist:tinker").setUserAgent(ua);

  session.fromPartition("persist:tinker").setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = ["clipboard-read", "clipboard-sanitized-write", "fullscreen", "notifications"];
    cb(allowed.includes(permission));
  });

  const icon = appIconPath();
  if (process.platform === "darwin" && app.dock && fs.existsSync(icon)) {
    const img = nativeImage.createFromPath(icon);
    if (!img.isEmpty()) app.dock.setIcon(img);
  }

  buildAppMenu();
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
ipcMain.handle("app:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (win) win.close();
});
ipcMain.handle("app:openExternal", (_event, url) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  shell.openExternal(url);
  return true;
});

// Renderer (or production icon-init) may hand a PNG data URL for the dock.
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

// ── Notes folder: native directory pick + Markdown file IO ──────────────
// Paths stay on the user's machine. No owner-specific defaults.

function assertInsideRoot(rootDir, relPath) {
  const root = path.resolve(String(rootDir || ""));
  const target = path.resolve(root, String(relPath || ""));
  const rel = path.relative(root, target);
  if (!root || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes notes folder.");
  }
  return { root, target };
}

async function walkMarkdown(rootDir, dir, prefix, out) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(rootDir, abs, rel, out);
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      const text = await fsp.readFile(abs, "utf8");
      const st = await fsp.stat(abs);
      out.push({ relPath: rel.replace(/\\/g, "/"), text, mtimeMs: st.mtimeMs || 0 });
    }
  }
}

ipcMain.handle("notesFolder:pick", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: "Choose notes folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) return null;
  const folderPath = result.filePaths[0];
  return { path: folderPath, name: path.basename(folderPath) };
});

ipcMain.handle("notesFolder:list", async (_event, rootDir) => {
  const root = path.resolve(String(rootDir || ""));
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  await walkMarkdown(root, root, "", out);
  return out;
});

ipcMain.handle("notesFolder:write", async (_event, rootDir, relPath, text) => {
  const { target } = assertInsideRoot(rootDir, relPath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, String(text == null ? "" : text), "utf8");
  return true;
});

ipcMain.handle("notesFolder:move", async (_event, rootDir, fromRel, toRel) => {
  const from = assertInsideRoot(rootDir, fromRel);
  const to = assertInsideRoot(rootDir, toRel);
  if (from.target === to.target) return true;
  if (!fs.existsSync(from.target)) return false;
  await fsp.mkdir(path.dirname(to.target), { recursive: true });
  await fsp.rename(from.target, to.target);
  return true;
});

ipcMain.handle("notesFolder:remove", async (_event, rootDir, relPath) => {
  const { target } = assertInsideRoot(rootDir, relPath);
  if (!fs.existsSync(target)) return false;
  await fsp.unlink(target);
  return true;
});
