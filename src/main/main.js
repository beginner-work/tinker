const { app, BrowserWindow, session, ipcMain, shell, nativeImage, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk").default;

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
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

// ── Backend URL resolution ──────────────────────────────────────────────
//
// Order of precedence (first match wins):
//   1. BACKEND_URL env var — explicit override; useful for QA / staging.
//   2. dev or unpackaged build → http://localhost:4000
//   3. TINKER_USE_VERCEL_PREVIEW=1 (+ VERCEL_TOKEN, VERCEL_PROJECT_ID) →
//      latest READY preview deployment from the Vercel API. Resolved once
//      at startup and cached for the session.
//   4. production → https://beginner.work
//
// We resolve once at app-ready and cache the result so every IPC call
// returns the same value (avoids a flicker between fetches).

const PRODUCTION_URL = "https://beginner.work";
let backendUrlCache = null;

async function fetchLatestVercelPreview() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;
  try {
    const u = new URL("https://api.vercel.com/v6/deployments");
    u.searchParams.set("projectId", projectId);
    u.searchParams.set("state", "READY");
    u.searchParams.set("target", "preview");
    u.searchParams.set("limit", "1");
    if (process.env.VERCEL_TEAM_ID) u.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const json = await res.json();
    const url = json.deployments?.[0]?.url;
    return url ? `https://${url}` : null;
  } catch {
    return null;
  }
}

async function resolveBackendUrl() {
  if (backendUrlCache) return backendUrlCache;
  if (process.env.BACKEND_URL) {
    backendUrlCache = process.env.BACKEND_URL;
    return backendUrlCache;
  }
  if (isDev || !app.isPackaged) {
    backendUrlCache = "http://localhost:4000";
    return backendUrlCache;
  }
  if (process.env.TINKER_USE_VERCEL_PREVIEW === "1") {
    const preview = await fetchLatestVercelPreview();
    if (preview) {
      backendUrlCache = preview;
      return backendUrlCache;
    }
  }
  backendUrlCache = PRODUCTION_URL;
  return backendUrlCache;
}

// ── JWT storage (safeStorage) ───────────────────────────────────────────
//
// Encrypt the JWT bytes with the OS keychain (Keychain on mac, DPAPI on
// Windows, libsecret on Linux) and write to a 0600 file in userData. If
// the platform doesn't expose a keychain (e.g. headless Linux without
// libsecret) we refuse to persist — better in-memory-only than plaintext
// on disk.

const TOKEN_FILE_NAME = "claude-token.bin";
function tokenPath() {
  return path.join(app.getPath("userData"), TOKEN_FILE_NAME);
}

function readToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const p = tokenPath();
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

function writeToken(token) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (typeof token !== "string" || !token) return false;
    const enc = safeStorage.encryptString(token);
    fs.writeFileSync(tokenPath(), enc, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function clearToken() {
  try { fs.unlinkSync(tokenPath()); } catch {}
  return true;
}

// ── Onboarding state (encrypted, resumable across launches) ─────────────
//
// Stored as a single safeStorage-encrypted JSON blob in userData. Schema:
//   { version, userId, history, offering, done, updatedAt }
// The userId is the ClaudeUser id from the JWT — the renderer checks it
// before restoring so a different user logging in doesn't see another
// user's draft.

const ONBOARDING_FILE_NAME = "onboarding.bin";
function onboardingPath() {
  return path.join(app.getPath("userData"), ONBOARDING_FILE_NAME);
}

function readOnboarding() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const p = onboardingPath();
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    return JSON.parse(safeStorage.decryptString(buf));
  } catch {
    return null;
  }
}

function writeOnboarding(data) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (!data || typeof data !== "object") return false;
    const enc = safeStorage.encryptString(JSON.stringify(data));
    fs.writeFileSync(onboardingPath(), enc, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function clearOnboarding() {
  try { fs.unlinkSync(onboardingPath()); } catch {}
  return true;
}

// ── Windows ─────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#FFFDF7",
    title: "tinker",
    autoHideMenuBar: true,
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

let chatWindow = null;
function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    return chatWindow;
  }
  chatWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#FFFDF7",
    title: "tinker chat",
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      // Dedicated preload — exposes ONLY the auth + config surface.
      // No webviewTag, no Anthropic client, no IPC for browser ops.
      preload: path.join(__dirname, "preload-chat.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  chatWindow.loadFile(path.join(__dirname, "..", "renderer", "chat", "index.html"));
  if (isDev) chatWindow.webContents.openDevTools({ mode: "detach" });
  chatWindow.on("closed", () => { chatWindow = null; });
  return chatWindow;
}

// Reasonable, modern UA string. The default Electron UA leaks the
// Electron version and trips bot detection on some sites.
function userAgent() {
  const chromeVersion = process.versions.chrome;
  return `Mozilla/5.0 (${process.platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 tinker-browser/${app.getVersion()}`;
}

// ── CORS workaround ─────────────────────────────────────────────────────
//
// Electron renderer pages loaded via loadFile run on the `file://` origin,
// which some servers reject in CORS preflight even when `cors()` is wide
// open. We sidestep this by rewriting the Origin header on requests that
// target the resolved backend host: the server sees a stable, allow-listed
// origin and the preflight succeeds. The renderer still uses fetch() and
// streams response.body normally.
async function installBackendCorsHook() {
  const stableOrigin = "https://tinker.beginner.work";
  let backendHost = null;
  try {
    backendHost = new URL(await resolveBackendUrl()).host;
  } catch {}

  session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
    try {
      const target = new URL(details.url);
      if (backendHost && target.host === backendHost) {
        details.requestHeaders["Origin"] = stableOrigin;
      }
    } catch {}
    cb({ requestHeaders: details.requestHeaders });
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────

app.whenReady().then(async () => {
  session.defaultSession.setUserAgent(userAgent());

  // Permission prompts — for now allow clipboard / fullscreen by default,
  // and deny camera/mic/notifications until we have a trust UI.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = ["clipboard-read", "clipboard-sanitized-write", "fullscreen"];
    cb(allowed.includes(permission));
  });

  // Resolve backend URL early so the CORS hook has a host to match against.
  await resolveBackendUrl().catch(() => {});
  await installBackendCorsHook();

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

// ── Chat-client IPC ─────────────────────────────────────────────────────

ipcMain.handle("auth:getToken", () => readToken());
ipcMain.handle("auth:setToken", (_e, token) => writeToken(token));
ipcMain.handle("auth:clearToken", () => clearToken());
ipcMain.handle("onboarding:get", () => readOnboarding());
ipcMain.handle("onboarding:set", (_e, data) => writeOnboarding(data));
ipcMain.handle("onboarding:clear", () => clearOnboarding());
ipcMain.handle("config:backendUrl", () => resolveBackendUrl());
ipcMain.handle("chat:open", () => {
  createChatWindow();
  return true;
});
