/* Platform shim — runs on Capacitor (iOS/Android) and on plain web,
 * but stays out of the way when Electron's preload has already
 * installed window.tinker. Exposes a uniform `window.tinker.*`
 * surface that the renderer relies on. The Anthropic call path is
 * direct browser→api.anthropic.com using a key stored in
 * localStorage under ANTHROPIC_API_KEY — same pattern Capacitor
 * already uses. */

(function () {
  if (window.tinker && typeof window.tinker.callClaude === "function") {
    return; // Electron preload already wired things up.
  }

  const isCapacitor = !!window.Capacitor;
  const isWeb = !isCapacitor;
  document.documentElement.classList.add(isCapacitor ? "on-capacitor" : "on-web");

  const STORE = window.localStorage;
  const get = (k) => STORE.getItem(k) || "";

  /** Direct browser → Anthropic Messages API call.
   *
   * Inputs:
   *   { system, messages, model, maxTokens }
   *
   * The system prompt is always wrapped in a cache_control block so
   * repeat turns within a draft skip the cold-start cost. */
  async function callClaude({
    system,
    messages,
    model = "claude-sonnet-4-6",
    maxTokens = 2048,
  } = {}) {
    const apiKey = get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      const e = new Error(
        "Set your Anthropic API key first. Open the browser inspector and run:\n" +
        "  localStorage.setItem('ANTHROPIC_API_KEY', 'sk-ant-...')"
      );
      e.code = "MISSING_API_KEY";
      throw e;
    }
    const body = {
      model,
      max_tokens: maxTokens,
      messages,
    };
    if (system) {
      body.system = [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ];
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 320)}`);
    }
    const data = await res.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    return { text: textBlock ? textBlock.text : "", usage: data.usage, raw: data };
  }

  async function openExternal(url) {
    if (isCapacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
      try {
        await window.Capacitor.Plugins.Browser.open({ url });
        return;
      } catch {
        // fall through
      }
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  window.tinker = {
    version: () => Promise.resolve("0.1.0-tinker-v1"),
    platform: () => Promise.resolve(isCapacitor ? "capacitor" : isWeb ? "web" : "unknown"),
    setIcon: () => Promise.resolve(true),
    callClaude,
    openExternal,
    supportsWebview: false,
    setSetting: (k, v) => {
      STORE.setItem(k, v);
      return Promise.resolve(true);
    },
    getSetting: (k) => Promise.resolve(get(k)),
    hasApiKey: () => !!get("ANTHROPIC_API_KEY"),
  };
})();
