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

  // The founder's own title for a writing — the strongest signal of
  // where they meant it to live, so the classifier gets it alongside
  // the body. Essays carry `title`; drafts may have a top-level title
  // or one on the stitched output.
  function titleForWriting(found) {
    if (!found || !found.record) return "";
    const rec = found.record;
    const t = rec.title || (rec.stitched && rec.stitched.title) || "";
    return String(t).trim();
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

  // The essay currently being dragged between slides, or null. Lives at
  // module scope because dataTransfer payloads aren't readable during
  // dragover — the heading rows need it to light up as drop targets.
  let dragState = null;

  // Pushpin glyphs for the per-slide pin toggle. The old padlock read as
  // "this slide is locked away" — the founder's complaint was exactly
  // that. A pin says what the feature actually does: "this stays where I
  // put it" while everything else is free to reorganize. Pinned = solid
  // pin; unpinned = hollow outline of the same pin.
  const PIN_PATH =
    '<path d="M12 17v5"></path>' +
    '<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"></path>';
  const PIN_SET_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    PIN_PATH + "</svg>";
  const PIN_UNSET_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    PIN_PATH + "</svg>";

  function render() {
    ensureMount();
    if (!navEl || !listEl) return;

    const pm = pitchesApi();
    const pitches = pm && typeof pm.getPitches === "function" ? pm.getPitches() : [];
    const activeId = pm && typeof pm.getActivePitchId === "function" ? pm.getActivePitchId() : null;

    const deck = activeDeck();
    const meta = activeMeta();
    const failed = !!meta.lastClassifyFailedAt;
    const expanded = meta.expanded || {};

    // Resolve each heading's renderable phrases (offsets that still
    // land on a real substring of a current draft or essay body).
    // Every heading lands in `rows` regardless of whether it has any
    // resolved phrases — empty headings render as grayed-out
    // placeholders so the full eleven-slide outline is always visible.
    const rows = [];
    let coveredCount = 0;
    for (const heading of DECK_HEADINGS) {
      const recs = Array.isArray(deck[heading]) ? deck[heading] : [];
      const ordered = recs.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      const resolved = [];
      for (const rec of ordered) {
        const r = resolvePhraseText(rec);
        if (!r) continue;
        resolved.push({ rec, text: r.slice, kind: r.kind, writing: r.record });
        if (resolved.length >= MAX_PHRASES_PER_HEADING) break;
      }
      if (resolved.length > 0) coveredCount++;
      rows.push({ heading, resolved });
    }

    // Cold-start: no pitches at all. Hide the whole nav so brand sits
    // directly above Account until the founder has at least one pitch.
    if (pitches.length === 0) {
      navEl.hidden = true;
      listEl.innerHTML = "";
      if (switcherEl) { switcherEl.hidden = true; switcherEl.innerHTML = ""; }
      if (postEl) { postEl.hidden = true; postEl.innerHTML = ""; }
      updateProgress(0);
      return;
    }
    navEl.hidden = false;

    renderSwitcher(pitches, activeId);
    renderPost(pitches);
    if (progressEl) progressEl.hidden = false;
    updateProgress(coveredCount);

    // Default-expanded heading: prefer the most recently touched if
    // it has phrases, else the first heading that does. When nothing
    // is covered yet, no row opens by default.
    let defaultExpanded = null;
    if (
      meta.mostRecentlyTouched &&
      rows.some((r) => r.heading === meta.mostRecentlyTouched && r.resolved.length > 0)
    ) {
      defaultExpanded = meta.mostRecentlyTouched;
    } else {
      const firstCovered = rows.find((r) => r.resolved.length > 0);
      if (firstCovered) defaultExpanded = firstCovered.heading;
    }

    listEl.innerHTML = "";
    let topRow = null;
    // The slide nav renders the deck bottom-to-top: "The Ask" first,
    // "The Problem" last. Coverage/progress above still walk the
    // canonical DECK_HEADINGS order; only the visible rows reverse.
    for (const { heading, resolved } of rows.slice().reverse()) {
      const hasPhrases = resolved.length > 0;
      const li = document.createElement("li");
      li.className = "sidebar__deck-heading-row";

      const headBtn = document.createElement("button");
      headBtn.type = "button";
      headBtn.className = "sidebar__account-item sidebar__deck-heading";
      headBtn.setAttribute("data-deck-heading", heading);
      let isOpen = false;
      if (hasPhrases) {
        isOpen = heading in expanded ? !!expanded[heading] : heading === defaultExpanded;
        headBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      } else {
        headBtn.setAttribute("data-empty", "");
        headBtn.setAttribute("aria-disabled", "true");
      }
      const label = document.createElement("span");
      label.className = "sidebar__account-label";
      label.textContent = heading;
      headBtn.appendChild(label);

      if (failed && topRow === null) {
        const retry = document.createElement("span");
        retry.className = "sidebar__tree-retry";
        retry.setAttribute("role", "button");
        retry.setAttribute("aria-label", "Retry classification");
        retry.setAttribute("title", "Retry classification");
        retry.tabIndex = 0;
        retry.textContent = "↻";
        retry.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof api.onManualRetry === "function") api.onManualRetry();
        });
        retry.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (typeof api.onManualRetry === "function") api.onManualRetry();
          }
        });
        headBtn.appendChild(retry);
      }

      if (hasPhrases) {
        // Per-slide pin toggle. A pinned beat stays exactly where the
        // founder put it: reorganizing re-clusters everything else
        // around it, and auto-classified writings can't drift into or
        // out of it. The slide isn't locked away — it's held in place.
        // It's a role=button span (not a nested <button>) so it can
        // live inside the heading button, mirroring the retry glyph
        // above. stopPropagation keeps a pin tap from also toggling
        // the row's expand/collapse.
        const locked = pm && typeof pm.isSectionLocked === "function"
          ? pm.isSectionLocked(activeId, heading)
          : false;
        if (locked) headBtn.setAttribute("data-locked", "");
        const lockBtn = document.createElement("span");
        lockBtn.className = "sidebar__deck-lock" + (locked ? " is-locked" : "");
        lockBtn.setAttribute("role", "button");
        lockBtn.tabIndex = 0;
        lockBtn.setAttribute("aria-pressed", locked ? "true" : "false");
        lockBtn.setAttribute(
          "aria-label",
          locked ? `Let ${heading} move again` : `Pin ${heading} where it is`,
        );
        lockBtn.title = locked
          ? "Pinned where you put it — reorganizing keeps this slide. Tap to let it move again."
          : "Pin this slide so it stays where you put it.";
        lockBtn.innerHTML = locked ? PIN_SET_SVG : PIN_UNSET_SVG;
        const toggleLock = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const pm2 = pitchesApi();
          if (pm2 && typeof pm2.toggleSectionLock === "function") {
            pm2.toggleSectionLock(activeId, heading);
          }
        };
        lockBtn.addEventListener("click", toggleLock);
        lockBtn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") toggleLock(e);
        });
        headBtn.appendChild(lockBtn);

        headBtn.addEventListener("click", () => {
          const pm2 = pitchesApi();
          if (pm2 && typeof pm2.toggleExpanded === "function") {
            pm2.toggleExpanded(null, heading);
          }
        });
      }

      // Every heading row — covered or empty — accepts an essay dropped
      // from another slide. The drop is the founder placing the essay
      // by hand, so moveWriting pins the destination afterwards.
      headBtn.addEventListener("dragover", (e) => {
        if (!dragState || dragState.fromHeading === heading) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        headBtn.setAttribute("data-drop-target", "");
      });
      headBtn.addEventListener("dragleave", () => {
        headBtn.removeAttribute("data-drop-target");
      });
      headBtn.addEventListener("drop", (e) => {
        if (!dragState) return;
        e.preventDefault();
        e.stopPropagation();
        const { writingId } = dragState;
        dragState = null;
        headBtn.removeAttribute("data-drop-target");
        const pm2 = pitchesApi();
        if (pm2 && typeof pm2.moveWriting === "function") {
          pm2.moveWriting({ writingId, deckHeading: heading });
        }
      });

      li.appendChild(headBtn);
      if (topRow === null) topRow = li;

      if (hasPhrases && isOpen) {
        const inner = document.createElement("ul");
        inner.className = "sidebar__phrase-list";
        for (const { text, kind, writing, rec } of resolved) {
          const phraseLi = document.createElement("li");
          const phraseBtn = document.createElement("button");
          phraseBtn.type = "button";
          phraseBtn.className = "sidebar__account-item sidebar__phrase";
          phraseBtn.setAttribute("data-writing-id", rec.writingId);
          const phraseLabel = document.createElement("span");
          phraseLabel.className = "sidebar__account-label";
          phraseLabel.textContent = text;
          phraseBtn.appendChild(phraseLabel);
          phraseBtn.addEventListener("click", () => openWriting(kind, writing));
          // Draggable: the founder can pick an essay up and drop it on
          // the slide they think it belongs to (see the heading rows'
          // drop handlers above). The drop pins the destination.
          phraseBtn.draggable = true;
          phraseBtn.addEventListener("dragstart", (e) => {
            dragState = { writingId: rec.writingId, fromHeading: heading };
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = "move";
              try { e.dataTransfer.setData("text/plain", rec.writingId); }
              catch { /* ignore */ }
            }
            phraseBtn.setAttribute("data-dragging", "");
          });
          phraseBtn.addEventListener("dragend", () => {
            dragState = null;
            phraseBtn.removeAttribute("data-dragging");
            if (listEl) {
              for (const t of listEl.querySelectorAll("[data-drop-target]")) {
                t.removeAttribute("data-drop-target");
              }
            }
          });
          phraseLi.appendChild(phraseBtn);
          inner.appendChild(phraseLi);
        }
        li.appendChild(inner);
      }

      listEl.appendChild(li);
    }

    refreshActive();
  }

  // ── Switcher: dropdown + actions ──────────────────────────────────
  //
  // Always visible once at least one pitch exists. The dropdown chip
  // shows the active pitch's title; tapping it expands the menu of
  // all pitches. Beneath the chip, a full-width outlined "Rename
  // pitch" button opens an inline rename input — same step-back
  // treatment as .writing__end. The matching go-forth action — the
  // indigo "Pitch" button — sits separately, at the very bottom of
  // the deck nav (below all eleven slide rows), rendered via
  // renderPost into its own mount. The whole surface sits inside
  // [data-audit-ignore] because titles are model-generated or
  // founder-edited rather than verbatim founder phrases.
  let switcherOpen = false;
  let renameOpen = false;
  // Reorganize state. The refresh icon no longer fires an AI round on
  // sight — it opens a small menu (`organizeMenuOpen`) that says what
  // each option does and what it costs before anything runs. While a
  // round is in flight, `refreshing` disables the button and
  // `refreshStatus` narrates exactly what is happening; `refreshMsg`
  // holds the one-line outcome afterwards (cleared on the next
  // switcher interaction).
  let organizeMenuOpen = false;
  let refreshing = false;
  let refreshStatus = null;
  let refreshMsg = null;

  // Turn an all-pitches organize diff (plus the count we trimmed from the
  // dropdown) into the short line shown under the button. The whole-corpus
  // refresh can move essays between pitches, fold duplicate/empty pitches
  // into siblings (their ids land in removedPitchIds), and leave some
  // pitches resolving to 0 / 11 — those we hide from the dropdown rather
  // than touch the data, so we call them out as trimmed. When nothing
  // shifts at all the AI judged everything already in place — a valid,
  // common outcome, not a failure.
  function describeRefresh(diff, trimmed, kept) {
    const moved = (diff && Array.isArray(diff.movedWritings)) ? diff.movedWritings.length : 0;
    const dissolved = (diff && Array.isArray(diff.removedPitchIds)) ? diff.removedPitchIds.length : 0;
    const parts = [];
    if (moved > 0) parts.push(`moved ${moved} ${moved === 1 ? "essay" : "essays"}`);
    if (dissolved > 0) parts.push(`folded ${dissolved} ${dissolved === 1 ? "pitch" : "pitches"}`);
    if (trimmed > 0) parts.push(`trimmed ${trimmed} at 0 / ${DECK_HEADINGS.length}`);
    if (kept > 0) parts.push(`kept ${kept} locked`);
    if (parts.length === 0) return "All pitches refreshed — everything's already in place.";
    return `Refreshed all pitches — ${parts.join(", ")}.`;
  }

  // Total locked beats across all pitches — the count the refresh held
  // fixed while re-clustering everything else.
  function lockedTotal(pm, pitches) {
    if (!pm || typeof pm.lockedHeadings !== "function" || !Array.isArray(pitches)) return 0;
    let n = 0;
    for (const p of pitches) n += pm.lockedHeadings(p.id).length;
    return n;
  }

  // Count pitches the dropdown now hides: those resolving to 0 / 11. The
  // active pitch is never hidden (it stays visible as the selected face),
  // so it never counts as trimmed.
  function trimmedCount(pitches, activeId) {
    if (!Array.isArray(pitches)) return 0;
    return pitches.filter(
      (p) => p.id !== activeId && (Number(p.robustness) || 0) === 0,
    ).length;
  }

  // How many writings an AI pass would actually re-read: every essay or
  // draft with a non-empty body. Quoted in the menu and the in-flight
  // status line so the founder knows the size of what they're sending.
  function corpusCount() {
    let n = 0;
    for (const e of loadEssays()) {
      if (e && typeof e.id === "string" && String(e.body || "").trim()) n++;
    }
    for (const d of loadDrafts()) {
      if (d && typeof d.id === "string" && bodyForDraft(d).trim()) n++;
    }
    return n;
  }

  function essaysNoun(n) {
    return n === 1 ? "essay" : "essays";
  }

  // One line for the no-AI tidy outcome. Always says "no AI" so the
  // founder can see this path never spent anything.
  function describeTidy(result) {
    const dropped = (result && result.droppedRecords) || 0;
    const pruned = (result && result.prunedPitches) || 0;
    const parts = [];
    if (dropped > 0) parts.push(`cleared ${dropped} stale ${dropped === 1 ? "row" : "rows"}`);
    if (pruned > 0) parts.push(`dropped ${pruned} empty ${pruned === 1 ? "pitch" : "pitches"}`);
    if (parts.length === 0) return "Tidied without AI — everything was already clean.";
    return `Tidied without AI — ${parts.join(", ")}.`;
  }

  // One line for the gather outcome: which pitch everything now lives
  // in and how covered it ended up.
  function describeGather(pm) {
    const focusId = typeof pm.getFocusPitchId === "function" ? pm.getFocusPitchId() : null;
    const pitches = typeof pm.getPitches === "function" ? pm.getPitches() : [];
    const focus = pitches.find((p) => p.id === focusId) || null;
    const name = focus ? focus.displayName : "one pitch";
    const robust = focus ? (Number(focus.robustness) || 0) : 0;
    return `Gathered everything into “${name}” — ${robust} / ${DECK_HEADINGS.length} slides covered. New essays will join it too.`;
  }

  async function runOrganize(mode) {
    const pm = pitchesApi();
    if (!pm || refreshing) return;
    organizeMenuOpen = false;
    switcherOpen = false;
    renameOpen = false;

    // Tidy is local and instant — no network, no AI, no busy state.
    if (mode === "tidy") {
      refreshMsg = typeof pm.tidyPitches === "function"
        ? describeTidy(pm.tidyPitches())
        : null;
      render();
      return;
    }

    refreshing = true;
    refreshMsg = null;
    const n = corpusCount();
    refreshStatus = mode === "gather"
      ? `Claude is re-reading your ${n} ${essaysNoun(n)} and gathering them into one pitch…`
      : `Claude is re-reading your ${n} ${essaysNoun(n)} and re-sorting every slide…`;
    render();
    let result;
    try {
      result = mode === "gather" && typeof pm.gatherIntoPitch === "function"
        ? await pm.gatherIntoPitch()
        : await pm.redistributePitches();
    } catch {
      result = { ok: false, reason: "error" };
    }
    refreshing = false;
    refreshStatus = null;
    if (result && result.ok) {
      if (mode === "gather") {
        refreshMsg = describeGather(pm);
      } else {
        const pitches = typeof pm.getPitches === "function" ? pm.getPitches() : [];
        const activeId = typeof pm.getActivePitchId === "function" ? pm.getActivePitchId() : null;
        refreshMsg = describeRefresh(
          result.diff,
          trimmedCount(pitches, activeId),
          lockedTotal(pm, pitches),
        );
      }
    } else if (result && result.reason === "no-token") {
      refreshMsg = "Sign in to reorganize your pitches.";
    } else if (result && result.reason === "inflight") {
      refreshMsg = null; // a round was already running; stay quiet
    } else {
      refreshMsg = "Couldn't reorganize — try again in a moment.";
    }
    render();
  }

  // A short, human "last edited" label for a pitch — recent edits read
  // as relative time ("edited just now", "edited 3h ago"), older ones
  // fall back to a calendar date ("edited Mar 4"). Returns "" for a
  // missing/invalid timestamp so callers can skip the subtitle.
  function formatEditedDate(ts) {
    const ms = Number(ts);
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const diff = Date.now() - ms;
    if (diff < 0) return "edited just now";
    const min = 60 * 1000;
    const hour = 60 * min;
    const day = 24 * hour;
    if (diff < min) return "edited just now";
    if (diff < hour) return `edited ${Math.floor(diff / min)}m ago`;
    if (diff < day) return `edited ${Math.floor(diff / hour)}h ago`;
    if (diff < 7 * day) return `edited ${Math.floor(diff / day)}d ago`;
    const d = new Date(ms);
    const now = new Date();
    const opts = d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
    let date = "";
    try { date = d.toLocaleDateString(undefined, opts); }
    catch { date = d.toDateString(); }
    return `edited ${date}`;
  }

  // Render the title block used in the dropdown face and in each menu
  // item. Personal title on top (the founder's recognition name), AI
  // title underneath as a muted subtitle, then the last-edited date as
  // a fainter line below. When only one of the titles exists it sits
  // alone — no awkward empty rows.
  function renderTitleStack(pitch) {
    const wrap = document.createElement("span");
    wrap.className = "sidebar__pitch-title-stack";
    const personal = pitch.personalTitle || null;
    const ai = pitch.aiTitle || null;
    if (personal) {
      const personalEl = document.createElement("span");
      personalEl.className = "sidebar__pitch-title-personal";
      personalEl.textContent = personal;
      wrap.appendChild(personalEl);
    }
    if (ai) {
      const aiEl = document.createElement("span");
      aiEl.className = personal
        ? "sidebar__pitch-title-ai sidebar__pitch-title-ai--sub"
        : "sidebar__pitch-title-ai";
      aiEl.textContent = ai;
      wrap.appendChild(aiEl);
    }
    if (!personal && !ai) {
      // Fallback so the chip isn't blank while we wait for the
      // first auto-name call to land.
      const fallback = document.createElement("span");
      fallback.className = "sidebar__pitch-title-ai";
      fallback.textContent = pitch.displayName || "Naming…";
      wrap.appendChild(fallback);
    }
    const editedLabel = formatEditedDate(pitch.updatedAt);
    if (editedLabel) {
      const dateEl = document.createElement("span");
      dateEl.className = "sidebar__pitch-title-date";
      dateEl.textContent = editedLabel;
      wrap.appendChild(dateEl);
    }
    return wrap;
  }

  // The organize menu: three spelled-out options instead of one
  // mystery refresh. Each row says what will happen and whether it
  // costs an AI pass, so pressing it is never a leap of faith.
  function renderOrganizeMenu(active) {
    const pm = pitchesApi();
    const focusId = pm && typeof pm.getFocusPitchId === "function" ? pm.getFocusPitchId() : null;
    const n = corpusCount();
    const activeName = active ? active.displayName : "this pitch";
    // When gathering is already on, name the pitch actually being
    // gathered into — it may not be the one on screen. Picking "Gather
    // again" re-targets gathering at the active pitch.
    const allPitches = pm && typeof pm.getPitches === "function" ? pm.getPitches() : [];
    const focusPitch = focusId ? allPitches.find((p) => p.id === focusId) : null;
    const focusName = focusPitch ? focusPitch.displayName : activeName;

    const menu = document.createElement("div");
    menu.className = "sidebar__organize-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Reorganize options");

    const addOption = ({ title, detail, onPick }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sidebar__organize-option";
      btn.setAttribute("role", "menuitem");
      const t = document.createElement("span");
      t.className = "sidebar__organize-option-title";
      t.textContent = title;
      btn.appendChild(t);
      const d = document.createElement("span");
      d.className = "sidebar__organize-option-detail";
      d.textContent = detail;
      btn.appendChild(d);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPick();
      });
      menu.appendChild(btn);
    };

    addOption({
      title: "Reorganize with AI",
      detail:
        `Claude re-reads your ${n} ${essaysNoun(n)} and re-sorts every slide. ` +
        "Pinned slides stay where you put them. One AI pass." +
        (focusId ? " Brings back multiple pitches." : ""),
      onPick: () => runOrganize("redistribute"),
    });
    addOption({
      title: focusId ? "Gather again" : "Gather into one pitch",
      detail: focusId
        ? `Already gathering into “${focusName}” — new essays join it. Run again to gather into “${activeName}”. One AI pass.`
        : `Claude routes everything into “${activeName}” — the most recent essay wins each slide. New essays join it from then on. One AI pass.`,
      onPick: () => runOrganize("gather"),
    });
    addOption({
      title: "Tidy up — no AI",
      detail: "Clears stale rows and empty pitches. Free — nothing is sent to AI.",
      onPick: () => runOrganize("tidy"),
    });

    return menu;
  }

  function renderSwitcher(pitches, activeId) {
    if (!switcherEl) return;
    if (!pitches || pitches.length === 0) {
      switcherEl.hidden = true;
      switcherEl.innerHTML = "";
      return;
    }
    // While the founder is typing in the rename input, leave the
    // switcher DOM alone. Background pitches-changed events fire
    // while they type — if we rebuilt the switcher on each one, the
    // input would detach and on iOS the keyboard collapses with no
    // way to programmatically re-open it outside a user gesture.
    const existingInput = switcherEl.querySelector(".sidebar__pitch-rename-input");
    if (existingInput && document.activeElement === existingInput) {
      return;
    }
    switcherEl.hidden = false;
    switcherEl.innerHTML = "";

    const active = pitches.find((p) => p.id === activeId) || pitches[0];

    // Header row: the "Pitch" caption on the left; on the right a book
    // icon that opens the pamphlet read of the active pitch, and a
    // reorganize icon that opens the menu of organize options (it never
    // fires an AI round directly — the menu says what each option does,
    // and what it costs, first).
    const head = document.createElement("div");
    head.className = "sidebar__pitch-switcher-head";
    const label = document.createElement("span");
    label.className = "sidebar__pitch-switcher-label";
    label.textContent = "Pitch";
    head.appendChild(label);

    const readBtn = document.createElement("button");
    readBtn.type = "button";
    readBtn.className = "sidebar__pitch-refresh sidebar__pitch-read";
    readBtn.setAttribute("aria-label", "Read this pitch as a pamphlet");
    readBtn.title = "Read this pitch as a pamphlet";
    readBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>' +
      '<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>' +
      "</svg>";
    readBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.tinkerPamphlet && typeof window.tinkerPamphlet.open === "function") {
        window.tinkerPamphlet.open();
      }
    });
    head.appendChild(readBtn);

    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "sidebar__pitch-refresh";
    if (refreshing) refresh.classList.add("is-busy");
    refresh.disabled = refreshing;
    refresh.setAttribute(
      "aria-label",
      refreshing ? "Reorganizing…" : "Reorganize this deck",
    );
    refresh.title = refreshing ? "Reorganizing…" : "Reorganize — with AI, or without";
    refresh.setAttribute("aria-haspopup", "menu");
    refresh.setAttribute("aria-expanded", organizeMenuOpen ? "true" : "false");
    if (refreshing) refresh.setAttribute("aria-busy", "true");
    refresh.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<polyline points="23 4 23 10 17 10"></polyline>' +
      '<polyline points="1 20 1 14 7 14"></polyline>' +
      '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>' +
      "</svg>";
    refresh.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (refreshing) return;
      organizeMenuOpen = !organizeMenuOpen;
      switcherOpen = false;
      renameOpen = false;
      refreshMsg = null;
      render();
    });
    head.appendChild(refresh);
    switcherEl.appendChild(head);

    // While a round runs, narrate it; afterwards, report what changed.
    const noteText = refreshing ? refreshStatus : refreshMsg;
    if (noteText) {
      const note = document.createElement("p");
      note.className = "sidebar__pitch-redistribute-note";
      if (refreshing) note.classList.add("is-busy");
      note.setAttribute("role", "status");
      note.setAttribute("aria-live", "polite");
      note.textContent = noteText;
      switcherEl.appendChild(note);
    }

    if (organizeMenuOpen && !refreshing) {
      switcherEl.appendChild(renderOrganizeMenu(active));
    }

    const row = document.createElement("div");
    row.className = "sidebar__pitch-switcher-row";
    switcherEl.appendChild(row);

    // The face button: shows both the founder's personal recognition
    // name (if set) and the AI-generated canonical name. Layout is
    // two lines — personal as the prominent label (that's what the
    // founder spots fast), AI as a muted subtitle (the canonical
    // identifier that evolves as the pitch's writings change). If
    // only one of the two exists, it sits alone.
    const face = document.createElement("button");
    face.type = "button";
    face.className = "sidebar__pitch-dropdown";
    face.setAttribute("aria-haspopup", "listbox");
    face.setAttribute("aria-expanded", switcherOpen ? "true" : "false");
    const titles = renderTitleStack(active);
    face.appendChild(titles);
    const caret = document.createElement("span");
    caret.className = "sidebar__pitch-dropdown-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "▾";
    face.appendChild(caret);
    face.addEventListener("click", (e) => {
      // Stop bubbling: the document-level "click outside to close"
      // listener also fires on the same event, and by the time it
      // runs the render() below has already detached the face button
      // from the DOM — so switcherEl.contains(e.target) would return
      // false and the menu would close immediately.
      e.preventDefault();
      e.stopPropagation();
      switcherOpen = !switcherOpen;
      renameOpen = false;
      organizeMenuOpen = false;
      refreshMsg = null;
      render();
    });
    row.appendChild(face);

    // When the dropdown is open, the menu of pitches sits directly
    // under the chip so the active pitch and the alternatives stay
    // visually connected. The "Rename pitch" button then slides below
    // the menu — the step-back action stays anchored to the bottom of
    // the switcher block rather than getting trapped above the list.
    if (switcherOpen) {
      // Every pitch in the menu is sharp and selectable — the
      // multi-pitch switcher is free for everyone. The founder can jump
      // to any of their pitches from here; the active one is marked, and
      // each one's robustness ("n / headings") rides along as a quiet
      // signal rather than a gate.
      //
      // Pitches that resolve to 0 / 11 are trimmed from the list — an
      // empty pitch is noise the founder can't act on yet. The active
      // pitch is the one exception: it stays put so the menu always
      // shows what's currently selected (and never goes empty when every
      // pitch happens to be at 0 / 11).
      // Most recently edited first, so the pitch the founder just
      // touched sits at the top of the menu. Ties (and pitches with no
      // recorded edit) fall back to createdAt so ordering stays stable.
      const menuPitches = pitches
        .filter((p) => p.id === active.id || (Number(p.robustness) || 0) > 0)
        .sort((a, b) => {
          const at = Number(a.updatedAt) || Number(a.createdAt) || 0;
          const bt = Number(b.updatedAt) || Number(b.createdAt) || 0;
          return bt - at;
        });
      const menu = document.createElement("ul");
      menu.className = "sidebar__pitch-menu";
      menu.setAttribute("role", "listbox");
      for (const p of menuPitches) {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sidebar__pitch-menu-item";
        btn.setAttribute("data-pitch-id", p.id);
        if (p.id === active.id) btn.setAttribute("data-active", "");
        btn.appendChild(renderTitleStack(p));
        const itemMeta = document.createElement("span");
        itemMeta.className = "sidebar__pitch-menu-meta";
        const robust = Number(p.robustness) || 0;
        itemMeta.textContent = `${robust} / ${DECK_HEADINGS.length}`;
        btn.appendChild(itemMeta);
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const pm = pitchesApi();
          if (pm && typeof pm.setActivePitch === "function") {
            pm.setActivePitch(p.id);
          }
          switcherOpen = false;
          render();
        });
        li.appendChild(btn);
        menu.appendChild(li);
      }
      switcherEl.appendChild(menu);
    }

    // Full-width "Rename pitch" button. Outlined treatment matches
    // .writing__end in the answer flow.
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "sidebar__pitch-action sidebar__pitch-action--secondary";
    rename.textContent = "Rename pitch";
    rename.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      renameOpen = !renameOpen;
      switcherOpen = false;
      organizeMenuOpen = false;
      refreshMsg = null;
      render();
      if (renameOpen) {
        setTimeout(() => {
          const input = switcherEl.querySelector(".sidebar__pitch-rename-input");
          if (input) { input.focus(); input.select(); }
        }, 0);
      }
    });
    switcherEl.appendChild(rename);

    if (renameOpen) {
      const form = document.createElement("form");
      form.className = "sidebar__pitch-rename-form";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "sidebar__pitch-rename-input";
      input.value = active.personalTitle || "";
      input.maxLength = 30;
      input.placeholder = "Your name for this pitch";
      input.autocomplete = "off";
      input.spellcheck = false;
      form.appendChild(input);
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "sidebar__pitch-rename-save";
      submit.textContent = "Save";
      form.appendChild(submit);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pm = pitchesApi();
        if (pm && typeof pm.setPersonalTitle === "function") {
          pm.setPersonalTitle(active.id, input.value);
        }
        renameOpen = false;
        render();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          renameOpen = false;
          render();
        }
      });
      switcherEl.appendChild(form);
    }
  }

  // Pitching happens on beginner, where the founder's profile carries a
  // Renders the indigo "Publish" button at the bottom of the deck nav.
  // tinker stays private; this is the one seam where the founder makes
  // writing public. Clicking it opens the booklet picker (publish-stories.js)
  // — they choose which pitches to surface, and the full essays behind them
  // publish to their public beginner profile. (The founder's QR / Back me
  // page still lives in the profile menu, which delegates to back-me.js.)
  function renderPost(pitches) {
    if (!postEl) return;
    if (!pitches || pitches.length === 0) {
      postEl.hidden = true;
      postEl.innerHTML = "";
      return;
    }
    postEl.hidden = false;
    postEl.innerHTML = "";

    const post = document.createElement("button");
    post.type = "button";
    post.className = "sidebar__pitch-action sidebar__pitch-action--primary";
    post.setAttribute("aria-label", "Publish — share your stories on your profile");
    const pitchLabel = document.createElement("span");
    pitchLabel.textContent = "Publish";
    post.appendChild(pitchLabel);
    // Upload / publish glyph: signals the button pushes the founder's
    // stories out to their public profile.
    const pubIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    pubIcon.setAttribute("width", "13");
    pubIcon.setAttribute("height", "13");
    pubIcon.setAttribute("viewBox", "0 0 24 24");
    pubIcon.setAttribute("fill", "none");
    pubIcon.setAttribute("stroke", "#fff");
    pubIcon.setAttribute("stroke-width", "2");
    pubIcon.setAttribute("stroke-linecap", "round");
    pubIcon.setAttribute("stroke-linejoin", "round");
    pubIcon.setAttribute("aria-hidden", "true");
    pubIcon.setAttribute("data-pitch-publish", "");
    pubIcon.style.marginLeft = "6px";
    for (const d of [
      "M12 19V5",
      "M5 12l7-7 7 7",
    ]) {
      const seg = document.createElementNS("http://www.w3.org/2000/svg", "path");
      seg.setAttribute("d", d);
      pubIcon.appendChild(seg);
    }
    post.appendChild(pubIcon);
    post.style.display = "inline-flex";
    post.style.alignItems = "center";
    post.style.justifyContent = "center";
    post.addEventListener("click", () => {
      // Open the booklet picker (publish-stories.js owns the modal + the
      // POST to /api/publish/booklet and the copy-link success state).
      if (window.tinkerPublishStories && typeof window.tinkerPublishStories.open === "function") {
        window.tinkerPublishStories.open();
      }
    });
    postEl.appendChild(post);
  }

  function updateProgress(coveredCount) {
    if (!progressCountEl && !progressFillEl && !progressBarEl) return;
    const total = DECK_HEADINGS.length;
    const covered = Math.max(0, Math.min(total, coveredCount | 0));
    const pct = Math.round((covered / total) * 100);
    if (progressCountEl) progressCountEl.textContent = `${covered} / ${total}`;
    if (progressFillEl) progressFillEl.style.width = `${pct}%`;
    if (progressBarEl) progressBarEl.setAttribute("aria-valuenow", String(covered));
  }

  // ── Transient progress states ────────────────────────────────────

  let transientTimer = null;
  function setProgressState(state) {
    ensureMount();
    const v = state || "idle";
    if (progressEl) {
      if (v === "idle") progressEl.removeAttribute("data-tree-progress-state");
      else progressEl.setAttribute("data-tree-progress-state", v);
    }
    if (document && document.body) {
      if (v === "idle") document.body.removeAttribute("data-tree-progress-state");
      else document.body.setAttribute("data-tree-progress-state", v);
    }
  }

  function clearTransientState() {
    if (transientTimer) { clearTimeout(transientTimer); transientTimer = null; }
    setProgressState("idle");
  }

  function pulseStrengthened() {
    setProgressState("strengthened");
    if (transientTimer) clearTimeout(transientTimer);
    transientTimer = setTimeout(() => {
      transientTimer = null;
      setProgressState("idle");
    }, TRANSIENT_MS);
  }

  function openWriting(kind, writing) {
    if (!writing) return;
    if (kind === "draft" && typeof window.tinkerResumeDraft === "function") {
      window.tinkerResumeDraft(writing.id);
      return;
    }
    if (kind === "essay" && typeof window.tinkerOpenEssay === "function") {
      window.tinkerOpenEssay(writing.id);
      return;
    }
  }

  function refreshActive() {
    if (!listEl) return;
    const allRows = listEl.querySelectorAll(".sidebar__account-item");
    for (const r of allRows) r.removeAttribute("data-active");
  }

  api.setActiveWriting = function (writingId) {
    if (!navEl) return;
    const allRows = navEl.querySelectorAll(".sidebar__account-item");
    for (const r of allRows) r.removeAttribute("data-active");
    if (!writingId) return;
    const match = navEl.querySelector(`[data-writing-id="${cssAttrEscape(writingId)}"]`);
    if (match) match.setAttribute("data-active", "");
  };

  function cssAttrEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // ── Visible-string audit ──────────────────────────────────────────

  function auditVisibleStrings() {
    const issues = [];
    ensureMount();
    if (!navEl) return issues;
    if (navEl.hidden) return issues;
    const walker = document.createTreeWalker(navEl, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const txt = (node.nodeValue || "").trim();
      if (!txt) continue;
      // (a) one of the eleven deck-heading literals
      if (DECK_HEADINGS.includes(txt)) continue;
      // (b) retry glyph
      if (txt === "↻") continue;
      // (c) developer-authored chrome inside a [data-audit-ignore]
      //     container (pitch switcher, rename UI, etc.)
      const parent = node.parentElement;
      if (parent && parent.closest("[data-audit-ignore]")) continue;
      // (d) verbatim substring of a writing
      const phraseRow = node.parentElement && node.parentElement.closest("[data-writing-id]");
      if (phraseRow) {
        const writingId = phraseRow.getAttribute("data-writing-id");
        const deck = activeDeck();
        const recs = [];
        for (const h of DECK_HEADINGS) {
          if (Array.isArray(deck[h])) {
            for (const rec of deck[h]) {
              if (rec.writingId === writingId) recs.push(rec);
            }
          }
        }
        let matched = false;
        for (const rec of recs) {
          const found = findWriting(writingId);
          if (!found) continue;
          const slice = found.body.slice(rec.offset, rec.offset + rec.length);
          if (slice === txt) { matched = true; break; }
        }
        if (!matched) {
          issues.push(`phrase row text not verbatim against any recorded offset: "${txt.slice(0, 60)}"`);
        }
        continue;
      }
      issues.push(`unexpected visible string: "${txt.slice(0, 60)}"`);
    }
    return issues;
  }

  // ── Classifier client ─────────────────────────────────────────────

  const inflight = new Map();
  let lastClassifiedWritingId = null;

  async function classifyWriting(writingId, opts) {
    if (!writingId) return null;
    if (inflight.has(writingId)) return inflight.get(writingId);

    if (api.isWritingHidden(writingId)) return null;
    const found = findWriting(writingId);
    if (!found || !found.body || !found.body.trim()) return null;

    const fresh = !!(opts && opts.fresh);
    const priorCovered = fresh ? countCoveredHeadings() : 0;
    let errored = false;
    if (fresh) setProgressState("classifying");

    const p = (async () => {
      const token = (function () {
        try { return localStorage.getItem("tinker_jwt") || ""; }
        catch { return ""; }
      })();
      if (!token) {
        try { console.warn(`[tinker.classify] no token, skipping ${writingId}`); }
        catch { /* ignore */ }
        errored = true;
        return null;
      }

      let res;
      try {
        res = await fetch("/api/classify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            writingId,
            body: found.body,
            title: titleForWriting(found) || undefined,
          }),
        });
      } catch (err) {
        api.markClassifyFailed();
        try { console.warn(`[tinker.classify] network error for ${writingId}`, err); }
        catch { /* ignore */ }
        errored = true;
        return null;
      }
      if (!res.ok) {
        api.markClassifyFailed();
        let errText = "";
        try { errText = await res.text(); } catch { /* ignore */ }
        try { console.warn(`[tinker.classify] ${res.status} for ${writingId}: ${errText.slice(0, 200)}`); }
        catch { /* ignore */ }
        errored = true;
        return null;
      }
      let json = null;
      try { json = await res.json(); }
      catch (err) {
        api.markClassifyFailed();
        try { console.warn(`[tinker.classify] bad JSON for ${writingId}`, err); }
        catch { /* ignore */ }
        errored = true;
        return null;
      }
      if (!json || typeof json !== "object") {
        api.markClassifyFailed();
        try { console.warn(`[tinker.classify] empty response for ${writingId}`); }
        catch { /* ignore */ }
        errored = true;
        return null;
      }
      api.markClassifySucceeded();
      lastClassifiedWritingId = writingId;
      if (json.deckHeading && json.phrase) {
        try { console.log(`[tinker.classify] ${writingId} → ${json.deckHeading} (offset ${json.phrase.offset}, len ${json.phrase.length})`); }
        catch { /* ignore */ }
        api.upsertPhrase({
          deckHeading: json.deckHeading,
          writingId,
          offset: json.phrase.offset,
          length: json.phrase.length,
          addedAt: Date.now(),
        });
      } else if (json.deckHeading && !json.phrase) {
        try { console.log(`[tinker.classify] ${writingId} → ${json.deckHeading} but no usable phrase, skipping`); }
        catch { /* ignore */ }
      } else if (json.deckHeading === null) {
        // Doesn't fit the active pitch — leave it for the rehome
        // flow (pitches.js) to bucket into another pitch.
        try { console.log(`[tinker.classify] ${writingId} → no heading match`); }
        catch { /* ignore */ }
        api.clearWritingFromTree(writingId);
      }
      return json;
    })();

    inflight.set(writingId, p);
    try {
      const result = await p;
      if (fresh) {
        if (errored) {
          clearTransientState();
        } else {
          const nextCovered = countCoveredHeadings();
          if (nextCovered > priorCovered) pulseStrengthened();
          else clearTransientState();
        }
      }
      return result;
    } catch (err) {
      if (fresh) clearTransientState();
      throw err;
    } finally {
      inflight.delete(writingId);
    }
  }

  api.classify = classifyWriting;
  api.onManualRetry = function () {
    if (!lastClassifiedWritingId) return;
    classifyWriting(lastClassifiedWritingId, { fresh: true });
  };

  // ── Backfill ──────────────────────────────────────────────────────

  const BACKFILL_FLAG = "tinker.backfill.v104.v1";
  const BACKFILL_GAP_MS = 400;

  function writingIdsInAnyPitch() {
    const ids = new Set();
    const pm = pitchesApi();
    if (!pm || typeof pm.snapshot !== "function") return ids;
    const snap = pm.snapshot();
    for (const pitch of (snap.pitches || [])) {
      for (const h of DECK_HEADINGS) {
        if (Array.isArray(pitch.deck && pitch.deck[h])) {
          for (const rec of pitch.deck[h]) ids.add(rec.writingId);
        }
      }
    }
    return ids;
  }

  async function runBackfill() {
    try {
      if (localStorage.getItem(BACKFILL_FLAG)) return;
    } catch { return; }

    let token = "";
    try { token = localStorage.getItem("tinker_jwt") || ""; }
    catch { /* ignore */ }
    if (!token) return;

    const drafts = loadDrafts();
    const essays = loadEssays();
    const known = writingIdsInAnyPitch();
    const queue = [];
    for (const d of drafts) {
      if (d && d.id && !known.has(d.id)) {
        const body = bodyForDraft(d);
        if (body && body.trim()) queue.push(d.id);
      }
    }
    for (const e of essays) {
      if (e && e.id && !known.has(e.id)) {
        const body = String(e.body || "");
        if (body.trim()) queue.push(e.id);
      }
    }

    if (queue.length === 0) return;

    try { console.log(`[tinker.backfill.v104] classifying ${queue.length} writing(s) — sidebar will fill in as results land`); }
    catch { /* ignore */ }

    for (const id of queue) {
      try { await classifyWriting(id); }
      catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, BACKFILL_GAP_MS));
    }

    try { localStorage.setItem(BACKFILL_FLAG, "1"); } catch { /* ignore */ }
  }

  // ── Event hooks ───────────────────────────────────────────────────

  window.addEventListener("tinker:writing-saved", (e) => {
    const writingId = e && e.detail && e.detail.writingId;
    if (!writingId) return;
    classifyWriting(writingId, { fresh: true });
  });

  window.addEventListener("tinker:hydrated", () => {
    render();
    runBackfill();
  });

  window.addEventListener("tinker:auth-changed", () => {
    runBackfill();
  });

  window.addEventListener("tinker:pitches-changed", () => { render(); });
  window.addEventListener("tinker:active-pitch-changed", () => {
    switcherOpen = false;
    renameOpen = false;
    organizeMenuOpen = false;
    render();
  });

  // Close the dropdown / rename / organize menu if the user clicks outside.
  document.addEventListener("click", (e) => {
    if (!switcherOpen && !renameOpen && !organizeMenuOpen) return;
    if (!switcherEl) return;
    if (switcherEl.contains(e.target)) return;
    switcherOpen = false;
    renameOpen = false;
    organizeMenuOpen = false;
    render();
  });

  // ── Boot ──────────────────────────────────────────────────────────

  function boot() {
    ensureMount();
    render();
    runBackfill();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
