const { app, BrowserWindow, session, ipcMain, shell, nativeImage } = require("electron");
const path = require("path");
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

// ── Content harness (pitch decks) ───────────────────────────────────────
//
// The .claude/skills/content-harness skill drives the structured intake;
// this handler is the generation step. The system prompt is durable —
// slide structure, voice rules, reweighting per archetype — so we mark it
// for prompt caching. Per-request inputs (free-text answers, decision
// answers, follow-ups) are passed as JSON in the user message.

const CONTENT_HARNESS_SYSTEM_PROMPT = `You are the pitch-deck author for tinker's content-harness skill. You receive a structured intake — free-text company facts plus four decision answers plus targeted follow-ups — and produce a complete pitch deck in Markdown. The intake is the contract: do not ask for more, do not invent facts not provided.

# Output format

Open the deck with a single \`## Shape note\` section recording every choice from the intake: voice, investor archetype, top concern, depth, and each follow-up answer. One short paragraph, no bullets. This is the audit trail that makes re-shaping cheap.

Then render the deck. One slide per \`## Slide N — <title>\` heading. Under each slide:
- First line: a single bolded headline.
- Body: bullets or a short paragraph.
- End with a \`> \` blockquote of speaker notes (1–3 sentences).

Use \`[needs: ...]\` placeholders where the intake didn't supply a number, logo, or proof point. Never fabricate metrics, customer names, or quotes.

# Slide structure

Default order: 1. Cover · 2. Problem · 3. Solution · 4. Why now · 5. Market · 6. Product · 7. Traction · 8. Business model · 9. Team · 10. Ask.

Apply the depth from the intake:
- Short → 8 slides, drop Why now and either Market or Business model based on which is weaker for the chosen audience.
- Standard → 10–12 slides.
- Long → 15+ slides; add the appendix slides the user picked in the follow-up.

Then front-load the slide that matches the user's top concern. If top concern is Traction, move slide 7 to position 2 or 3. If Team, move slide 9. If Market, lead with slide 5. If Defensibility or Capital efficiency, weave a dedicated slide in at position 3.

# Voice rules

Pick once from the intake and hold across every headline and body line.
- **Confident** — direct, data-led, declarative. Short sentences. Lead with the strongest proof point on every slide where it fits.
- **Warm** — human, story-led, plain-spoken. Address the reader as "you" where natural. Stories before stats.
- **Technical** — precise, architecture-aware, low fluff. Concrete components and interfaces. Skip the hype words.
- **Visionary** — ambitious framing, future-tense, narrative arc. Each slide builds toward the closing ask.

# Archetype reweighting

- **Pre-seed angel** — drop Why now; expand Team to two slides if the team follow-up gives material.
- **Seed VC** — add a product screenshot beat to Solution; lead Traction with whatever the intake's signal follow-up named (paid pilots / LOIs / waitlist / prototype usage).
- **Series A VC** — expand Traction; add a slide on the GTM motion the user picked.
- **Strategic / Growth** — expand Why now and Market; add a Strategic fit slide framed by the follow-up answer.

# Top-concern emphasis

Whichever concern the user picked must show up on every slide where it's in play, anchored by the proof points from the free-text intake. Never repeat the same proof point verbatim across slides — restate it from a different angle each time.

# Constraints

- Do not invent customer names, dollar amounts, growth rates, or quotes. If the intake doesn't have one, leave a \`[needs: ...]\` placeholder.
- Do not include a market size unless the intake gave you one. If only an industry was named, frame it qualitatively.
- The Ask slide must restate the amount and use of funds from the intake exactly as given.
- Output only the deck — no preamble, no closing remarks, no "here's your deck."`;

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

// content-harness:generate — see .claude/skills/content-harness/SKILL.md.
// `intake` is the structured object the skill assembles after step 3b:
//   { freeText, decisions: { voice, archetype, topConcern, depth },
//     followUps: { voice?, archetype?, topConcern?, depth? } }
// We pass it as a single JSON-encoded user message; the model's job is
// the deck, not negotiating the shape.
ipcMain.handle("content-harness:generate", async (_event, intake) => {
  if (!intake || typeof intake !== "object") {
    throw new Error("intake is required");
  }
  const { decisions } = intake;
  if (!decisions || !decisions.voice || !decisions.archetype ||
      !decisions.topConcern || !decisions.depth) {
    throw new Error(
      "intake.decisions must include voice, archetype, topConcern, and depth"
    );
  }
  const client = getAnthropic();
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: CONTENT_HARNESS_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content:
          "Generate the pitch deck from this intake:\n\n" +
          JSON.stringify(intake, null, 2),
      },
    ],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  return {
    markdown: textBlock ? textBlock.text : "",
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
