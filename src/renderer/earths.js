/* tinker — earths module
 *
 * An Earth is a place the founder writes from (or wants to). It's a
 * single string ("Kitchen counter", "Whole Foods", "the back porch at
 * 7am"). The Earth tier is the top of the sidebar tree; the AI-derived
 * Seeds cluster inside each Earth, and Growth vectors inside each Seed.
 *
 * Sources merged in list():
 *  1. Explicitly added via the welcome grid (stored in localStorage).
 *  2. Past draft.earth values still in localStorage["tinker.drafts.v1"].
 *  3. Past transaction merchants from window.tinkerTransactions.
 *
 * Each Earth surfaces with usageCount + lastUsed so the renderer can
 * sort by recency.
 *
 * Naming history: this module was `seeds.js` until v0.102, when the
 * three-tier sidebar revamp reclaimed "seed" for the cluster meaning
 * and renamed the place tier to "Earth". The previous module did the
 * same kind of rename one step earlier (location → seed); see the two
 * migration blocks below.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.earths.v1";
  const STORAGE_HIDDEN = "tinker.earths.hidden.v1";
  const STORAGE_DRAFTS = "tinker.drafts.v1";
  const STORAGE_ESSAYS = "tinker.essays.v1";
  const STORAGE_TAXONOMY = "tinker.taxonomy.v1";

  // One-time migration from the previous "location" naming. Runs first
  // so a fresh browser that's never seen tinker before still gets here
  // before the seed→earth pass below; a browser that already ran this
  // back when seeds.js owned the slot has the flag set and skips it.
  (function migrateFromLocations() {
    const FLAG = "tinker.seeds.migration.v1";
    try {
      if (localStorage.getItem(FLAG)) return;

      const moveKey = (oldKey, newKey) => {
        const v = localStorage.getItem(oldKey);
        if (v === null) return;
        if (localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, v);
        }
        localStorage.removeItem(oldKey);
      };
      moveKey("tinker.locations.v1", "tinker.seeds.v1");
      moveKey("tinker.locations.hidden.v1", "tinker.seeds.hidden.v1");

      const renameField = (storageKey) => {
        try {
          const raw = localStorage.getItem(storageKey);
          if (!raw) return;
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr)) return;
          let changed = false;
          for (const item of arr) {
            if (item && typeof item === "object" && "location" in item) {
              if (!("seed" in item)) item.seed = item.location;
              delete item.location;
              changed = true;
            }
          }
          if (changed) localStorage.setItem(storageKey, JSON.stringify(arr));
        } catch { /* ignore */ }
      };
      renameField(STORAGE_DRAFTS);
      renameField(STORAGE_ESSAYS);

      try {
        const raw = localStorage.getItem(STORAGE_TAXONOMY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && parsed.locations && !parsed.seeds) {
            parsed.seeds = parsed.locations;
            delete parsed.locations;
            localStorage.setItem(STORAGE_TAXONOMY, JSON.stringify(parsed));
          }
        }
      } catch { /* ignore */ }

      localStorage.setItem(FLAG, "1");
    } catch { /* ignore */ }
  })();

  // One-time migration from "seed" (place) → "earth". The v0.102 sidebar
  // revamp reclaims `tinker.seeds.v1` for the new cluster meaning and
  // moves the place list to `tinker.earths.v1`. Mirrors the location →
  // seed pass above one-for-one. Frees the seeds.v1 slot completely so
  // the new cluster blob can land there without two meanings ever
  // coexisting.
  (function migrateFromSeeds() {
    const FLAG = "tinker.earths.migration.v1";
    try {
      if (localStorage.getItem(FLAG)) return;

      const moveKey = (oldKey, newKey) => {
        const v = localStorage.getItem(oldKey);
        if (v === null) return;
        if (localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, v);
        }
        localStorage.removeItem(oldKey);
      };
      moveKey("tinker.seeds.v1", STORAGE_KEY);
      moveKey("tinker.seeds.hidden.v1", STORAGE_HIDDEN);

      const renameField = (storageKey) => {
        try {
          const raw = localStorage.getItem(storageKey);
          if (!raw) return;
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr)) return;
          let changed = false;
          for (const item of arr) {
            if (item && typeof item === "object" && "seed" in item) {
              if (!("earth" in item)) item.earth = item.seed;
              delete item.seed;
              changed = true;
            }
          }
          if (changed) localStorage.setItem(storageKey, JSON.stringify(arr));
        } catch { /* ignore */ }
      };
      renameField(STORAGE_DRAFTS);
      renameField(STORAGE_ESSAYS);

      try {
        const raw = localStorage.getItem(STORAGE_TAXONOMY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && parsed.seeds && !parsed.earths) {
            parsed.earths = parsed.seeds;
            delete parsed.seeds;
            localStorage.setItem(STORAGE_TAXONOMY, JSON.stringify(parsed));
          }
        }
      } catch { /* ignore */ }

      localStorage.setItem(FLAG, "1");
    } catch { /* ignore */ }
  })();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function save(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushEarths === "function") {
      window.tinkerSync.pushEarths();
    }
  }
  function loadHidden() {
    try {
      const raw = localStorage.getItem(STORAGE_HIDDEN);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }
  function saveHidden(set) {
    try { localStorage.setItem(STORAGE_HIDDEN, JSON.stringify(Array.from(set))); } catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushEarths === "function") {
      window.tinkerSync.pushEarths();
    }
  }
  function nextId() { return "earth_" + Math.random().toString(36).slice(2, 10); }

  let explicit = load();
  let hidden = loadHidden();

  // One-time purge for browsers that received the four preview-earth
  // defaults ("Provecho", "Industrious", "Living room", "Bedroom") on
  // past visits. Gated on the old init flag so it only touches clients
  // that actually got seeded.
  (function purgeOldEarthDefaults() {
    try {
      const FLAG = "tinker.locations_initialized.v1";
      if (!localStorage.getItem(FLAG)) return;
      const seeded = new Set(["provecho", "industrious", "living room", "bedroom"]);
      const next = explicit.filter((e) => !seeded.has(String(e.name || "").trim().toLowerCase()));
      if (next.length !== explicit.length) {
        explicit = next;
        save(explicit);
      }
      localStorage.removeItem(FLAG);
    } catch { /* ignore */ }
  })();

  const subscribers = new Set();
  function notify() { subscribers.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }

  function normalize(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function listMerged() {
    const map = new Map();
    const touch = (rawName, when, source, content, writing) => {
      const name = String(rawName || "").trim();
      if (!name) return;
      const key = normalize(name);
      if (!map.has(key)) {
        map.set(key, { key, name, usageCount: 0, lastUsed: 0, sources: new Set(), contentSnippets: [], latestWriting: null });
      }
      const e = map.get(key);
      e.usageCount += 1;
      if (when && when > e.lastUsed) e.lastUsed = when;
      e.sources.add(source);
      if (content) e.contentSnippets.push(content);
      // Track the most recent writing (essay or draft) anchored here.
      if (writing && writing.title && (!e.latestWriting || (writing.time || 0) >= (e.latestWriting.time || 0))) {
        e.latestWriting = writing;
      }
    };

    // Explicit Earths
    for (const e of explicit) touch(e.name, e.createdAt || 0, "manual");

    // Drafts in localStorage — also pull the writing content so the
    // clustering step can read what the founder actually wrote here.
    try {
      const drafts = JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]");
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          if (d && d.earth) {
            const titleSource = (d.stitched && d.stitched.title) || (d.title && d.title !== "Untitled draft" ? d.title : null);
            const writing = titleSource
              ? { type: "draft", id: d.id, title: titleSource, time: d.updatedAt || d.createdAt || 0 }
              : null;
            touch(d.earth, d.updatedAt || d.createdAt || 0, "session", extractDraftContent(d), writing);
          }
        }
      }
    } catch { /* ignore */ }

    // Published essays — same idea: include the body so clustering
    // stays informed after publish.
    try {
      const essays = JSON.parse(localStorage.getItem(STORAGE_ESSAYS) || "[]");
      if (Array.isArray(essays)) {
        for (const e of essays) {
          if (e && e.earth) {
            const writing = e.title
              ? { type: "essay", id: e.id, slug: e.slug, title: e.title, time: e.createdAt || 0 }
              : null;
            touch(e.earth, e.createdAt || 0, "session", String(e.body || "").slice(0, 1500), writing);
          }
        }
      }
    } catch { /* ignore */ }

    // Transactions
    const txns = (window.tinkerTransactions && typeof window.tinkerTransactions.list === "function")
      ? window.tinkerTransactions.list()
      : [];
    for (const t of txns) {
      const when = t.date ? new Date(t.date + "T00:00:00").getTime() : 0;
      if (t.merchant) touch(t.merchant, when, "transaction");
    }

    // Drop any Earth the user has explicitly removed (tombstoned).
    // Filtering after the merge means a removed name stays hidden even
    // when it's still referenced by past drafts, essays, or transactions.
    return Array.from(map.values()).filter((e) => !hidden.has(e.key));
  }

  function extractDraftContent(draft) {
    const parts = [];
    if (draft.facing) parts.push(`Facing: ${draft.facing}`);
    if (draft.lastPurchased) parts.push(`Last purchased: ${draft.lastPurchased}`);
    if (Array.isArray(draft.transcript)) {
      for (const turn of draft.transcript) {
        if (turn && turn.a) parts.push(String(turn.a));
      }
    }
    if (draft.stitched && draft.stitched.body) parts.push(String(draft.stitched.body));
    return parts.filter(Boolean).join("\n").slice(0, 1500);
  }

  function addEarth(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    const key = normalize(trimmed);
    // If the user previously removed this Earth, untombstone it — they've
    // explicitly opted back in by typing the name again.
    if (hidden.has(key)) {
      hidden.delete(key);
      saveHidden(hidden);
    }
    // Skip if already in the explicit list (same normalized form).
    if (explicit.some((e) => normalize(e.name) === key)) {
      notify();
      return;
    }
    explicit = [{ id: nextId(), name: trimmed, createdAt: Date.now() }].concat(explicit);
    save(explicit);
    notify();
  }

  function removeEarth(name) {
    const key = normalize(name);
    if (!key) return;
    const before = explicit.length;
    explicit = explicit.filter((e) => normalize(e.name) !== key);
    if (explicit.length !== before) save(explicit);
    // Tombstone so the Earth stays hidden even when it's still
    // referenced by past drafts, essays, or transactions.
    if (!hidden.has(key)) {
      hidden.add(key);
      saveHidden(hidden);
    }
    notify();
  }

  function listHidden() {
    return Array.from(hidden);
  }

  // ── Public API ──────────────────────────────────────────────────────
  window.tinkerEarths = {
    list: listMerged,
    add: addEarth,
    remove: removeEarth,
    hidden: listHidden,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
  };

  // Re-emit when transactions change so the list reflects new merchants.
  if (window.tinkerTransactions && typeof window.tinkerTransactions.subscribe === "function") {
    window.tinkerTransactions.subscribe(() => notify());
  }

  // Server hydration may have overwritten the Earths + hidden storage
  // keys after this module's initial load. Re-read both, then notify
  // subscribers (the sidebar) to re-render.
  window.addEventListener("tinker:hydrated", () => {
    explicit = load();
    hidden = loadHidden();
    notify();
  });
})();
