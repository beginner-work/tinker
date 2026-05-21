/* tinker — multi-deck management
 *
 * Wraps the founder's per-deck state. Before v0.103 there was one tree
 * (tinker.tree.v1) holding the pitch under the eleven canonical headings.
 * v0.103 introduces additional decks for paid founders — each one its
 * own tree, its own progress threshold, its own source context. The
 * default deck is permanently free.
 *
 * Storage shape — `tinker.decks.v1`:
 *   {
 *     decks: {
 *       "default": {
 *         id, name, sourceUrl, sourceContext, createdAt,
 *         tree: { "<deckHeading>": [...], "_meta": {...} }
 *       },
 *       "deck-<uuid>": { ... },
 *       ...
 *     },
 *     activeId: "<id>",
 *     _meta: { schemaVersion: 1 }
 *   }
 *
 * One-shot migration from the old `tinker.tree.v1` runs once per browser.
 * Silent — no UI.
 *
 * All consumers (sidebar-tree.js, writing.js, validation.js) read and
 * write through `window.tinkerDecks` — they do NOT touch the storage key
 * directly.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.decks.v1";
  const LEGACY_TREE_KEY = "tinker.tree.v1";
  const MIGRATION_FLAG = "tinker.decks.migration.v1";

  // The eleven deck headings — same constant as sidebar-tree.js and
  // api/classify. The classifier and the renderer both reference this
  // identical list.
  const DECK_HEADINGS = [
    "The Problem",
    "A Persona",
    "Why Now?",
    "The Team",
    "The Product",
    "How We Make Money",
    "Go to Market",
    "The Moat",
    "The Vision",
    "Competition",
    "The Ask",
  ];

  // Default deck name. [NEEDS INPUT] — the founder may prefer to name
  // the default deck after the company ("beginner") or product ("tinker")
  // or something else. Placeholder until confirmed.
  const DEFAULT_DECK_NAME = "My pitch";

  // ── Storage helpers ─────────────────────────────────────────────────

  function emptyTree() {
    return { _meta: { mostRecentlyTouched: null, expanded: {}, lastClassifyFailedAt: null } };
  }

  function blankState() {
    return {
      decks: {
        default: {
          id: "default",
          name: DEFAULT_DECK_NAME,
          sourceUrl: null,
          sourceContext: null,
          createdAt: Date.now(),
          tree: emptyTree(),
        },
      },
      activeId: "default",
      _meta: { schemaVersion: 1 },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!parsed.decks || typeof parsed.decks !== "object") return null;
      return parsed;
    } catch { return null; }
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushDecks === "function") {
      window.tinkerSync.pushDecks();
    }
  }

  // ── One-shot migration from tinker.tree.v1 ──────────────────────────
  // If the legacy single-tree key exists and the new decks key doesn't,
  // wrap the old tree into the default deck. Gated on a flag so it runs
  // once per browser. Silent — no UI prompt. Drops the legacy key so
  // future reads come only from the new shape.
  (function runMigration() {
    try {
      if (localStorage.getItem(MIGRATION_FLAG)) return;
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing) {
        localStorage.setItem(MIGRATION_FLAG, "1");
        return;
      }
      const legacyRaw = localStorage.getItem(LEGACY_TREE_KEY);
      let legacyTree = emptyTree();
      if (legacyRaw) {
        try {
          const parsed = JSON.parse(legacyRaw);
          if (parsed && typeof parsed === "object") legacyTree = parsed;
        } catch { /* fall through to empty */ }
      }
      const state = blankState();
      state.decks.default.tree = legacyTree;
      save(state);
      // Drop the legacy key once the new key exists. If something goes
      // wrong the next boot will see the new key and skip migration.
      try { localStorage.removeItem(LEGACY_TREE_KEY); } catch { /* ignore */ }
      localStorage.setItem(MIGRATION_FLAG, "1");
    } catch { /* ignore */ }
  })();

  let memState = load() || blankState();
  if (!memState.activeId || !memState.decks[memState.activeId]) {
    memState.activeId = "default";
  }

  // ── Public API ──────────────────────────────────────────────────────

  function active() {
    return memState.decks[memState.activeId] || memState.decks.default;
  }

  function activeTree() {
    const d = active();
    return d && d.tree ? d.tree : emptyTree();
  }

  function activeId() {
    return memState.activeId;
  }

  function list() {
    return Object.values(memState.decks)
      .filter((d) => d && d.id)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function getById(id) {
    return memState.decks[id] || null;
  }

  function setActive(id) {
    if (!memState.decks[id]) return false;
    if (memState.activeId === id) return true;
    memState.activeId = id;
    save(memState);
    // Notify subscribers (sidebar-tree, validation tile, deck-switcher).
    try { window.dispatchEvent(new CustomEvent("tinker:decks-changed", { detail: { activeId: id } })); }
    catch { /* ignore */ }
    return true;
  }

  function create({ name, sourceUrl, sourceContext }) {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) return null;
    const id = "deck-" + Math.random().toString(36).slice(2, 10);
    memState.decks[id] = {
      id,
      name: trimmedName,
      sourceUrl: sourceUrl || null,
      sourceContext: sourceContext || null,
      createdAt: Date.now(),
      tree: emptyTree(),
    };
    save(memState);
    try { window.dispatchEvent(new CustomEvent("tinker:decks-changed", { detail: { createdId: id } })); }
    catch { /* ignore */ }
    return id;
  }

  function remove(id) {
    if (id === "default") return false;
    if (!memState.decks[id]) return false;
    delete memState.decks[id];
    if (memState.activeId === id) memState.activeId = "default";
    save(memState);
    try { window.dispatchEvent(new CustomEvent("tinker:decks-changed", { detail: { removedId: id } })); }
    catch { /* ignore */ }
    return true;
  }

  // Replace the active deck's tree wholesale. sidebar-tree.js calls this
  // every time it persists a tree update. Kept as a setter (rather than
  // letting consumers mutate state directly) so all writes route through
  // save() and the sync hook.
  function replaceActiveTree(tree) {
    const d = active();
    if (!d) return;
    d.tree = tree || emptyTree();
    save(memState);
  }

  // ── Full-progress signal ────────────────────────────────────────────
  // Block A's validation tile uses this. Returns true iff every entry
  // in DECK_HEADINGS has at least one resolvable phrase in the active
  // (or specified) deck's tree. We delegate resolution to sidebar-tree
  // when available so the offset-validation logic stays in one place;
  // when sidebar-tree isn't loaded yet (boot ordering) we do a cheap
  // length check on the array.
  function fullProgressReached(deckId) {
    const deck = deckId ? getById(deckId) : active();
    if (!deck || !deck.tree) return false;
    for (const heading of DECK_HEADINGS) {
      const recs = Array.isArray(deck.tree[heading]) ? deck.tree[heading] : [];
      if (recs.length === 0) return false;
    }
    // If sidebar-tree exposes a stronger validator (verifies the
    // offset still resolves), prefer that for the active deck only.
    // For non-active decks we fall back to length — they're not on
    // screen right now anyway.
    if (deck.id === memState.activeId
        && window.tinkerTree
        && typeof window.tinkerTree.coveredHeadings === "function") {
      try {
        const covered = window.tinkerTree.coveredHeadings();
        return Array.isArray(covered) && covered.length === DECK_HEADINGS.length;
      } catch { /* fall through */ }
    }
    return true;
  }

  // Append a phrase to a specific deck's tree. The classifier in
  // writing.js / sidebar-tree.js calls this. If deckId is omitted, the
  // active deck is used.
  function appendPhrase(deckId, heading, phrase) {
    const deck = deckId ? getById(deckId) : active();
    if (!deck) return false;
    if (!DECK_HEADINGS.includes(heading)) return false;
    if (!phrase || typeof phrase !== "object") return false;
    if (typeof phrase.writingId !== "string" || !phrase.writingId) return false;
    if (!Number.isFinite(phrase.offset) || !Number.isFinite(phrase.length) || phrase.length <= 0) return false;

    if (!deck.tree) deck.tree = emptyTree();
    // Remove any prior phrase for this writingId across any heading.
    for (const h of DECK_HEADINGS) {
      if (Array.isArray(deck.tree[h])) {
        deck.tree[h] = deck.tree[h].filter((p) => p.writingId !== phrase.writingId);
        if (deck.tree[h].length === 0) delete deck.tree[h];
      }
    }
    const list = Array.isArray(deck.tree[heading]) ? deck.tree[heading] : [];
    list.push({
      writingId: phrase.writingId,
      offset: phrase.offset,
      length: phrase.length,
      addedAt: phrase.addedAt || Date.now(),
    });
    list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    deck.tree[heading] = list.slice(0, 2);
    deck.tree._meta = deck.tree._meta || { expanded: {} };
    deck.tree._meta.mostRecentlyTouched = heading;
    deck.tree._meta.lastClassifyFailedAt = null;
    deck.tree._meta.expanded = { ...(deck.tree._meta.expanded || {}) };
    deck.tree._meta.expanded[heading] = true;

    save(memState);
    return true;
  }

  // ── Boot ────────────────────────────────────────────────────────────

  window.tinkerDecks = {
    active,
    activeId,
    activeTree,
    list,
    getById,
    setActive,
    create,
    remove,
    replaceActiveTree,
    fullProgressReached,
    appendPhrase,
    DECK_HEADINGS: DECK_HEADINGS.slice(),
  };

  // Server hydration may have overwritten the underlying storage after
  // this module's initial load. Re-read into memory.
  //
  // Migration path for cross-device sign-in: the server may carry a
  // legacy `tinker.tree.v1` blob (single-deck client) and no
  // `tinker.decks.v1` blob. Fold the legacy tree into the default deck
  // before notifying subscribers so the sidebar paints the right state.
  window.addEventListener("tinker:hydrated", () => {
    let fresh = load();
    if (!fresh) {
      let legacyTree = null;
      try {
        const raw = localStorage.getItem(LEGACY_TREE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") legacyTree = parsed;
        }
      } catch { /* ignore */ }
      if (legacyTree) {
        const state = blankState();
        state.decks.default.tree = legacyTree;
        save(state);
        try { localStorage.removeItem(LEGACY_TREE_KEY); } catch { /* ignore */ }
        fresh = state;
      }
    }
    if (fresh) {
      memState = fresh;
      if (!memState.activeId || !memState.decks[memState.activeId]) {
        memState.activeId = "default";
      }
    }
    try { window.dispatchEvent(new CustomEvent("tinker:decks-changed", { detail: { source: "hydrated" } })); }
    catch { /* ignore */ }
  });
})();
