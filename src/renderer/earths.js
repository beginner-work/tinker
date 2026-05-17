/* tinker — earths module
 *
 * An Earth is a place the founder reflects from (or wants to). It's
 * a single string ("Kitchen counter", "Whole Foods", "the back porch
 * at 7am"). The welcome grid surfaces a few starter Earths; once the
 * founder has writings, the new sidebar tree (tree.js) groups those
 * writings under their Earth.
 *
 * Sources merged in list():
 *  1. Explicitly added via the + button (stored in localStorage).
 *  2. Past draft.earth values still in localStorage["tinker.drafts.v1"].
 *  3. Past transaction merchants from window.tinkerTransactions.
 *
 * Each Earth surfaces with usageCount + lastUsed so renderer can
 * sort and group by recency.
 *
 * Vocabulary note: this module was previously named "seeds" because the
 * founder originally called these places "seeds". The v0.101 sidebar
 * revamp renamed "seed" (place) → "earth" so the word "seed" can carry
 * the new meaning of an AI-clustered topic group inside an Earth. The
 * migration in this file performs the rename; the historic
 * "tinker.locations.v1" → "tinker.seeds.v1" migration is still applied
 * first so a returning user moves through both renames in one boot.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.earths.v1";
  const STORAGE_HIDDEN = "tinker.earths.hidden.v1";
  const STORAGE_DRAFTS = "tinker.drafts.v1";
  const STORAGE_ESSAYS = "tinker.essays.v1";
  const STORAGE_TAXONOMY = "tinker.taxonomy.v1";

  // Idempotent field rename for drafts/essays: every item with a
  // `.seed` key gets its value moved to `.earth`. Safe to re-run after
  // sync.js' hydrate() overwrites localStorage with the server blob,
  // which is the v0.100 shape until the server's drafts/essays get
  // re-pushed with the new shape. Returns true if anything changed.
  function renameFieldsInStorage(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return false;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return false;
      let changed = false;
      for (const item of arr) {
        if (item && typeof item === "object" && "seed" in item) {
          if (!("earth" in item)) item.earth = item.seed;
          delete item.seed;
          changed = true;
        }
      }
      if (changed) localStorage.setItem(storageKey, JSON.stringify(arr));
      return changed;
    } catch { return false; }
  }

  // Same for the inner taxonomy map.
  function renameTaxonomyKey() {
    try {
      const raw = localStorage.getItem(STORAGE_TAXONOMY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.seeds && !parsed.earths) {
        parsed.earths = parsed.seeds;
        delete parsed.seeds;
        localStorage.setItem(STORAGE_TAXONOMY, JSON.stringify(parsed));
        return true;
      }
      return false;
    } catch { return false; }
  }

  // One-time migration from the previous "location" naming (v0.99 →
  // v0.100). Runs before anything else reads from storage. Touches:
  // seeds storage keys, draft.location → draft.seed, essay.location →
  // essay.seed, and the taxonomy's inner `locations` map → `seeds`.
  // Gated on a flag so it only fires once per browser. Left in place
  // because some clients in the wild may still be at v0.99.
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

      const renameLocationField = (storageKey) => {
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
      renameLocationField(STORAGE_DRAFTS);
      renameLocationField(STORAGE_ESSAYS);

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

  // One-time STORAGE-KEY migration from the previous "seed" (place)
  // naming (v0.100 → v0.101). Renames the localStorage keys for
  // explicit/hidden once per browser. The FIELD renames on drafts /
  // essays / taxonomy are NOT gated on this flag — they run on every
  // boot AND every hydrate, because sync.js can overwrite local
  // storage with the v0.100 server shape and we need to re-rename
  // whatever lands. This race is the difference between an empty
  // sidebar tree and a populated one for a returning user.
  (function migrateFromSeedsToEarths() {
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
      localStorage.setItem(FLAG, "1");
    } catch { /* ignore */ }
  })();

  // Rename the v0.100 welcome-tile labels ("Cafe", "Home", "Work")
  // to the v0.101 phrasing ("At a cafe", "At home", "At work").
  // Founder feedback on PR #94: "Home" reads as the app's home page,
  // not a place. Renames apply to:
  //  - the explicit Earth list (tinker.earths.v1, each .name)
  //  - every draft.earth in tinker.drafts.v1
  //  - every essay.earth in tinker.essays.v1
  // Match is exact-case-insensitive so the rename catches both the
  // original "Cafe" and any "cafe" variants. Re-runnable so it
  // survives sync overwriting localStorage with server data.
  const EARTH_RENAMES = new Map([
    ["cafe", "At a cafe"],
    ["home", "At home"],
    ["work", "At work"],
  ]);
  function renameEarthValueInExplicit() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return false;
      let changed = false;
      for (const item of arr) {
        if (!item || typeof item !== "object" || !item.name) continue;
        const next = EARTH_RENAMES.get(String(item.name).trim().toLowerCase());
        if (next && item.name !== next) {
          item.name = next;
          changed = true;
        }
      }
      if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      return changed;
    } catch { return false; }
  }
  function renameEarthValueInWritings(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return false;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return false;
      let changed = false;
      for (const item of arr) {
        if (!item || typeof item !== "object" || !item.earth) continue;
        const next = EARTH_RENAMES.get(String(item.earth).trim().toLowerCase());
        if (next && item.earth !== next) {
          item.earth = next;
          changed = true;
        }
      }
      if (changed) localStorage.setItem(storageKey, JSON.stringify(arr));
      return changed;
    } catch { return false; }
  }

  // Always-on field normalisation. Runs on boot AND after every
  // hydration so the server's v0.100 shape gets rewritten to v0.101
  // even when sync overwrites our local rename. When anything
  // changes, push the new shape back so the server eventually catches
  // up too.
  function normalizeFieldsAndPush() {
    const draftsFieldChanged = renameFieldsInStorage(STORAGE_DRAFTS);
    const essaysFieldChanged = renameFieldsInStorage(STORAGE_ESSAYS);
    renameTaxonomyKey();
    const earthsValueChanged = renameEarthValueInExplicit();
    const draftsValueChanged = renameEarthValueInWritings(STORAGE_DRAFTS);
    const essaysValueChanged = renameEarthValueInWritings(STORAGE_ESSAYS);
    if ((draftsFieldChanged || draftsValueChanged) && window.tinkerSync && typeof window.tinkerSync.pushDrafts === "function") {
      window.tinkerSync.pushDrafts();
    }
    if ((essaysFieldChanged || essaysValueChanged) && window.tinkerSync && typeof window.tinkerSync.pushEssays === "function") {
      window.tinkerSync.pushEssays();
    }
    if (earthsValueChanged && window.tinkerSync && typeof window.tinkerSync.pushEarths === "function") {
      window.tinkerSync.pushEarths();
    }
  }
  normalizeFieldsAndPush();

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

  // One-time purge for browsers that received the four preview defaults
  // ("Provecho", "Industrious", "Living room", "Bedroom") on past
  // visits. Gated on the old init flag so it only touches clients that
  // actually got seeded.
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
      // Sidebar cards show this title under the Earth name.
      if (writing && writing.title && (!e.latestWriting || (writing.time || 0) >= (e.latestWriting.time || 0))) {
        e.latestWriting = writing;
      }
    };

    // Explicit Earths
    for (const e of explicit) touch(e.name, e.createdAt || 0, "manual");

    // Drafts in localStorage — also pull the writing content so the
    // vector classifier can read what the founder actually wrote here.
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

    // Published essays — same idea: include the body so classification
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
    // Filtering here — after the merge — means a removed name stays
    // hidden even when it's still referenced by past drafts, essays,
    // or transactions.
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

  // ── Add-Earth modal (light, tinker-styled) ───────────────────────
  let modal = null;

  function openAddModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "seed-modal";
    modal.innerHTML = `
      <div class="seed-modal__backdrop" data-close></div>
      <div class="seed-modal__card" role="dialog" aria-modal="true" aria-labelledby="seed-modal-title">
        <header class="seed-modal__head">
          <h2 id="seed-modal-title" class="seed-modal__title">Add an Earth</h2>
          <button type="button" class="seed-modal__close" data-close aria-label="Close">×</button>
        </header>
        <p class="seed-modal__sub">An Earth — a place you write from, a coffee shop, your kitchen, a moment in the day. Used to ground future writing sessions.</p>
        <input type="text" id="seed-modal-input" class="seed-modal__input" placeholder="e.g. Kitchen counter, 7am" maxlength="120" autocomplete="off" spellcheck="false" />
        <span class="seed-modal__msg" data-msg></span>
        <div class="seed-modal__actions">
          <button type="button" class="seed-modal__btn" data-close>Cancel</button>
          <button type="button" class="seed-modal__btn seed-modal__btn--primary" data-action="add">Add Earth</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.documentElement.classList.add("seed-modal-open");

    const input = modal.querySelector("#seed-modal-input");
    const msgEl = modal.querySelector("[data-msg]");

    modal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", escClose);

    const commit = () => {
      const name = input.value.trim();
      if (!name) {
        msgEl.textContent = "Type an Earth first.";
        msgEl.dataset.kind = "err";
        input.focus();
        return;
      }
      addEarth(name);
      closeModal();
    };
    modal.querySelector('[data-action="add"]').addEventListener("click", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
    });

    setTimeout(() => input.focus(), 20);
  }

  function closeModal() {
    if (!modal) return;
    modal.remove();
    modal = null;
    document.documentElement.classList.remove("seed-modal-open");
    document.removeEventListener("keydown", escClose);
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }

  function addEarth(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    const key = normalize(trimmed);
    // If the user previously removed this Earth, untombstone it —
    // they've explicitly opted back in by typing the name again.
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

  function getHiddenSet() {
    return new Set(hidden);
  }

  // Deterministic rainbow palette swatch per Earth — same colors as
  // the heatmap avatar palette. Hashed from the NORMALIZED name so
  // the sidebar tree row, the welcome tile, and any future surface
  // colour-match for the same Earth.
  const EARTH_PALETTE = [
    "#f9a8d4", "#fdba74", "#fde68a", "#7bc47a",
    "#7dd3fc", "#c8b6e2", "#6ee7b7",
  ];
  function hashIndex(s, modulo) {
    let h = 0;
    const str = String(s || "");
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % Math.max(1, modulo);
  }
  function colorFor(name) {
    return EARTH_PALETTE[hashIndex(normalize(name), EARTH_PALETTE.length)];
  }

  // ── Public API ──────────────────────────────────────────────────────
  window.tinkerEarths = {
    list: listMerged,
    add: addEarth,
    remove: removeEarth,
    hidden: getHiddenSet,
    color: colorFor,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    openAddModal,
  };

  // Re-emit when transactions change so the list reflects new merchants.
  if (window.tinkerTransactions && typeof window.tinkerTransactions.subscribe === "function") {
    window.tinkerTransactions.subscribe(() => notify());
  }

  // Server hydration may have overwritten the earths + hidden storage
  // keys after this module's initial load. Re-read both, normalise
  // draft/essay fields (the server still ships the v0.100 shape with
  // `.seed`), then notify subscribers (the sidebar tree) to re-render.
  window.addEventListener("tinker:hydrated", () => {
    normalizeFieldsAndPush();
    explicit = load();
    hidden = loadHidden();
    notify();
  });
})();
