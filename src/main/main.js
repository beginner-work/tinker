const { app, BrowserWindow, session, ipcMain, shell, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
// Lazy-load the Anthropic SDK on first search so cold launch is not paying
// for a module the inbox shell never needs.
let Anthropic = null;

const isDev = process.argv.includes("--dev");

// Show "tinker" in the macOS menu bar / app menus instead of "Electron".
// (Note: the dock label still comes from the bundle Info.plist when the app
// is packaged. Setting it here covers the unpackaged dev case.)
app.setName("tinker");

// ── Search engine (Claude Haiku) ────────────────────────────────────────
//
// The system prompt is identical across queries, so we mark it for prompt
// caching — after the first call the prefix is read from cache instead of
// re-processed on every search.

const SEARCH_SYSTEM_PROMPT = `You are the search engine for the tinker web browser — a quiet alternative to ad-driven search.

When you receive a query, write a calm, conversational answer in three to five short paragraphs that helps the reader understand the topic and where to go next. Embed Markdown links to specific, well-known websites — Wikipedia, official organisation sites, established publications, .gov pages — where the reader can read more or take action. Format links exactly as [label](https://example.com).

Voice: warm, plainspoken, calm. Address the reader as "you" where natural. No headings, no bulleted lists — just flowing prose, with short paragraphs separated by blank lines.

Only include links to sources you'd actually recommend and that you are confident exist. Do not invent URLs. If you are uncertain about a specific URL, omit the link rather than guess. It is better to write a confident paragraph with no link than to fabricate one.`;

let anthropicClient = null;
function getAnthropic() {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your environment and restart tinker."
    );
    err.code = "MISSING_API_KEY";
    throw err;
  }
  if (!Anthropic) {
    Anthropic = require("@anthropic-ai/sdk").default;
  }
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#FFFDF7",
    title: "tinker",
    show: false,
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

  // Show once the first paint is ready so users never see an empty frame.
  win.once("ready-to-show", () => {
    win.show();
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
  return `Mozilla/5.0 (${process.platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 tinker-browser/${app.getVersion()}`;
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
ipcMain.handle("app:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (win) win.close();
});

ipcMain.handle("search:query", async (_event, query) => {
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("Query is required");
  }
  const client = getAnthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SEARCH_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: query.trim() }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  return {
    text: textBlock ? textBlock.text : "",
    usage: message.usage,
  };
});

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

// ── Notes folder (LL-72): native directory pick + Markdown file IO ──────
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
