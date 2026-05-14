/* tinker — locations module
 *
 * A location is a place the founder reflects from (or wants to). It's
 * a single string ("Kitchen counter", "Whole Foods", "the back porch
 * at 7am"). The home list shows the founder's previous locations as
 * tappable cards; tapping spawns a writing session pre-filled with
 * that location.
 *
 * Sources merged in list():
 *  1. Explicitly added via the + button (stored in localStorage).
 *  2. Past draft.location values still in localStorage["tinker.drafts.v1"].
 *  3. Past transaction merchants from window.tinkerTransactions.
 *
 * Each location surfaces with usageCount + lastUsed so renderer can
 * sort and group by recency.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.locations.v1";
  const STORAGE_DRAFTS = "tinker.drafts.v1";
  const STORAGE_ESSAYS = "tinker.essays.v1";

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function save(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  }
  function nextId() { return "loc_" + Math.random().toString(36).slice(2, 10); }

  let explicit = load();

  // Preview-only seed. The four default locations appear automatically
  // on Vercel preview deployments + local dev so the founder can poke
  // at the app without typing places in first. Production deploys (the
  // live custom domain) stay empty — invited testers add their own
  // places via the welcome prompt or the sidebar + button.
  //
  // Guard with an init flag so deleting a default doesn't make it
  // re-appear on the next reload.
  const DEFAULTS_KEY = "tinker.locations_initialized.v1";
  const DEFAULTS = ["Provecho", "Industrious", "Living room", "Bedroom"];
  function isPreviewEnv() {
    try {
      const h = (typeof location !== "undefined" && location.hostname) || "";
      if (h === "localhost" || h === "127.0.0.1") return true;
      if (h.endsWith(".vercel.app")) return true;
      return false;
    } catch { return false; }
  }
  (function seedDefaultsOnce() {
    try {
      if (!isPreviewEnv()) return;
      if (localStorage.getItem(DEFAULTS_KEY)) return;
      if (explicit.length === 0) {
        const now = Date.now();
        for (const name of DEFAULTS) {
          explicit.push({ id: "loc_" + Math.random().toString(36).slice(2, 10), name, createdAt: now });
        }
        save(explicit);
      }
      localStorage.setItem(DEFAULTS_KEY, "1");
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
      // Sidebar cards show this title under the location name.
      if (writing && writing.title && (!e.latestWriting || (writing.time || 0) >= (e.latestWriting.time || 0))) {
        e.latestWriting = writing;
      }
    };

    // Explicit locations
    for (const e of explicit) touch(e.name, e.createdAt || 0, "manual");

    // Drafts in localStorage — also pull the writing content so the
    // vector classifier can read what the founder actually wrote here.
    try {
      const drafts = JSON.parse(localStorage.getItem(STORAGE_DRAFTS) || "[]");
      if (Array.isArray(drafts)) {
        for (const d of drafts) {
          if (d && d.location) {
            const titleSource = (d.stitched && d.stitched.title) || (d.title && d.title !== "Untitled draft" ? d.title : null);
            const writing = titleSource
              ? { type: "draft", id: d.id, title: titleSource, time: d.updatedAt || d.createdAt || 0 }
              : null;
            touch(d.location, d.updatedAt || d.createdAt || 0, "session", extractDraftContent(d), writing);
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
          if (e && e.location) {
            const writing = e.title
              ? { type: "essay", id: e.id, slug: e.slug, title: e.title, time: e.createdAt || 0 }
              : null;
            touch(e.location, e.createdAt || 0, "session", String(e.body || "").slice(0, 1500), writing);
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

    return Array.from(map.values());
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

  // ── Add-location modal (light, tinker-styled) ────────────────────────
  let modal = null;

  function openAddModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "loc-modal";
    modal.innerHTML = `
      <div class="loc-modal__backdrop" data-close></div>
      <div class="loc-modal__card" role="dialog" aria-modal="true" aria-labelledby="loc-modal-title">
        <header class="loc-modal__head">
          <h2 id="loc-modal-title" class="loc-modal__title">Add a location</h2>
          <button type="button" class="loc-modal__close" data-close aria-label="Close">×</button>
        </header>
        <p class="loc-modal__sub">A place you reflect from — a coffee shop, your kitchen, a moment in the day. Used to ground future writing sessions.</p>
        <input type="text" id="loc-modal-input" class="loc-modal__input" placeholder="e.g. Kitchen counter, 7am" maxlength="120" autocomplete="off" spellcheck="false" />
        <span class="loc-modal__msg" data-msg></span>
        <div class="loc-modal__actions">
          <button type="button" class="loc-modal__btn" data-close>Cancel</button>
          <button type="button" class="loc-modal__btn loc-modal__btn--primary" data-action="add">Add location</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.documentElement.classList.add("loc-modal-open");

    const input = modal.querySelector("#loc-modal-input");
    const msgEl = modal.querySelector("[data-msg]");

    modal.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", escClose);

    const commit = () => {
      const name = input.value.trim();
      if (!name) {
        msgEl.textContent = "Type a location first.";
        msgEl.dataset.kind = "err";
        input.focus();
        return;
      }
      addLocation(name);
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
    document.documentElement.classList.remove("loc-modal-open");
    document.removeEventListener("keydown", escClose);
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }

  function addLocation(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    const key = normalize(trimmed);
    // Skip if already in the explicit list (same normalized form).
    if (explicit.some((e) => normalize(e.name) === key)) {
      notify();
      return;
    }
    explicit = [{ id: nextId(), name: trimmed, createdAt: Date.now() }].concat(explicit);
    save(explicit);
    notify();
  }

  // ── Public API ──────────────────────────────────────────────────────
  window.tinkerLocations = {
    list: listMerged,
    add: addLocation,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    openAddModal,
  };

  // Re-emit when transactions change so the list reflects new merchants.
  if (window.tinkerTransactions && typeof window.tinkerTransactions.subscribe === "function") {
    window.tinkerTransactions.subscribe(() => notify());
  }
})();
