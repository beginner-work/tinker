/* tinker — user-data sync layer
 *
 * Bridges the client-owned blobs (essays, drafts, seeds, taxonomy,
 * tree) to /api/user-data/<kind>. On boot: when an auth token is
 * available, fetch each blob and overwrite the corresponding
 * localStorage key so the consumer modules (seeds.js, heatmap.js,
 * sidebar-tree.js, renderer.js) see the server state on their next
 * read. On every save: push the new blob back, debounced per-kind so a
 * burst of keystrokes coalesces into one write.
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
 *   - seeds    → "tinker.seeds.v1" + "tinker.seeds.hidden.v1"
 *                stored on the server as one { explicit, hidden } blob
 *   - taxonomy → "tinker.taxonomy.v1" (object)
 *   - tree     → "tinker.tree.v1"     (object: { [deckHeading]: [...] })
 *   - pitches  → "tinker.pitches.v1"  (object: { pitches, activeId, ... })
 *                authoritatively produced by the backend organize job
 *                (/api/pitches/organize). PUT carries user-controlled
 *                fields (personalTitle, activeId, expanded) between
 *                job runs; a hydrate that races a not-yet-pushed
 *                rename gets a local-preferred merge to keep the label.
 *   - post-on-social → "tinker.postOnSocial.v1"
 *                      (object: { "<essayId>::<platform>": { score, reason,
 *                        reader_question, scorer_model, ts }, ... })
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
  const KIND_SEEDS = "seeds";
  const KIND_TAXONOMY = "taxonomy";
  const KIND_TREE = "tree";
  const KIND_PITCHES = "pitches";
  const KIND_POST_ON_SOCIAL = "post-on-social";

  const LS_ESSAYS = "tinker.essays.v1";
  const LS_DRAFTS = "tinker.drafts.v1";
  const LS_SEEDS = "tinker.seeds.v1";
  const LS_SEEDS_HIDDEN = "tinker.seeds.hidden.v1";
  const LS_TAXONOMY = "tinker.taxonomy.v1";
  const LS_TREE = "tinker.tree.v1";
  const LS_PITCHES = "tinker.pitches.v1";
  const LS_POST_ON_SOCIAL = "tinker.postOnSocial.v1";

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
    // Boot race: the user can tap a welcome tile and create a draft
    // before the initial hydrate fetch resolves. The push that would
    // tell the server about the new draft is debounced 1500ms, so the
    // server's response still reflects the pre-tap state. A naive
    // overwrite drops the new draft out of localStorage, and the
    // tinker:hydrated listener in renderer.js bounces the writing view
    // back to the feed — a visible flicker on the first tap. Merging
    // by id preserves the local-only draft while letting the server be
    // authoritative for drafts it already knows about.
    const local = getLsJson(LS_DRAFTS, []);
    setLs(LS_DRAFTS, JSON.stringify(mergeById(local, data)));
    return true;
  }
  function mergeById(local, server) {
    const byId = new Map();
    for (const d of server) {
      if (d && d.id) byId.set(d.id, d);
    }
    for (const d of local) {
      if (!d || !d.id) continue;
      const sv = byId.get(d.id);
      if (!sv) { byId.set(d.id, d); continue; }
      const lu = Number(d.updatedAt) || Number(d.createdAt) || 0;
      const su = Number(sv.updatedAt) || Number(sv.createdAt) || 0;
      if (lu > su) byId.set(d.id, d);
    }
    return Array.from(byId.values()).sort((a, b) => {
      const at = Number(a.createdAt) || 0;
      const bt = Number(b.createdAt) || 0;
      return bt - at;
    });
  }
  function applySeedsFromServer(data) {
    if (!data || typeof data !== "object") return false;
    const explicit = Array.isArray(data.explicit) ? data.explicit : [];
    const hidden = Array.isArray(data.hidden) ? data.hidden : [];
    setLs(LS_SEEDS, JSON.stringify(explicit));
    setLs(LS_SEEDS_HIDDEN, JSON.stringify(hidden));
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
  // The founder's personalTitle (their label for a pitch) is written
  // locally and pushed on a 1500ms debounce. A boot or auth-changed
  // hydrate that races that debounce would otherwise overwrite the
  // label with a server copy that hasn't seen it yet. Per-pitch fold:
  // when the server has no personalTitle for an id but localStorage
  // does, keep the local value — the still-pending push will reconcile.
  function applyPitchesFromServer(data) {
    if (!data || typeof data !== "object") return false;
    if (!Array.isArray(data.pitches)) return false;
    const local = getLsJson(LS_PITCHES, null);
    const localPersonalById = new Map();
    if (local && Array.isArray(local.pitches)) {
      for (const p of local.pitches) {
        if (p && typeof p.id === "string" && p.personalTitle) {
          localPersonalById.set(p.id, p.personalTitle);
        }
      }
    }
    const merged = { ...data };
    merged.pitches = data.pitches.map((p) => {
      if (p && typeof p.id === "string"
          && (p.personalTitle == null || p.personalTitle === "")
          && localPersonalById.has(p.id)) {
        return { ...p, personalTitle: localPersonalById.get(p.id) };
      }
      return p;
    });
    setLs(LS_PITCHES, JSON.stringify(merged));
    return true;
  }
  function applyPostOnSocialFromServer(data) {
    if (!data || typeof data !== "object") return false;
    setLs(LS_POST_ON_SOCIAL, JSON.stringify(data));
    return true;
  }

  function buildSeedsBlob() {
    return {
      explicit: getLsJson(LS_SEEDS, []),
      hidden: getLsJson(LS_SEEDS_HIDDEN, []),
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
    pushSeeds()  { schedulePush(KIND_SEEDS,  () => buildSeedsBlob()); },
    pushTaxonomy() {
      schedulePush(KIND_TAXONOMY, () => getLsJson(LS_TAXONOMY, null));
    },
    pushTree() {
      schedulePush(KIND_TREE, () => getLsJson(LS_TREE, null));
    },
    pushPitches() {
      schedulePush(KIND_PITCHES, () => getLsJson(LS_PITCHES, null));
    },
    pushPostOnSocial() {
      schedulePush(KIND_POST_ON_SOCIAL, () => getLsJson(LS_POST_ON_SOCIAL, null));
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
      if (kinds.includes(KIND_SEEDS))    pushKind(KIND_SEEDS,    buildSeedsBlob());
      if (kinds.includes(KIND_TAXONOMY)) pushKind(KIND_TAXONOMY, getLsJson(LS_TAXONOMY, null));
      if (kinds.includes(KIND_TREE))     pushKind(KIND_TREE,     getLsJson(LS_TREE, null));
      if (kinds.includes(KIND_PITCHES))  pushKind(KIND_PITCHES,  getLsJson(LS_PITCHES, null));
      if (kinds.includes(KIND_POST_ON_SOCIAL)) pushKind(KIND_POST_ON_SOCIAL, getLsJson(LS_POST_ON_SOCIAL, null));
    },
  };

  async function hydrate() {
    if (!token()) return;
    const [essays, drafts, seeds, taxonomy, tree, pitches, postOnSocial] = await Promise.all([
      fetchKind(KIND_ESSAYS),
      fetchKind(KIND_DRAFTS),
      fetchKind(KIND_SEEDS),
      fetchKind(KIND_TAXONOMY),
      fetchKind(KIND_TREE),
      fetchKind(KIND_PITCHES),
      fetchKind(KIND_POST_ON_SOCIAL),
    ]);
    let changed = false;
    if (applyEssaysFromServer(essays)) changed = true;
    if (applyDraftsFromServer(drafts)) changed = true;
    if (applySeedsFromServer(seeds)) changed = true;
    if (applyTaxonomyFromServer(taxonomy)) changed = true;
    if (applyTreeFromServer(tree)) changed = true;
    if (applyPitchesFromServer(pitches)) changed = true;
    if (applyPostOnSocialFromServer(postOnSocial)) changed = true;
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
  // Wait for DOMContentLoaded so consumer modules (seeds.js,
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
