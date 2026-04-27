const { app, BrowserWindow, session, ipcMain, shell, nativeImage } = require("electron");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk").default;

const isDev = process.argv.includes("--dev");

// Show "beginner" in the macOS menu bar / app menus instead of "Electron".
// (Note: the dock label still comes from the bundle Info.plist when the app
// is packaged. Setting it here covers the unpackaged dev case.)
app.setName("beginner");

// ── Smart navigation engine (Claude Haiku) ──────────────────────────────
//
// beginner has no "search results". The reader describes a starting point
// and we land them on the closest existing web page. If the page isn't
// quite right, they add more description and we jump again. The chain of
// descriptions is a session.
//
// The system prompt + tool definition are identical across queries, so we
// mark them for prompt caching — after the first call the prefix is read
// from cache instead of re-processed on every jump.

const NAV_SYSTEM_PROMPT = `You are the smart-navigation engine for the beginner web browser — a quiet alternative to result-list search.

The reader hands you a description of where they want to be. You answer with one URL: the closest existing web page that matches what they said. There is no result list, no ranking, no snippet — the reader sees the page itself.

You will receive a description chain (oldest → newest). On the first jump the chain has one entry. When the reader refines, the chain grows; treat the most recent entry as the strongest signal and the older ones as the surrounding intent. You will also receive the URL the reader is currently on, when there is one — use it to understand what they're moving away from, not as a place to return to.

Pick a real, canonical web page you are confident about: Wikipedia entries, official organisation sites, established publications, government pages, well-known reference works. Never invent a URL. If you can't pin down a specific page you trust, fall back to a canonical landing page (a homepage, a section index, a topic hub) you do trust — better a sturdy general page than a fabricated specific one.

Always answer by calling the arrive_at_page tool. Do not write any prose outside the tool call.`;

const NAVIGATE_TOOL = {
  name: "arrive_at_page",
  description:
    "Land the reader on a single existing web page that best matches their description chain.",
  input_schema: {
    type: "object",
    required: ["url", "title", "note"],
    properties: {
      url: {
        type: "string",
        description: "Full https:// URL of a real, existing web page.",
      },
      title: {
        type: "string",
        description: "Three to six words naming what's at that URL.",
      },
      note: {
        type: "string",
        description:
          "One calm, plainspoken sentence about what the reader will find there.",
      },
    },
  },
};

function formatNavUserMessage({ descriptions, currentUrl }) {
  const lines = ["Description chain (oldest → newest):"];
  descriptions.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
  if (currentUrl && /^https?:\/\//i.test(currentUrl)) {
    lines.push("", `Currently on: ${currentUrl}`);
  }
  return lines.join("\n");
}

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

ipcMain.handle("nav:resolve", async (_event, input) => {
  const descriptions = Array.isArray(input && input.descriptions)
    ? input.descriptions.map((d) => String(d || "").trim()).filter(Boolean)
    : [];
  if (descriptions.length === 0) {
    throw new Error("A description is required");
  }
  const currentUrl = typeof input.currentUrl === "string" ? input.currentUrl : "";

  const client = getAnthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: NAV_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [NAVIGATE_TOOL],
    tool_choice: { type: "tool", name: NAVIGATE_TOOL.name },
    messages: [
      {
        role: "user",
        content: formatNavUserMessage({ descriptions, currentUrl }),
      },
    ],
  });

  const toolUse = message.content.find(
    (b) => b.type === "tool_use" && b.name === NAVIGATE_TOOL.name
  );
  if (!toolUse || !toolUse.input || !toolUse.input.url) {
    throw new Error("Couldn't find a page that matches that description.");
  }
  return {
    url: String(toolUse.input.url),
    title: String(toolUse.input.title || ""),
    note: String(toolUse.input.note || ""),
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
