/* tinker — earths module
 *
 * An "earth" is a place the founder writes from (or wants to). It's a
 * single string ("home", "cafe", "Kitchen counter", "the back porch at
 * 7am"). The sidebar's top tier shows the founder's earths as the
 * roots of a three-tier tree (Earth → Seed → Growth vector).
 *
 * Module name moved from `seeds` → `earths` in the sidebar revamp. The
 * word `seed` now means an AI-derived cluster of growth vectors inside
 * an earth, owned by the clustering blob (`tinker.tree.v1`). This file
 * is only about places.
 *
 * Sources merged in list():
 *  1. Explicitly added via the welcome grid or the add modal
 *     (stored in localStorage).
 *  2. Past draft.earth values still in localStorage["tinker.drafts.v1"].
 *  3. Past transaction merchants from window.tinkerTransactions.
 *
 * Each earth surfaces with usageCount + lastUsed so the renderer can
 * sort and group by recency.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.earths.v1";
  const STORAGE_HIDDEN = "tinker.earths.hidden.v1";
  const STORAGE_DRAFTS = "tinker.drafts.v1";
  const STORAGE_ESSAYS = "tinker.essays.v1";
  const STORAGE_TAXONOMY = "tinker.taxonomy.v1";

  // Idempotent field rename on whichever drafts/essays array is at
  // `storageKey`. Rewrites any item with `seed` (legacy) or `location`
  // (pre-legacy) onto `earth`. Safe to call repeatedly — no-op when
  // every item is already on `earth`. Used by both the one-shot
  // migration below and the `tinker:hydrated` listener (server-pulled
  // data can still carry the legacy field name and would otherwise
  // silently un-migrate the local copy).
  function renameWritingField(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return false;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return false;
      let changed = false;
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        if ("earth" in item) {
          if ("seed" in item) { delete item.seed; changed = true; }
          if ("location" in item) { delete item.location; changed = true; }
          continue;
        }
        if ("seed" in item) {
          item.earth = item.seed;
          delete item.seed;
          if ("location" in item) delete item.location;
          changed = true;
        } else if ("location" in item) {
          item.earth = item.location;
          delete item.location;
          changed = true;
        }
      }
      if (changed) localStorage.setItem(storageKey, JSON.stringify(arr));
      return changed;
    } catch { return false; }
  }

  // Idempotent rename for the taxonomy blob's inner `seeds` map (or,
  // pre-legacy, `locations`) → `earths`. Same one-shot-vs-hydrate
  // story as renameWritingField.
  function renameTaxonomyMap() {
    try {
      const raw = localStorage.getItem(STORAGE_TAXONOMY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return false;
      let changed = false;
      if (parsed.seeds && !parsed.earths) {
        parsed.earths = parsed.seeds;
        delete parsed.seeds;
        changed = true;
      } else if (parsed.seeds && parsed.earths) {
        delete parsed.seeds;
        changed = true;
      }
      if (parsed.locations && !parsed.earths) {
        parsed.earths = parsed.locations;
        delete parsed.locations;
        changed = true;
      } else if (parsed.locations && parsed.earths) {
        delete parsed.locations;
        changed = true;
      }
      if (changed) localStorage.setItem(STORAGE_TAXONOMY, JSON.stringify(parsed));
      return changed;
    } catch { return false; }
  }

  // One-shot KEY move from the previous "seed" naming. The field
  // rename inside drafts/essays/taxonomy is handled separately —
  // it's idempotent and re-runs on every hydrate, because the server
  // can still hand back legacy-shaped blobs that would otherwise
  // silently un-migrate the local copy.
  (function migrateKeysFromSeeds() {
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

  // Previous-generation key move (location → ...). v0.100 builds in
  // the wild already ran something equivalent; the gate makes it a
  // no-op for everyone else. Lands the renamed key on STORAGE_KEY
  // directly to skip the freed `seeds` slot entirely.
  (function migrateKeysFromLocations() {
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
      localStorage.setItem(FLAG, "1");
    } catch { /* ignore */ }
  })();

  // Field rename on initial load. Catches the migrated-from-seed
  // case (local drafts/essays/taxonomy still on the old shape) before
  // anything else reads them.
  renameWritingField(STORAGE_DRAFTS);
  renameWritingField(STORAGE_ESSAYS);
  renameTaxonomyMap();

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
      if (writing && writing.title && (!e.latestWriting || (writing.time || 0) >= (e.latestWriting.time || 0))) {
        e.latestWriting = writing;
      }
    };

    for (const e of explicit) touch(e.name, e.createdAt || 0, "manual");

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

    const txns = (window.tinkerTransactions && typeof window.tinkerTransactions.list === "function")
      ? window.tinkerTransactions.list()
      : [];
    for (const t of txns) {
      const when = t.date ? new Date(t.date + "T00:00:00").getTime() : 0;
      if (t.merchant) touch(t.merchant, when, "transaction");
    }

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

  // ── Add-earth modal (light, tinker-styled) ────────────────────────
  let modal = null;

  function openAddModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "seed-modal";
    modal.innerHTML = `
      <div class="seed-modal__backdrop" data-close></div>
      <div class="seed-modal__card" role="dialog" aria-modal="true" aria-labelledby="seed-modal-title">
        <header class="seed-modal__head">
          <h2 id="seed-modal-title" class="seed-modal__title">Add a place</h2>
          <button type="button" class="seed-modal__close" data-close aria-label="Close">×</button>
        </header>
        <p class="seed-modal__sub">A place you reflect from — a coffee shop, your kitchen, a moment in the day. Used to ground future writing sessions.</p>
        <input type="text" id="seed-modal-input" class="seed-modal__input" placeholder="e.g. Kitchen counter, 7am" maxlength="120" autocomplete="off" spellcheck="false" />
        <span class="seed-modal__msg" data-msg></span>
        <div class="seed-modal__actions">
          <button type="button" class="seed-modal__btn" data-close>Cancel</button>
          <button type="button" class="seed-modal__btn seed-modal__btn--primary" data-action="add">Add</button>
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
        msgEl.textContent = "Type a place first.";
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
    if (hidden.has(key)) {
      hidden.delete(key);
      saveHidden(hidden);
    }
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
    if (!hidden.has(key)) {
      hidden.add(key);
      saveHidden(hidden);
    }
    notify();
  }

  // ── Public API ──────────────────────────────────────────────────────
  window.tinkerEarths = {
    list: listMerged,
    add: addEarth,
    remove: removeEarth,
    isHidden(name) { return hidden.has(normalize(name)); },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    openAddModal,
  };

  // Re-emit when transactions change so the list reflects new merchants.
  if (window.tinkerTransactions && typeof window.tinkerTransactions.subscribe === "function") {
    window.tinkerTransactions.subscribe(() => notify());
  }

  // Server hydration may have overwritten the earth storage keys —
  // AND the drafts/essays/taxonomy blobs — with copies still on the
  // legacy `seed`/`location` field shape (the server hasn't been
  // migrated row-by-row). Re-run the idempotent renames before any
  // consumer reads, then notify subscribers to re-render.
  window.addEventListener("tinker:hydrated", () => {
    renameWritingField(STORAGE_DRAFTS);
    renameWritingField(STORAGE_ESSAYS);
    renameTaxonomyMap();
    explicit = load();
    hidden = loadHidden();
    notify();
  });
})();
