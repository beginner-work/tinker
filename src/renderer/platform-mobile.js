/* Platform shim — runs on plain web (and inside the Expo WebView shell).
 * When Electron's preload already installed window.tinker (desktop app),
 * keep those bridges (notes folder, dock icon, openExternal) and only
 * fill in callClaude + settings helpers the shell does not provide.
 *
 * In this deployment the browser does NOT hold an Anthropic key —
 * every Claude call is proxied through /api/claude/converse on the
 * Vercel serverless layer, gated by the phone/PIN JWT. The shim
 * forwards the founder's `tinker_jwt` Bearer token on each request. */

(function () {
  const existing =
    window.tinker && typeof window.tinker === "object" ? window.tinker : null;

  // Fully wired Electron (or a prior shim) already has Claude — leave it.
  if (existing && typeof existing.callClaude === "function") {
    return;
  }

  const isDesktop =
    !!(existing && (existing.supportsWebview === true || existing.isDesktopApp === true));

  if (!isDesktop) {
    document.documentElement.classList.add("on-web");
  }

  const STORE = window.localStorage;
  const get = (k) => STORE.getItem(k) || "";

  /** Proxied Claude call — server-side keys, JWT-gated.
   *
   *   { system, messages, model, maxTokens } → { text, usage }
   *
   * Always uses the prompt-cached system block on the server. The
   * browser bundle never sees an Anthropic key. */
  // Owner-thread stitch and Keep crafting must never spin forever on a
  // hung fetch (common on iOS PWA). Abort and surface a real error.
  const CLAUDE_TIMEOUT_MS = 60000;

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

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(function () { try { controller.abort(); } catch (e) { /* ignore */ } }, CLAUDE_TIMEOUT_MS)
      : null;
    let res;
    try {
      res = await fetch("/api/claude/converse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      const aborted = err && (err.name === "AbortError" || err.code === "ABORT_ERR");
      if (aborted) {
        const e = new Error("That took too long. Try again.");
        e.code = "TIMEOUT";
        throw e;
      }
      throw err;
    }
    if (timer) clearTimeout(timer);

    if (res.status === 401) {
      try { STORE.removeItem("tinker_jwt"); } catch { /* ignore */ }
      const e = new Error("Session expired. Sign in again.");
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
    if (existing && typeof existing.openExternal === "function") {
      return existing.openExternal(url);
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // Merge: keep Electron notes/dock bridges; add web Claude + settings.
  window.tinker = Object.assign({}, existing || {}, {
    version:
      existing && typeof existing.version === "function"
        ? existing.version
        : () => Promise.resolve("0.1.0-tinker-v1"),
    platform:
      existing && typeof existing.platform === "function"
        ? existing.platform
        : () => Promise.resolve("web"),
    setIcon:
      existing && typeof existing.setIcon === "function"
        ? existing.setIcon
        : () => Promise.resolve(true),
    callClaude,
    openExternal,
    supportsWebview: isDesktop ? true : false,
    isDesktopApp: isDesktop ? true : !!(existing && existing.isDesktopApp),
    setSetting:
      existing && typeof existing.setSetting === "function"
        ? existing.setSetting
        : (k, v) => {
            STORE.setItem(k, v);
            return Promise.resolve(true);
          },
    getSetting:
      existing && typeof existing.getSetting === "function"
        ? existing.getSetting
        : (k) => Promise.resolve(get(k)),
  });
})();
