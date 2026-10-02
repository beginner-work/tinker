const {
  app,
  BrowserWindow,
  Menu,
  session,
  ipcMain,
  shell,
  dialog,
  nativeImage,
  nativeTheme,
  net,
  WebContentsView,
} = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

// Production Tinker. The desktop shell is a hardened BrowserWindow around
// this origin — web product changes ship without a new dmg; only shell
// changes (menus, notes IPC, packaging, docked panels) need a rebuild.
const APP_ORIGIN = "https://tinker.beginner.work";
const APP_URL = process.env.TINKER_DESKTOP_URL || APP_ORIGIN;
const DOCK_PARTITION = "persist:tinker-docked";
const DOCK_TOOLBAR_H = 44;
const DOCKABLE_HOSTS = new Set([
  "elevenreader.io",
  "www.elevenreader.io",
  "formation.dev",
  "www.formation.dev",
]);

// Matches --color-background in src/renderer/styles.css / critical CSS.
// The product is light-only today; keep one cream surface so the native
// title-bar chrome and the web content read as one plane.
const APP_BG_LIGHT = "#FFFDF7";
const APP_BG_DARK = "#FFFDF7";
const APP_FG = "#2D2A26";

const isDev = process.argv.includes("--dev");

// Show "tinker" in the macOS menu bar / app menus instead of "Electron".
app.setName("tinker");

const STATE_PATH = () => path.join(app.getPath("userData"), "window-state.json");

function appBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? APP_BG_DARK : APP_BG_LIGHT;
}

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

function isDockableUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && DOCKABLE_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Per-window docked ElevenReader / Formation panel (WebContentsView).
const dockByWin = new WeakMap();

function mainContentView(win) {
  if (!win || win.isDestroyed()) return null;
  const root = win.contentView;
  const children = root && root.children ? root.children : [];
  for (const child of children) {
    if (child && child.webContents && win.webContents && child.webContents.id === win.webContents.id) {
      return child;
    }
  }
  return children[0] || null;
}

function dockToolbarHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  html,body{margin:0;height:100%;background:#FFFDF7;color:#2D2A26;
    font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;}
  .bar{display:flex;align-items:center;gap:8px;height:100%;padding:0 10px;
    border-bottom:1px solid #EDE8E0;box-sizing:border-box;
    -webkit-app-region:drag;}
  button{-webkit-app-region:no-drag;appearance:none;border:1px solid #EDE8E0;
    background:transparent;color:#2D2A26;border-radius:8px;padding:5px 10px;
    font:inherit;cursor:pointer;}
  button:hover{background:#F5F3EF;}
  .spacer{flex:1}
  .title{color:#6F6A65;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
</style></head><body>
<div class="bar">
  <button type="button" id="close">Close</button>
  <button type="button" id="browser">Open in browser</button>
  <span class="spacer"></span>
  <span class="title" id="title"></span>
</div>
<script>
  document.getElementById("close").onclick = () => window.tinkerDock && window.tinkerDock.close();
  document.getElementById("browser").onclick = () => window.tinkerDock && window.tinkerDock.openBrowser();
  if (window.tinkerDock && window.tinkerDock.onTitle) {
    window.tinkerDock.onTitle((t) => { document.getElementById("title").textContent = t || ""; });
  }
</script>
</body></html>`;
}

function layoutDock(win) {
  const state = dockByWin.get(win);
  if (!state || !state.panel) return;
  const [width, height] = win.getContentSize();
  const dockW = Math.max(320, Math.min(560, Math.floor(width * 0.46)));
  const mainW = Math.max(360, width - dockW);
  const actualDockW = width - mainW;
  const main = mainContentView(win);
  if (main && typeof main.setBounds === "function") {
    main.setBounds({ x: 0, y: 0, width: mainW, height });
  }
  if (state.toolbar) {
    state.toolbar.setBounds({ x: mainW, y: 0, width: actualDockW, height: DOCK_TOOLBAR_H });
  }
  state.panel.setBounds({
    x: mainW,
    y: DOCK_TOOLBAR_H,
    width: actualDockW,
    height: Math.max(0, height - DOCK_TOOLBAR_H),
  });
}

function clearDockLayout(win) {
  const [width, height] = win.getContentSize();
  const main = mainContentView(win);
  if (main && typeof main.setBounds === "function") {
    main.setBounds({ x: 0, y: 0, width, height });
  }
}

function closeDockedPanel(win) {
  const state = dockByWin.get(win);
  if (!state) return false;
  try {
    if (state.panel) win.contentView.removeChildView(state.panel);
    if (state.toolbar) win.contentView.removeChildView(state.toolbar);
  } catch {
    /* ignore */
  }
  try {
    if (state.panel && state.panel.webContents && !state.panel.webContents.isDestroyed()) {
      state.panel.webContents.destroy();
    }
  } catch {
    /* ignore */
  }
  try {
    if (state.toolbar && state.toolbar.webContents && !state.toolbar.webContents.isDestroyed()) {
      state.toolbar.webContents.destroy();
    }
  } catch {
    /* ignore */
  }
  dockByWin.delete(win);
  clearDockLayout(win);
  return true;
}

function openDockedPanel(win, url) {
  if (!win || win.isDestroyed()) return false;
  if (!isDockableUrl(url)) return false;
  let state = dockByWin.get(win);
  if (!state) {
    const toolbar = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "dock-toolbar-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const panel = new WebContentsView({
      webPreferences: {
        partition: DOCK_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
      },
    });
    // Pure browsing pane — no script injection into Formation / ElevenReader.
    panel.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      if (isDockableUrl(openUrl)) {
        panel.webContents.loadURL(openUrl);
      } else if (/^https?:\/\//i.test(openUrl)) {
        shell.openExternal(openUrl);
      }
      return { action: "deny" };
    });
    win.contentView.addChildView(toolbar);
    win.contentView.addChildView(panel);
    toolbar.webContents.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(dockToolbarHtml()));
    state = { toolbar, panel, url: "" };
    dockByWin.set(win, state);
    win.on("resize", () => layoutDock(win));
  }
  state.url = url;
  state.panel.webContents.loadURL(url);
  const sendTitle = () => {
    try {
      if (state.toolbar && !state.toolbar.webContents.isDestroyed()) {
        state.toolbar.webContents.send("dock:title", url);
      }
    } catch {
      /* ignore */
    }
  };
  state.toolbar.webContents.once("did-finish-load", sendTitle);
  sendTitle();
  layoutDock(win);
  return true;
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
            if (win) win.webContents.reloadIgnoringCache();
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

function tinkerSession() {
  return session.fromPartition("persist:tinker");
}

// Strip long-lived HTTP cache so new web deploys show up without a
// reinstall. HTML already ships must-revalidate; CSS/JS on Vercel can
// sit at max-age=86400 — override that inside the desktop session only.
function installDesktopCachePolicy(ses) {
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!isTinkerUrl(details.url)) {
      callback({});
      return;
    }
    const headers = { ...(details.responseHeaders || {}) };
    const bypass = ["no-cache", "max-age=0", "must-revalidate"];
    // Electron may lowercase keys; clear every Cache-Control variant.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "cache-control") delete headers[key];
    }
    headers["Cache-Control"] = bypass;
    callback({ responseHeaders: headers });
  });
}

// Reload when a focus returns after a deploy (etag / last-modified change).
let lastDeployToken = null;
let deployCheckInFlight = false;

async function deployToken() {
  const res = await net.fetch(APP_URL, {
    method: "HEAD",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  // Prefer stable validators only — age / request ids change every hit
  // and would reload on every focus.
  return res.headers.get("etag") || res.headers.get("last-modified") || "";
}

async function reloadIfDeployed(win) {
  if (!win || win.isDestroyed() || deployCheckInFlight) return;
  deployCheckInFlight = true;
  try {
    const token = await deployToken();
    if (!token) return;
    if (lastDeployToken && token !== lastDeployToken) {
      win.webContents.reloadIgnoringCache();
    }
    lastDeployToken = token;
  } catch {
    // Offline / preview — leave the current page alone.
  } finally {
    deployCheckInFlight = false;
  }
}

function windowChromeOptions() {
  const backgroundColor = appBackgroundColor();
  if (process.platform === "darwin") {
    // Align traffic lights with the sidebar brand row (logo sits to the
    // right via ~78px left inset from desktop CSS / insertDesktopCss).
    return {
      backgroundColor,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
    };
  }
  // Windows / Linux: overlay traffic-control buttons on the same cream.
  return {
    backgroundColor,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: backgroundColor,
      symbolColor: APP_FG,
      height: 36,
    },
  };
}

// Electron-only chrome. Allowed differences vs web at the same size:
//   (a) traffic-light clearance — left inset on .sidebar__top only + drag
//   (b) native window background (BrowserWindow backgroundColor)
// Do NOT change paddings, font sizes, sidebar width, or pane chrome.
const DESKTOP_CHROME_CSS = `
html {
  --tinker-desktop-traffic-inset: 78px;
}
.sidebar__top {
  -webkit-app-region: drag;
  padding-left: 78px !important;
}
.messages-pane__top {
  -webkit-app-region: drag;
}
.sidebar__top a,
.sidebar__top button,
.sidebar__top input,
.sidebar__top textarea,
.sidebar__top select,
.sidebar__top [role="button"],
.messages-pane__top a,
.messages-pane__top button,
.messages-pane__top input,
.messages-pane__top textarea,
.messages-pane__top select,
.messages-pane__top [role="button"] {
  -webkit-app-region: no-drag;
}
`;

function markDesktopInPage(wc) {
  if (!wc || wc.isDestroyed()) return;
  wc.executeJavaScript(
    `(function(){var r=document.documentElement;if(!r)return;r.setAttribute("data-tinker-desktop","1");r.classList.add("tinker-desktop");})();`,
    true
  ).catch(() => {});
}

function insertDesktopCss(wc) {
  if (!wc || wc.isDestroyed()) return;
  wc.insertCSS(DESKTOP_CHROME_CSS).catch(() => {});
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
    title: "tinker",
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    icon: fs.existsSync(icon) ? icon : undefined,
    ...windowChromeOptions(),
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
  // Same-origin routes (/, /feed, /settings, inbox deep links, …) load
  // in-window so the desktop shell matches the web app.
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

  // Re-apply marker + chrome CSS on every in-window navigation (preload
  // also marks, but remote loads have raced past first paint before).
  win.webContents.on("dom-ready", () => {
    markDesktopInPage(win.webContents);
    insertDesktopCss(win.webContents);
  });
  win.webContents.on("did-finish-load", () => {
    markDesktopInPage(win.webContents);
  });

  win.on("focus", () => {
    reloadIfDeployed(win);
  });

  win.on("closed", () => {
    closeDockedPanel(win);
  });

  win.loadURL(APP_URL);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}

function syncNativeChromeColor() {
  const color = appBackgroundColor();
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    try {
      w.setBackgroundColor(color);
    } catch {
      /* ignore */
    }
    if (process.platform !== "darwin" && typeof w.setTitleBarOverlay === "function") {
      try {
        w.setTitleBarOverlay({
          color,
          symbolColor: APP_FG,
          height: 36,
        });
      } catch {
        /* overlay unsupported on this build */
      }
    }
  }
}

app.whenReady().then(() => {
  const ses = tinkerSession();

  // Desktop Chrome UA (no Electron token). Match real Chrome/Safari desktop
  // so feature / UA detection never takes a mobile or odd-platform branch.
  const chromeVersion = process.versions.chrome;
  const platformToken =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  const ua = `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  ses.setUserAgent(ua);

  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = ["clipboard-read", "clipboard-sanitized-write", "fullscreen", "notifications"];
    cb(allowed.includes(permission));
  });

  installDesktopCachePolicy(ses);

  const icon = appIconPath();
  if (process.platform === "darwin" && app.dock && fs.existsSync(icon)) {
    const img = nativeImage.createFromPath(icon);
    if (!img.isEmpty()) app.dock.setIcon(img);
  }

  buildAppMenu();
  createWindow();

  nativeTheme.on("updated", syncNativeChromeColor);

  // Seed deploy token so the first focus after launch can detect a change.
  reloadIfDeployed(BrowserWindow.getAllWindows()[0]).catch(() => {});

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

ipcMain.handle("dock:open", (event, url) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (!win) return false;
  return openDockedPanel(win, String(url || ""));
});

ipcMain.handle("dock:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (!win) return false;
  return closeDockedPanel(win);
});

ipcMain.on("dock:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (win) closeDockedPanel(win);
});

ipcMain.on("dock:openBrowser", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  const state = win ? dockByWin.get(win) : null;
  if (state && state.url && /^https?:\/\//i.test(state.url)) {
    shell.openExternal(state.url);
  }
});

ipcMain.handle("cursorRoot:pick", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: "Choose Cursor project folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) return null;
  const folderPath = result.filePaths[0];
  return { path: folderPath, name: path.basename(folderPath) };
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
