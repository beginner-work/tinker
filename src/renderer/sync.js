/* tinker — user-data sync layer
 *
 * Bridges client-owned blobs to /api/user-data/<kind>. On boot: when
 * an auth token is available, fetch each blob and overwrite the
 * corresponding localStorage key so consumer modules (earths.js,
 * heatmap.js, tree.js, renderer.js) see the server state on their
 * next read. On every save: push the new blob back, debounced
 * per-kind so a burst of keystrokes coalesces into one write.
 *
 * The localStorage keys stay the source of truth for the renderer.
 * The server is the source of truth across devices, but locally
 * everything continues to round-trip through localStorage — that keeps
 * offline behaviour and synchronous reads from the consumer modules
 * unchanged.
 *
 * Storage keys covered:
 *   - essays   → "tinker.essays.v1"   (array)
 *   - drafts   → "tinker.drafts.v1"   (array)
 *   - earths   → "tinker.earths.v1" + "tinker.earths.hidden.v1"
 *                stored on the server as one { explicit, hidden } blob
 *   - taxonomy → "tinker.taxonomy.v1" (object)
 *   - tree     → "tinker.tree.v1"     (clustering output, see tree.js)
 *
 * Events dispatched on window:
 *   - "tinker:hydrated"  after a successful boot fetch overwrote one or
 *                        more localStorage keys. Consumers listen and
 *                        re-render from storage.
 */

(function () {
  "use strict";

  const TOKEN_KEY = "tinker_jwt";
  const STORAGE = window.localStorage;

  const KIND_ESSAYS = "essays";
  const KIND_DRAFTS = "drafts";
  const KIND_EARTHS = "earths";
  const KIND_TAXONOMY = "taxonomy";
  const KIND_TREE = "tree";

  const LS_ESSAYS = "tinker.essays.v1";
  const LS_DRAFTS = "tinker.drafts.v1";
  const LS_EARTHS = "tinker.earths.v1";
  const LS_EARTHS_HIDDEN = "tinker.earths.hidden.v1";
  const LS_TAXONOMY = "tinker.taxonomy.v1";
  const LS_TREE = "tinker.tree.v1";

  // Debounce window per kind. Keystrokes in a textarea hit
  // saveDrafts() at ~3hz; coalescing into one PUT every 1.5s is
  // plenty for cross-device continuity without hammering the API.
  const PUSH_DEBOUNCE_MS = 1500;

  function token() {
    try { return STORAGE.getItem(TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  function setLs(key, value) {
    try { STORAGE.setItem(key, value); } catch { /* ignore */ }
  }
  function getLsJson(key, fallback) {
    try {
      const raw = STORAGE.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  }

  function applyEssaysFromServer(data) {
    if (!Array.isArray(data)) return false;
    setLs(LS_ESSAYS, JSON.stringify(data));
    return true;
  }
  function applyDraftsFromServer(data) {
    if (!Array.isArray(data)) return false;
    setLs(LS_DRAFTS, JSON.stringify(data));
    return true;
  }
  function applyEarthsFromServer(data) {
    if (!data || typeof data !== "object") return false;
    const explicit = Array.isArray(data.explicit) ? data.explicit : [];
    const hidden = Array.isArray(data.hidden) ? data.hidden : [];
    setLs(LS_EARTHS, JSON.stringify(explicit));
    setLs(LS_EARTHS_HIDDEN, JSON.stringify(hidden));
    return true;
  }
  function applyTaxonomyFromServer(data) {
    if (!data || typeof data !== "object") return false;
    setLs(LS_TAXONOMY, JSON.stringify(data));
    return true;
  }
  function applyTreeFromServer(data) {
    if (!data || typeof data !== "object") return false;
    setLs(LS_TREE, JSON.stringify(data));
    return true;
  }

  function buildEarthsBlob() {
    return {
      explicit: getLsJson(LS_EARTHS, []),
      hidden: getLsJson(LS_EARTHS_HIDDEN, []),
    };
  }

  async function fetchKind(kind) {
    const t = token();
    if (!t) return null;
    let res;
    try {
      res = await fetch(`/api/user-data/${kind}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${t}` },
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    try {
      const json = await res.json();
      return json && Object.prototype.hasOwnProperty.call(json, "data") ? json.data : null;
    } catch {
      return null;
    }
  }

  async function pushKind(kind, data) {
    const t = token();
    if (!t) return false;
    let res;
    try {
      res = await fetch(`/api/user-data/${kind}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({ data }),
      });
    } catch {
      return false;
    }
    return res.ok;
  }

  const pendingTimers = new Map();
  function schedulePush(kind, getBlob) {
    if (pendingTimers.has(kind)) clearTimeout(pendingTimers.get(kind));
    pendingTimers.set(kind, setTimeout(() => {
      pendingTimers.delete(kind);
      pushKind(kind, getBlob()).catch(() => { /* ignore */ });
    }, PUSH_DEBOUNCE_MS));
  }

  const api = {
    pushEssays() { schedulePush(KIND_ESSAYS, () => getLsJson(LS_ESSAYS, [])); },
    pushDrafts() { schedulePush(KIND_DRAFTS, () => getLsJson(LS_DRAFTS, [])); },
    pushEarths() { schedulePush(KIND_EARTHS, () => buildEarthsBlob()); },
    pushTaxonomy() {
      schedulePush(KIND_TAXONOMY, () => getLsJson(LS_TAXONOMY, null));
    },
    pushTree() { schedulePush(KIND_TREE, () => getLsJson(LS_TREE, null)); },
    flush() {
      const kinds = Array.from(pendingTimers.keys());
      for (const kind of kinds) {
        clearTimeout(pendingTimers.get(kind));
        pendingTimers.delete(kind);
      }
      if (kinds.includes(KIND_ESSAYS))   pushKind(KIND_ESSAYS,   getLsJson(LS_ESSAYS, []));
      if (kinds.includes(KIND_DRAFTS))   pushKind(KIND_DRAFTS,   getLsJson(LS_DRAFTS, []));
      if (kinds.includes(KIND_EARTHS))   pushKind(KIND_EARTHS,   buildEarthsBlob());
      if (kinds.includes(KIND_TAXONOMY)) pushKind(KIND_TAXONOMY, getLsJson(LS_TAXONOMY, null));
      if (kinds.includes(KIND_TREE))     pushKind(KIND_TREE,     getLsJson(LS_TREE, null));
    },
  };

  async function hydrate() {
    if (!token()) return;
    const [essays, drafts, earths, taxonomy, tree] = await Promise.all([
      fetchKind(KIND_ESSAYS),
      fetchKind(KIND_DRAFTS),
      fetchKind(KIND_EARTHS),
      fetchKind(KIND_TAXONOMY),
      fetchKind(KIND_TREE),
    ]);
    let changed = false;
    if (applyEssaysFromServer(essays)) changed = true;
    if (applyDraftsFromServer(drafts)) changed = true;
    if (applyEarthsFromServer(earths)) changed = true;
    if (applyTaxonomyFromServer(taxonomy)) changed = true;
    if (applyTreeFromServer(tree)) changed = true;
    if (changed) {
      try { window.dispatchEvent(new CustomEvent("tinker:hydrated")); }
      catch { /* ignore */ }
    }
  }

  api.hydrate = hydrate;

  window.tinkerSync = api;

  function kick() { if (token()) hydrate(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kick, { once: true });
  } else {
    kick();
  }
  window.addEventListener("tinker:auth-changed", () => { hydrate(); });

  window.addEventListener("pagehide", () => api.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") api.flush();
  });
})();
