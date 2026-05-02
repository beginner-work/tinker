/* Platform shim — runs on Capacitor (iOS/Android) and on plain web,
 * but stays out of the way when Electron's preload has already
 * installed window.tinker. Provides the same surface the renderer
 * expects, backed by the Vercel search proxy and (where available)
 * the @capacitor/browser plugin for opening external sites in the
 * system browser overlay. */

(function () {
  if (window.tinker && typeof window.tinker.searchQuery === "function") {
    return; // Electron preload already wired things up.
  }

  const isCapacitor = !!window.Capacitor;
  document.documentElement.classList.add(isCapacitor ? "on-capacitor" : "on-web");

  const STORE = window.localStorage;
  const get = (k) => STORE.getItem(k) || "";

  // The Anthropic API key lives only on the Vercel server (read from
  // ANTHROPIC_API_KEY_WEB there). The client POSTs { query } to
  // /api/search and receives { text, usage } back. Override at runtime
  // via localStorage.setItem("TINKER_SEARCH_ENDPOINT", …) when developing
  // against `vercel dev`.
  const DEFAULT_SEARCH_ENDPOINT = "https://beginner.work/api/search";

  async function searchQuery(query) {
    const endpoint = get("TINKER_SEARCH_ENDPOINT") || DEFAULT_SEARCH_ENDPOINT;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.trim() }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Search proxy ${res.status}: ${errBody.slice(0, 240)}`);
    }
    const data = await res.json();
    return { text: data.text || "", usage: data.usage };
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
