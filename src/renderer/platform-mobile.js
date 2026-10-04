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

  // Fully wired Electron (or a prior shim) already has Claude — leave it,
  // but still ensure the desktop document marker is set for CSS gates.
  if (existing && typeof existing.callClaude === "function") {
    if (existing.supportsWebview === true || existing.isDesktopApp === true) {
      try {
        document.documentElement.setAttribute("data-tinker-desktop", "1");
        document.documentElement.classList.add("tinker-desktop");
        document.documentElement.classList.remove("on-web");
      } catch (e) { /* ignore */ }
    }
    return;
  }

  const isDesktop =
    !!(existing && (existing.supportsWebview === true || existing.isDesktopApp === true))
    || (typeof document !== "undefined"
      && document.documentElement
      && document.documentElement.hasAttribute("data-tinker-desktop"));

  if (isDesktop) {
    // Belt-and-suspenders with preload: ensure traffic-light CSS gates
    // apply even if preload raced a remote navigation's first paint.
    // Never add mobile / on-web classes — the shell is desktop Chrome.
    try {
      document.documentElement.setAttribute("data-tinker-desktop", "1");
      document.documentElement.classList.add("tinker-desktop");
      document.documentElement.classList.remove("on-web");
    } catch (e) { /* ignore */ }
  } else {
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
    if (maxTokens) {
      // Send both spellings — converse historically read maxTokens while
      // this shim sent max_tokens, so the server defaulted every call.
      body.maxTokens = maxTokens;
      body.max_tokens = maxTokens;
    }

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

    if (res.status === 401 || res.status === 403) {
      try { STORE.removeItem("tinker_jwt"); } catch { /* ignore */ }
      const e = new Error("Session expired. Sign in again.");
      e.code = "SESSION_EXPIRED";
      e.status = res.status;
      // Surface the auth gate in place when the shell has one. /repo does
      // not load auth.js, so callers there show an inline Sign in control
      // that navigates to /?signin=1 instead.
      if (window.tinkerAuth && typeof window.tinkerAuth.showGate === "function") {
        window.tinkerAuth.showGate();
      }
      throw e;
    }
    let data = null;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      const message = (data && (data.error || data.detail)) || `Claude call failed (${res.status})`;
      const e = new Error(message);
      e.code = "UPSTREAM";
      e.status = res.status;
      throw e;
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
