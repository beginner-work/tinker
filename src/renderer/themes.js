/* tinker — themes module
 *
 * The sidebar's theme labels come from /api/themes, a server-side
 * clustering step over the founder's own seeds + drafts + essays. Each
 * label is a verbatim substring of one of the founder's writings; the
 * server validates that before returning. Client side:
 *
 *  - list(): current themes from localStorage so the sidebar renders
 *    instantly on cold start.
 *  - refresh(): flushes sync.js's queue, calls /api/themes, caches the
 *    result, notifies subscribers, and pushes through sync.js so the
 *    same themes appear on every device.
 *  - isRefreshing(): true while a /api/themes call is in flight. The
 *    sidebar uses this to drive the loading shimmer.
 *  - subscribe(fn): notified on every cache change (boot, refresh,
 *    hydration).
 *
 * Triggered by writing.js's session-close + publish hooks (wired in
 * renderer.js).
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.themes.v1";
  const TOKEN_KEY = "tinker_jwt";

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function save(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
    catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushThemes === "function") {
      window.tinkerSync.pushThemes();
    }
  }

  let themes = load();
  let refreshing = false;

  const subscribers = new Set();
  function notify() {
    for (const fn of subscribers) {
      try { fn(); } catch { /* ignore */ }
    }
  }

  function list() { return themes.slice(); }
  function isRefreshing() { return refreshing; }
  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  async function refresh() {
    if (!token() || refreshing) return;

    // Flush sync first so /api/themes sees the freshest writings on
    // the server side. The function reads straight out of the
    // TinkerUserData table.
    if (window.tinkerSync && typeof window.tinkerSync.flush === "function") {
      window.tinkerSync.flush();
    }

    refreshing = true;
    notify();
    try {
      const res = await fetch("/api/themes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: "{}",
      });
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      const next = (json && Array.isArray(json.themes)) ? json.themes : null;
      if (!next) return;
      themes = next;
      save(themes);
    } catch {
      // Best-effort. The cached themes stay on screen and the next
      // session-close re-tries.
    } finally {
      refreshing = false;
      notify();
    }
  }

  window.tinkerThemes = { list, isRefreshing, subscribe, refresh };

  // Server hydration overwrites the themes cache on boot. Re-read and
  // notify the sidebar so it re-renders against the synced set.
  window.addEventListener("tinker:hydrated", () => {
    themes = load();
    notify();
  });
})();
