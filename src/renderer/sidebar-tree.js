/* tinker — sidebar tree (v0.105)
 *
 * Renders the active pitch's eleven-slide deck inside the sidebar.
 * Every pitch follows the same shape (deck headings + verbatim
 * phrases lifted from the founder's drafts and essays); the pitch
 * dropdown at the top swaps which pitch's deck is on screen. All
 * eleven slide titles render the moment a pitch exists — headings
 * with no resolved phrases are flagged with [data-empty] so the CSS
 * can gray them out as placeholders.
 *
 * The data layer (load/save pitches, active selection, rehome to
 * /api/alt-pitches) lives in pitches.js. This module is purely a
 * renderer + the /api/classify caller — it reads the active pitch
 * from window.tinkerPitches and writes new phrase records back
 * through pitches.upsertPhrase.
 *
 * Visible-string contract: the eleven deck-heading literals are
 * developer-authored chrome; every other visible string under a
 * phrase row must be a verbatim slice of the founder's writing at
 * the recorded offset. The dropdown + rename action + bottom-of-nav
 * Pitch button live inside [data-audit-ignore] wrappers because
 * pitch titles are model-generated (or founder-edited) rather than
 * verbatim phrases.
 */

(() => {
  "use strict";

  const DRAFTS_KEY = "tinker.drafts.v1";
  const ESSAYS_KEY = "tinker.essays.v1";
  const SEEDS_HIDDEN_KEY = "tinker.seeds.hidden.v1";
  const TRANSIENT_MS = 1000;

  // Mirrors pitches.js DECK_HEADINGS. Duplicated so the audit can
  // run without a hard dependency on the pitches module (e.g. inside
  // the test sandbox before pitches.js boots).
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

  // ── Storage helpers (drafts/essays only — pitches.js owns the deck) ─

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === undefined ? fallback : parsed;
    } catch { return fallback; }
  }

  function loadDrafts() {
    const arr = loadJson(DRAFTS_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function loadEssays() {
    const arr = loadJson(ESSAYS_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function loadHiddenEarths() {
    const arr = loadJson(SEEDS_HIDDEN_KEY, []);
    return new Set(Array.isArray(arr) ? arr : []);
  }

  function normalizeEarthKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  // ── Pitch + writing lookups ──────────────────────────────────────

  function pitchesApi() {
    return window.tinkerPitches || null;
  }

  function activePitch() {
    const pm = pitchesApi();
    if (!pm) return null;
    if (typeof pm.getActivePitch === "function") return pm.getActivePitch();
    return null;
  }

  function activeDeck() {
    const pitch = activePitch();
    return pitch && pitch.deck ? pitch.deck : {};
  }

  function activeMeta() {
    const pitch = activePitch();
    return (pitch && pitch.meta) || {};
  }

  function bodyForDraft(draft) {
    if (draft && draft.stitched && draft.stitched.body) return String(draft.stitched.body);
    const turns = (draft && Array.isArray(draft.transcript)) ? draft.transcript : [];
    return turns.map((t) => String(t && t.a || "").trim()).filter(Boolean).join("\n\n");
  }

  function findWriting(writingId) {
    const drafts = loadDrafts();
    const draft = drafts.find((d) => d.id === writingId);
    if (draft) return { kind: "draft", record: draft, body: bodyForDraft(draft) };
    const essays = loadEssays();
    const essay = essays.find((e) => e.id === writingId);
    if (essay) return { kind: "essay", record: essay, body: String(essay.body || "") };
    return null;
  }

  function resolvePhraseText(rec) {
    if (!rec) return null;
    const found = findWriting(rec.writingId);
    if (!found || !found.body) return null;
    if (rec.offset < 0 || rec.offset + rec.length > found.body.length) return null;
    const slice = found.body.slice(rec.offset, rec.offset + rec.length);
    if (!slice) return null;
    return { slice, kind: found.kind, record: found.record };
  }

  function countCoveredHeadings() {
    const deck = activeDeck();
    let n = 0;
    for (const heading of DECK_HEADINGS) {
      const recs = Array.isArray(deck[heading]) ? deck[heading] : [];
      const ordered = recs.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      for (const rec of ordered) {
        if (resolvePhraseText(rec)) { n++; break; }
      }
    }
    return n;
  }

  // ── DOM refs + mount ──────────────────────────────────────────────

  let navEl = null;
  let listEl = null;
  let progressEl = null;
  let progressCountEl = null;
  let progressFillEl = null;
  let progressBarEl = null;
  // Switcher = dropdown + rename UI. Created lazily inside navEl.
  let switcherEl = null;
  // Post button sits at the very bottom of the deck nav, below the
  // eleven slide rows. Created lazily inside navEl.
  let postEl = null;

  function ensureMount() {
    navEl = document.querySelector(".sidebar__tree");
    listEl = navEl ? navEl.querySelector(".sidebar__tree-list") : null;
    progressEl = navEl ? navEl.querySelector("[data-tree-progress]") : null;
    progressCountEl = navEl ? navEl.querySelector("[data-tree-progress-count-num]") : null;
    progressFillEl = navEl ? navEl.querySelector("[data-tree-progress-fill]") : null;
    progressBarEl = navEl ? navEl.querySelector("[data-tree-progress-bar]") : null;
    if (!navEl) return;

    if (!switcherEl || !navEl.contains(switcherEl)) {
      switcherEl = navEl.querySelector("[data-pitch-switcher]");
      if (!switcherEl) {
        switcherEl = document.createElement("div");
        switcherEl.className = "sidebar__pitch-switcher";
        switcherEl.setAttribute("data-pitch-switcher", "");
        switcherEl.setAttribute("data-audit-ignore", "");
        switcherEl.hidden = true;
        navEl.insertBefore(switcherEl, navEl.firstChild);
      }
    }

    if (!postEl || !navEl.contains(postEl)) {
      postEl = navEl.querySelector("[data-pitch-post]");
      if (!postEl) {
        postEl = document.createElement("div");
        postEl.className = "sidebar__pitch-post";
        postEl.setAttribute("data-pitch-post", "");
        postEl.setAttribute("data-audit-ignore", "");
        postEl.hidden = true;
        navEl.appendChild(postEl);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────
  //
  // The classifier client and the rest of the renderer module call
  // these; they delegate to window.tinkerPitches so the pitches
  // blob stays the single source of truth.

  const api = {
    render,
    upsertPhrase({ deckHeading, writingId, offset, length, addedAt, pitchId }) {
      const pm = pitchesApi();
      if (!pm || typeof pm.upsertPhrase !== "function") return;
      pm.upsertPhrase({ pitchId, deckHeading, writingId, offset, length, addedAt });
      render();
    },
    clearWritingFromTree(writingId) {
      const pm = pitchesApi();
      if (!pm || typeof pm.clearWritingFromAllPitches !== "function") return;
      pm.clearWritingFromAllPitches(writingId);
      render();
    },
    markClassifyFailed() {
      const pm = pitchesApi();
      if (!pm || typeof pm.markClassifyFailed !== "function") return;
      pm.markClassifyFailed();
      render();
    },
    markClassifySucceeded() {
      const pm = pitchesApi();
      if (!pm || typeof pm.markClassifySucceeded !== "function") return;
      pm.markClassifySucceeded();
      render();
    },
    onManualRetry: null,
    isWritingHidden(writingId) {
      const hidden = loadHiddenEarths();
      if (hidden.size === 0) return false;
      const all = loadDrafts().concat(loadEssays());
      const w = all.find((x) => x && x.id === writingId);
      if (!w) return false;
      const earthKey = normalizeEarthKey(w.earth || w.seed);
      return hidden.has(earthKey);
    },
    snapshot() {
      const pm = pitchesApi();
      if (pm && typeof pm.snapshot === "function") return pm.snapshot();
      return { pitches: [], activeId: null };
    },
    coveredHeadings() {
      const out = [];
      const deck = activeDeck();
      for (const heading of DECK_HEADINGS) {
        const recs = Array.isArray(deck[heading]) ? deck[heading] : [];
        for (const rec of recs) {
          if (resolvePhraseText(rec)) { out.push(heading); break; }
        }
      }
      return out;
    },
    uncoveredHeadings() {
      const covered = new Set(api.coveredHeadings());
      return DECK_HEADINGS.filter((h) => !covered.has(h));
    },
    auditVisibleStrings,
    DECK_HEADINGS: DECK_HEADINGS.slice(),
  };

  window.tinkerTree = api;

  // ── Render ────────────────────────────────────────────────────────

  // How many phrases are currently held per heading on the active
  // pitch. Matches the cap in pitches.js.
  const MAX_PHRASES_PER_HEADING = 1;

  // Padlock glyphs for the per-slide lock toggle. Closed = pinned (kept
  // exactly as-is when the founder refreshes); open = free to reorganize.
  // Same stroke treatment as the switcher's refresh icon.
  const LOCK_CLOSED_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>' +
    '<path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
  const LOCK_OPEN_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>' +
    '<path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';


  // Truncated — pitch deck sidebar removal (TYL-65).
  window.tinkerTree = { render() {}, refresh() {} };
})();
