/* tinker — user-data sync layer
 *
 * Bridges the client-owned blobs (essays, drafts, earths, tree,
 * taxonomy) to /api/user-data/<kind>. On boot: when an auth token
 * is available, fetch each blob and overwrite the corresponding
 * localStorage key so the consumer modules (earths.js, tree.js,
 * heatmap.js, renderer.js) see the server state on their next
 * read. On every save: push the new blob back, debounced per-kind
 * so a burst of keystrokes coalesces into one write.
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
 *   - tree     → "tinker.tree.v1"     (object — the clustered Earth →
 *                Seed → Growth vector tree from /api/cluster)
 *   - taxonomy → "tinker.taxonomy.v1" (object — legacy category
 *                placements, still backing the category-feed surface)
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
  const KIND_TREE = "tree";
  const KIND_TAXONOMY = "taxonomy";

  // Legacy server-side kind name. Read from on first hydrate when the
  // new "earths" slot is empty; written to nothing after that. Old
  // installs sync'd their place list under the "seeds" name; this
  // fallback keeps them whole through the rename.
  const KIND_EARTHS_LEGACY = "seeds";

  const LS_ESSAYS = "tinker.essays.v1";
  const LS_DRAFTS = "tinker.drafts.v1";
  const LS_EARTHS = "tinker.earths.v1";
  const LS_EARTHS_HIDDEN = "tinker.earths.hidden.v1";
  const LS_TREE = "tinker.tree.v1";
  const LS_TAXONOMY = "tinker.taxonomy.v1";

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

  // Most consumers ship arrays/objects through JSON.parse — a missing or
  // malformed value is silently treated as the empty default. Sync
  // preserves that contract: server `null` (the column default) means
  // "no row yet", and we leave localStorage untouched on that branch.
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
  function applyTreeFromServer(data) {
    if (!data || typeof data !== "object") return false;
    setLs(LS_TREE, JSON.stringify(data));
    return true;
  }
  function applyTaxonomyFromServer(data) {
    if (!data || typeof data !== "object") return false;
    setLs(LS_TAXONOMY, JSON.stringify(data));
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
      // Best-effort. A failure isn't surfaced — the next save will
      // re-attempt the latest snapshot.
      pushKind(kind, getBlob()).catch(() => { /* ignore */ });
    }, PUSH_DEBOUNCE_MS));
  }

  // Public push helpers, used by consumer modules right after they
  // commit a change to localStorage. Each one re-reads the current
  // localStorage state at flush time so multiple writes within the
  // debounce window collapse to "last value wins".
  const api = {
    pushEssays() { schedulePush(KIND_ESSAYS, () => getLsJson(LS_ESSAYS, [])); },
    pushDrafts() { schedulePush(KIND_DRAFTS, () => getLsJson(LS_DRAFTS, [])); },
    pushEarths() { schedulePush(KIND_EARTHS, () => buildEarthsBlob()); },
    pushTree()   { schedulePush(KIND_TREE,   () => getLsJson(LS_TREE, null)); },
    pushTaxonomy() {
      schedulePush(KIND_TAXONOMY, () => getLsJson(LS_TAXONOMY, null));
    },
    // Force a flush of every pending push immediately — used on auth
    // change and pagehide so the server doesn't drop the tail of a
    // typing burst.
    flush() {
      const kinds = Array.from(pendingTimers.keys());
      for (const kind of kinds) {
        clearTimeout(pendingTimers.get(kind));
        pendingTimers.delete(kind);
      }
      // Synchronous best-effort: fire and forget. Browsers may abort
      // these on pagehide, which is fine — the next session re-hydrates.
      if (kinds.includes(KIND_ESSAYS))   pushKind(KIND_ESSAYS,   getLsJson(LS_ESSAYS, []));
      if (kinds.includes(KIND_DRAFTS))   pushKind(KIND_DRAFTS,   getLsJson(LS_DRAFTS, []));
      if (kinds.includes(KIND_EARTHS))   pushKind(KIND_EARTHS,   buildEarthsBlob());
      if (kinds.includes(KIND_TREE))     pushKind(KIND_TREE,     getLsJson(LS_TREE, null));
      if (kinds.includes(KIND_TAXONOMY)) pushKind(KIND_TAXONOMY, getLsJson(LS_TAXONOMY, null));
    },
  };

  async function hydrate() {
    if (!token()) return;
    const [essays, drafts, earths, tree, taxonomy] = await Promise.all([
      fetchKind(KIND_ESSAYS),
      fetchKind(KIND_DRAFTS),
      fetchKind(KIND_EARTHS),
      fetchKind(KIND_TREE),
      fetchKind(KIND_TAXONOMY),
    ]);
    let changed = false;
    if (applyEssaysFromServer(essays)) changed = true;
    if (applyDraftsFromServer(drafts)) changed = true;
    if (applyEarthsFromServer(earths)) changed = true;
    if (applyTreeFromServer(tree)) changed = true;
    if (applyTaxonomyFromServer(taxonomy)) changed = true;

    // Legacy-kind fallback for the Earth list: pre-rename installs
    // stored their place list under the "seeds" kind. If the new
    // earths slot was empty, try the old slot before giving up.
    if (!earths) {
      const legacy = await fetchKind(KIND_EARTHS_LEGACY);
      if (applyEarthsFromServer(legacy)) {
        changed = true;
        // Forward-migrate: push the same blob to the new kind so the
        // next hydrate finds it directly.
        pushKind(KIND_EARTHS, buildEarthsBlob()).catch(() => { /* ignore */ });
      }
    }

    if (changed) {
      try { window.dispatchEvent(new CustomEvent("tinker:hydrated")); }
      catch { /* ignore */ }
    }
  }

  api.hydrate = hydrate;

  window.tinkerSync = api;

  // Hydrate as soon as a token is present. On the plain web build
  // auth.js shows a gate when there's no token; the auth-changed
  // event fires after a successful PIN verify. Hydrating then catches
  // first-time sign-in too. On Electron / Capacitor there's no Stytch
  // token and hydrate() returns early.
  //
  // Wait for DOMContentLoaded so consumer modules (earths.js,
  // renderer.js) have registered their `tinker:hydrated` listeners
  // before the first fetch could finish.
  function kick() { if (token()) hydrate(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kick, { once: true });
  } else {
    kick();
  }
  window.addEventListener("tinker:auth-changed", () => { hydrate(); });

  // Best-effort tail flush on pagehide / visibilitychange — captures
  // the last keystroke before a tab close.
  window.addEventListener("pagehide", () => api.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") api.flush();
  });
})();
