/* Platform shim — runs on plain web (and inside the Expo WebView shell),
 * but stays out of the way when Electron's preload has already
 * installed window.tinker. Exposes the same window.tinker.* surface
 * the renderer relies on.
 *
 * In this deployment the browser does NOT hold an Anthropic key —
 * every Claude call is proxied through /api/claude/converse on the
 * Vercel serverless layer, gated by the phone/PIN JWT. The shim
 * forwards the founder's `tinker_jwt` Bearer token on each request. */

(function () {
  if (window.tinker && typeof window.tinker.callClaude === "function") {
    return; // Electron preload already wired things up.
  }

  document.documentElement.classList.add("on-web");

  const STORE = window.localStorage;
  const get = (k) => STORE.getItem(k) || "";

  /** Proxied Claude call — server-side keys, JWT-gated.
   *
   *   { system, messages, model, maxTokens } → { text, usage }
   *
   * Always uses the prompt-cached system block on the server. The
   * browser bundle never sees an Anthropic key. */
  async function callClaude({ system, messages, model, maxTokens } = {}) {
    const token = get("tinker_jwt");
    if (!token) {
      const e = new Error("Sign in to write.");
      e.code = "MISSING_TOKEN";
      throw e;
    }
    const body = { messages };
    if (system) body.system = system;
    if (model) body.model = model;
    if (maxTokens) body.max_tokens = maxTokens;

    const res = await fetch("/api/claude/converse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      try { STORE.removeItem("tinker_jwt"); } catch { /* ignore */ }
      const e = new Error("Session expired — sign in again.");
      e.code = "SESSION_EXPIRED";
      // Surface the auth gate in place instead of reloading the page.
      // A reload mid-session reads as "I submitted something and got
      // bounced to login", which is exactly the experience we want to
      // avoid.
      if (window.tinkerAuth && typeof window.tinkerAuth.showGate === "function") {
        window.tinkerAuth.showGate();
      }
      throw e;
    }
    let data = null;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      const message = (data && (data.error || data.detail)) || `Claude call failed (${res.status})`;
      throw new Error(message);
    }
    return { text: data.text || "", usage: data.usage, model: data.model };
  }

  async function openExternal(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  window.tinker = {
    version: () => Promise.resolve("0.1.0-tinker-v1"),
    platform: () => Promise.resolve("web"),
    setIcon: () => Promise.resolve(true),
    callClaude,
    openExternal,
    supportsWebview: false,
    setSetting: (k, v) => {
      STORE.setItem(k, v);
      return Promise.resolve(true);
    },
    getSetting: (k) => Promise.resolve(get(k)),
  };
})();
