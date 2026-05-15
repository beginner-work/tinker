/* tinker — seeds module
 *
 * A seed is a place the founder reflects from (or wants to). It's
 * a single string ("Kitchen counter", "Whole Foods", "the back porch
 * at 7am"). The home list shows the founder's previous seeds as
 * tappable cards; tapping spawns a writing session pre-filled with
 * that seed.
 *
 * Sources merged in list():
 *  1. Explicitly added via the + button (stored in localStorage).
 *  2. Past draft.seed values still in localStorage["tinker.drafts.v1"].
 *  3. Past transaction merchants from window.tinkerTransactions.
 *
 * Each seed surfaces with usageCount + lastUsed so renderer can
 * sort and group by recency.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.seeds.v1";
  const STORAGE_HIDDEN = "tinker.seeds.hidden.v1";
  const STORAGE_DRAFTS = "tinker.drafts.v1";
  const STORAGE_ESSAYS = "tinker.essays.v1";
  const STORAGE_TAXONOMY = "tinker.taxonomy.v1";

  // One-time migration from the previous "location" naming. Runs before
  // anything else reads from storage. Touches: seeds storage keys,
  // draft.location → draft.seed, essay.location → essay.seed, and the
  // taxonomy's inner `locations` map → `seeds`. Gated on a flag so it
  // only fires once per browser.
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
      moveKey("tinker.locations.v1", STORAGE_KEY);
      moveKey("tinker.locations.hidden.v1", STORAGE_HIDDEN);

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

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function save(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushSeeds === "function") {
      window.tinkerSync.pushSeeds();
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
    if (window.tinkerSync && typeof window.tinkerSync.pushSeeds === "function") {
      window.tinkerSync.pushSeeds();
    }
  }
  function nextId() { return "seed_" + Math.random().toString(36).slice(2, 10); }

  let explicit = load();
  let hidden = loadHidden();

  // One-time purge for browsers that received the four preview-seed
  // defaults ("Provecho", "Industrious", "Living room", "Bedroom") on
  // past visits. Gated on the old init flag so it only touches clients
  // that actually got seeded.
  (function purgeOldSeedDefaults() {
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
      // Sidebar cards show this title under the seed name.
      if (writing && writing.title && (!e.latestWriting || (writing.time || 0) >= (e.latestWriting.time || 0))) {
        e.latestWriting = writing;
      }
    };

    // Explicit seeds
    for (const e of explicit) touch(e.name, e.createdAt || 0, "manual");

    // Drafts in localStorage — also pull the writing content so the
    // vector classifier can read what the founder actually wrote here.
    try {
      const drafts = JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]");
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          if (d && d.seed) {
            const titleSource = (d.stitched && d.stitched.title) || (d.title && d.title !== "Untitled draft" ? d.title : null);
            const writing = titleSource
              ? { type: "draft", id: d.id, title: titleSource, time: d.updatedAt || d.createdAt || 0 }
              : null;
            touch(d.seed, d.updatedAt || d.createdAt || 0, "session", extractDraftContent(d), writing);
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
          if (e && e.seed) {
            const writing = e.title
              ? { type: "essay", id: e.id, slug: e.slug, title: e.title, time: e.createdAt || 0 }
              : null;
            touch(e.seed, e.createdAt || 0, "session", String(e.body || "").slice(0, 1500), writing);
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

    // Drop any seed the user has explicitly removed (tombstoned).
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

  // ── Add-seed modal (light, tinker-styled) ────────────────────────
  let modal = null;

  function openAddModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "seed-modal";
    modal.innerHTML = `
      <div class="seed-modal__backdrop" data-close></div>
      <div class="seed-modal__card" role="dialog" aria-modal="true" aria-labelledby="seed-modal-title">
        <header class="seed-modal__head">
          <h2 id="seed-modal-title" class="seed-modal__title">Add a seed</h2>
          <button type="button" class="seed-modal__close" data-close aria-label="Close">×</button>
        </header>
        <p class="seed-modal__sub">A seed — a place you reflect from, a coffee shop, your kitchen, a moment in the day. Used to ground future writing sessions.</p>
        <input type="text" id="seed-modal-input" class="seed-modal__input" placeholder="e.g. Kitchen counter, 7am" maxlength="120" autocomplete="off" spellcheck="false" />
        <span class="seed-modal__msg" data-msg></span>
        <div class="seed-modal__actions">
          <button type="button" class="seed-modal__btn" data-close>Cancel</button>
          <button type="button" class="seed-modal__btn seed-modal__btn--primary" data-action="add">Add seed</button>
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
        msgEl.textContent = "Type a seed first.";
        msgEl.dataset.kind = "err";
        input.focus();
        return;
      }
      addSeed(name);
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

  function addSeed(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    const key = normalize(trimmed);
    // If the user previously removed this seed, untombstone it —
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

  function removeSeed(name) {
    const key = normalize(name);
    if (!key) return;
    const before = explicit.length;
    explicit = explicit.filter((e) => normalize(e.name) !== key);
    if (explicit.length !== before) save(explicit);
    // Tombstone so the seed stays hidden even when it's still
    // referenced by past drafts, essays, or transactions.
    if (!hidden.has(key)) {
      hidden.add(key);
      saveHidden(hidden);
    }
    notify();
  }

  // ── Public API ──────────────────────────────────────────────────────
  window.tinkerSeeds = {
    list: listMerged,
    add: addSeed,
    remove: removeSeed,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    openAddModal,
  };

  // Re-emit when transactions change so the list reflects new merchants.
  if (window.tinkerTransactions && typeof window.tinkerTransactions.subscribe === "function") {
    window.tinkerTransactions.subscribe(() => notify());
  }

  // Server hydration may have overwritten the seeds + hidden storage
  // keys after this module's initial load. Re-read both, then notify
  // subscribers (the sidebar) to re-render.
  window.addEventListener("tinker:hydrated", () => {
    explicit = load();
    hidden = loadHidden();
    notify();
  });
})();
