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
    openExternal,
    supportsWebview: false,
    setSetting: (k, v) => {
      STORE.setItem(k, v);
      return Promise.resolve(true);
    },
    getSetting: (k) => Promise.resolve(get(k)),
  };
})();
