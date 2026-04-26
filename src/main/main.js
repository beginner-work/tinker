const { app, BrowserWindow, session, ipcMain, shell, nativeImage } = require("electron");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk").default;

const isDev = process.argv.includes("--dev");

// Show "beginner" in the macOS menu bar / app menus instead of "Electron".
// (Note: the dock label still comes from the bundle Info.plist when the app
// is packaged. Setting it here covers the unpackaged dev case.)
app.setName("beginner");

// ── Search engine (Claude Haiku) ────────────────────────────────────────
//
// The system prompt is identical across queries, so we mark it for prompt
// caching — after the first call the prefix is read from cache instead of
// re-processed on every search.

const SEARCH_SYSTEM_PROMPT = `You are the search engine for the beginner web browser — a quiet alternative to ad-driven search.

When you receive a query, write a calm, conversational answer in three to five short paragraphs that helps the reader understand the topic and where to go next. Embed Markdown links to specific, well-known websites — Wikipedia, official organisation sites, established publications, .gov pages — where the reader can read more or take action. Format links exactly as [label](https://example.com).

Voice: warm, plainspoken, calm. Address the reader as "you" where natural. No headings, no bulleted lists — just flowing prose, with short paragraphs separated by blank lines.

Only include links to sources you'd actually recommend and that you are confident exist. Do not invent URLs. If you are uncertain about a specific URL, omit the link rather than guess. It is better to write a confident paragraph with no link than to fabricate one.`;

let anthropicClient = null;
function getAnthropic() {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your environment and restart beginner."
    );
    err.code = "MISSING_API_KEY";
    throw err;
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

// ── LinkedIn plugin ─────────────────────────────────────────────────────
//
// Lets you write what's on your mind in the search bar and publish it as
// a LinkedIn post with a fixed attribution line appended. Requires:
//
//   LINKEDIN_ACCESS_TOKEN  — OAuth access token with w_member_social scope
//   LINKEDIN_AUTHOR_URN    — your member URN, e.g. "urn:li:person:abc123"

const LINKEDIN_TAGLINE = "made by me, supported by beginner";

ipcMain.handle("linkedin:post", async (_event, message) => {
  if (typeof message !== "string" || !message.trim()) {
    throw new Error("Post text is required");
  }
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const authorUrn = process.env.LINKEDIN_AUTHOR_URN;
  if (!token || !authorUrn) {
    const err = new Error(
      "LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN must be set in your environment."
    );
    err.code = "MISSING_LINKEDIN_CREDS";
    throw err;
  }

  const fullText = `${message.trim()}\n\n— ${LINKEDIN_TAGLINE}`;
  const body = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: fullText },
        shareMediaCategory: "NONE",
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LinkedIn API error ${res.status}: ${errBody.slice(0, 240)}`);
  }

  const postUrn = res.headers.get("x-restli-id") || (await res.json()).id;
  // x-restli-id looks like "urn:li:share:1234..."; the public URL form is
  // https://www.linkedin.com/feed/update/<urn>/
  const url = postUrn ? `https://www.linkedin.com/feed/update/${postUrn}/` : null;
  return { ok: true, postUrn, url, posted: fullText };
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
