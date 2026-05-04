const { app, BrowserWindow, session, ipcMain, shell, nativeImage } = require("electron");
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

// ── Trajectory organize prompt ──────────────────────────────────────────
//
// The hard line (product-spec §8): AI organizes human input only.
// No paraphrasing, no summarizing, no inventing language, no completing
// thoughts, no choosing colors not stated, no titles or headers.
// The model selects and arranges the founder's own words. Nothing more.

const ORGANIZE_SYSTEM_PROMPT = `You are a strict slot-filler for the tinker trajectory page.

You receive a raw transcript of a founder talking about an idea. You return JSON with exactly these slots, populated only with verbatim quotes from the transcript.

You may NOT paraphrase. You may NOT summarize. You may NOT invent language. You may NOT complete partial thoughts. You may NOT invent colors. You may NOT generate titles or headers. You may only select and arrange the founder's own words.

Schema:
{
  "start_feeling": string | null,
  "idea_in_their_words": string | null,
  "forward_feeling": string | null,
  "quoted_lines": string[],
  "chosen_colors": string[] | null
}

Slot rules:
- "start_feeling": a single direct quote (one sentence or fragment) that captures how the founder felt at the start, near the beginning of the transcript.
- "idea_in_their_words": one to three quoted lines (joined with a single newline) that articulate the idea itself.
- "forward_feeling": a single direct quote that captures forward motion, hope, or where they're headed.
- "quoted_lines": up to 5 additional verbatim quotes from elsewhere in the transcript that feel alive on their own. Empty array if none stand out.
- "chosen_colors": ONLY if the founder explicitly named colors in the transcript (e.g. "I see this as warm orange"). Use the exact color words they said. Otherwise null.

Every string in the output must be a contiguous substring of the transcript. If a slot can't be filled with a true quote, the slot is null (or [] for quoted_lines). It is better to leave a slot null than to bend a quote.

Return ONLY the JSON object. No prose, no markdown fences, no commentary.`;

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

// ── Trajectory storage ──────────────────────────────────────────────────
//
// Each dump is one JSON file under userData/trajectories/<slug>.json.
// Local-only for v1 — the "share link" rendered on the page is a fake
// placeholder string until the v1.1 publishing slice lands.

function trajectoriesDir() {
  const dir = path.join(app.getPath("userData"), "trajectories");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function trajectoryPath(slug) {
  // Defensive — slugs come from the renderer; allow only [a-z0-9-] up to 32 chars.
  if (!/^[a-z0-9-]{1,32}$/.test(slug)) {
    throw new Error("Invalid slug");
  }
  return path.join(trajectoriesDir(), slug + ".json");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#FFFDF7",
    title: "tinker",
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
  return `Mozilla/5.0 (${process.platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 tinker-browser/${app.getVersion()}`;
}

app.whenReady().then(() => {
  session.defaultSession.setUserAgent(userAgent());

  // Permission prompts — clipboard / fullscreen / microphone are allowed
  // by default (mic is required for the tinker voice-capture surface);
  // camera and notifications stay denied until we have a trust UI.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = [
      "clipboard-read",
      "clipboard-sanitized-write",
      "fullscreen",
      "media",
      "microphone",
      "audioCapture",
    ];
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

// ── Tinker: transcription ───────────────────────────────────────────────
//
// Whisper after-stop only (per build decision). Renderer records audio
// via MediaRecorder, hands us the bytes + mimetype, we forward to the
// OpenAI transcription endpoint and return the text.

ipcMain.handle("tinker:transcribe", async (_event, payload) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "OPENAI_API_KEY is not set. Add it to your environment and restart tinker."
    );
    err.code = "MISSING_OPENAI_KEY";
    throw err;
  }
  if (!payload || !payload.audioBase64) {
    throw new Error("audioBase64 is required");
  }
  const mimeType = payload.mimeType || "audio/webm";
  const ext = mimeType.includes("mp4") ? "mp4"
    : mimeType.includes("mpeg") ? "mp3"
    : mimeType.includes("wav") ? "wav"
    : "webm";

  const buf = Buffer.from(payload.audioBase64, "base64");
  const blob = new Blob([buf], { type: mimeType });
  const form = new FormData();
  form.append("file", blob, `dump.${ext}`);
  form.append("model", "whisper-1");
  form.append("response_format", "json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Whisper ${res.status}: ${body.slice(0, 240)}`);
  }
  const data = await res.json();
  return { text: (data && data.text) || "" };
});

// ── Tinker: organize transcript into trajectory payload ─────────────────

ipcMain.handle("tinker:organize", async (_event, transcript) => {
  if (typeof transcript !== "string" || !transcript.trim()) {
    throw new Error("Transcript is required");
  }
  const client = getAnthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: ORGANIZE_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: transcript.trim() }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  const raw = textBlock ? textBlock.text.trim() : "";
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Strip a stray markdown fence if the model adds one.
    const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    payload = JSON.parse(stripped);
  }
  return { payload, usage: message.usage };
});

// ── Tinker: save / load trajectory payload ──────────────────────────────

ipcMain.handle("tinker:save", async (_event, slug, payload) => {
  const file = trajectoryPath(slug);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return { slug, path: file };
});

ipcMain.handle("tinker:load", async (_event, slug) => {
  const file = trajectoryPath(slug);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
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
