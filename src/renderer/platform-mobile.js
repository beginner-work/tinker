/* Platform shim — runs on Capacitor (iOS/Android) and on plain web,
 * but stays out of the way when Electron's preload has already
 * installed window.tinker. Provides the same surface the renderer
 * expects, backed by a direct browser-side call to Anthropic and
 * (where available) the @capacitor/browser plugin for opening
 * external sites in the system browser overlay. */

(function () {
  if (window.tinker && typeof window.tinker.searchQuery === "function") {
    return; // Electron preload already wired things up.
  }

  const isCapacitor = !!window.Capacitor;
  document.documentElement.classList.add(isCapacitor ? "on-capacitor" : "on-web");

  const STORE = window.localStorage;
  const get = (k) => STORE.getItem(k) || "";

  // Same prompt the desktop main process uses. Kept in sync by hand —
  // the contract is the prompt, not the source location. If you change
  // it in src/main/main.js, change it here too.
  const SEARCH_SYSTEM_PROMPT = `You are the search engine for the tinker web browser — a quiet alternative to ad-driven search.

When you receive a query, write a calm, conversational answer in three to five short paragraphs that helps the reader understand the topic and where to go next. Embed Markdown links to specific, well-known websites — Wikipedia, official organisation sites, established publications, .gov pages — where the reader can read more or take action. Format links exactly as [label](https://example.com).

Voice: warm, plainspoken, calm. Address the reader as "you" where natural. No headings, no bulleted lists — just flowing prose, with short paragraphs separated by blank lines.

Only include links to sources you'd actually recommend and that you are confident exist. Do not invent URLs. If you are uncertain about a specific URL, omit the link rather than guess. It is better to write a confident paragraph with no link than to fabricate one.`;

  // Tinker organize prompt — kept in sync with src/main/main.js by hand.
  // Same hard line: no paraphrasing, no synthesis, verbatim quotes only.
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

  async function searchQuery(query) {
    const apiKey = get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      const e = new Error(
        "ANTHROPIC_API_KEY is not set. Open Settings to add it (or run localStorage.setItem from the inspector)."
      );
      e.code = "MISSING_API_KEY";
      throw e;
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 240)}`);
    }
    const data = await res.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    return { text: textBlock ? textBlock.text : "", usage: data.usage };
  }

  async function transcribeAudio(payload) {
    const apiKey = get("OPENAI_API_KEY");
    if (!apiKey) {
      const e = new Error(
        "OPENAI_API_KEY is not set. Open Settings to add it (or run localStorage.setItem from the inspector)."
      );
      e.code = "MISSING_OPENAI_KEY";
      throw e;
    }
    if (!payload || !payload.audioBase64) {
      throw new Error("audioBase64 is required");
    }
    const mimeType = payload.mimeType || "audio/webm";
    const ext = mimeType.includes("mp4") ? "mp4"
      : mimeType.includes("mpeg") ? "mp3"
      : mimeType.includes("wav") ? "wav"
      : "webm";
    const bytes = Uint8Array.from(atob(payload.audioBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mimeType });
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
  }

  async function organizeTranscript(transcript) {
    const apiKey = get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      const e = new Error(
        "ANTHROPIC_API_KEY is not set. Open Settings to add it (or run localStorage.setItem from the inspector)."
      );
      e.code = "MISSING_API_KEY";
      throw e;
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 240)}`);
    }
    const data = await res.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    const raw = textBlock ? textBlock.text.trim() : "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
      parsed = JSON.parse(stripped);
    }
    return { payload: parsed, usage: data.usage };
  }

  // Local trajectory storage — payloads keyed by slug in localStorage.
  // Same shape as the Electron filesystem path; v1.1 publishing will
  // add a remote sink alongside.
  const TRAJ_KEY = "tinker:trajectory:";

  async function saveTrajectory(slug, payload) {
    if (!/^[a-z0-9-]{1,32}$/.test(slug)) throw new Error("Invalid slug");
    STORE.setItem(TRAJ_KEY + slug, JSON.stringify(payload));
    return { slug };
  }

  async function loadTrajectory(slug) {
    if (!/^[a-z0-9-]{1,32}$/.test(slug)) return null;
    const raw = STORE.getItem(TRAJ_KEY + slug);
    return raw ? JSON.parse(raw) : null;
  }

  async function openExternal(url) {
    if (isCapacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
      try {
        await window.Capacitor.Plugins.Browser.open({ url });
        return;
      } catch {
        // fall through to window.open
      }
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  window.tinker = {
    version: () => Promise.resolve("0.1.0-mobile"),
    platform: () => Promise.resolve(isCapacitor ? "capacitor" : "web"),
    setIcon: () => Promise.resolve(true),
    searchQuery,
    transcribeAudio,
    organizeTranscript,
    saveTrajectory,
    loadTrajectory,
    openExternal,
    supportsWebview: false,
    setSetting: (k, v) => {
      STORE.setItem(k, v);
      return Promise.resolve(true);
    },
    getSetting: (k) => Promise.resolve(get(k)),
  };
})();
