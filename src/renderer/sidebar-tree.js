/* tinker — sidebar tree (v0.103)
 *
 * Mirrors the pitch deck inside the sidebar: the eleven slide titles
 * are the top tier, and verbatim phrases lifted from the founder's
 * own drafts and essays are the inner rows under each. A heading only
 * appears once the user has written something the classifier maps to
 * it. Cold-start state is empty — brand sits directly above Account
 * and the tree <nav> is hidden.
 *
 * Storage: tinker.tree.v1 holds the blob
 *   {
 *     "<deckHeading>": [
 *       { writingId, offset, length, addedAt },
 *       ...
 *     ],
 *     ...,
 *     "_meta": { mostRecentlyTouched: "<deckHeading>" | null,
 *                expanded: { "<deckHeading>": true|false, ... },
 *                lastClassifyFailedAt: <ts> | null }
 *   }
 *
 * Persisted via sync.js's pushTree(); pulled back on hydrate.
 *
 * The eleven literals are FIXED, AI/developer-authored, and on the
 * chrome allowlist. Everything else under each heading must be a
 * verbatim substring of the founder's own writing, validated at render
 * time by re-reading the substring at { writingId, offset, length }
 * against the live drafts/essays text.
 */

(() => {
  "use strict";

  const TREE_KEY = "tinker.tree.v1";
  const DRAFTS_KEY = "tinker.drafts.v1";
  const ESSAYS_KEY = "tinker.essays.v1";
  const SEEDS_HIDDEN_KEY = "tinker.seeds.hidden.v1";
  const RECOVERY_FLAG = "tinker.recovery.v103.v1";
  // Local-only counter of fresh publications whose classifier result
  // did NOT grow the covered-heading count. Drives the secondary "Other
  // founder journeys" bar's slow asymptotic fill. Not synced — the bar
  // is a per-browser nod to the founder, not a permanent record.
  const OFFPITCH_KEY = "tinker.tree.offPitchCount.v1";
  // How long the transient "strengthened" / "off-pitch" states stay on
  // the progress container before reverting to idle.
  const TRANSIENT_MS = 1000;

  // The eleven deck headings, in deck order — top to bottom in the
  // sidebar. Hard-coded here AND in the classifier; both sides
  // reference the same const so a typo here surfaces immediately.
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

  // Cap per heading: at most two essay titles per deck slide. Older
  // entries are dropped (by addedAt) when a third arrives.
  const MAX_PHRASES_PER_HEADING = 2;

  // ── One-shot v0.103 recovery migration ───────────────────────────
  // v0.102's `seed → earth` rename never shipped to production, but
  // we run this defensively in case a stranded preview-build user
  // landed here with the v0.102 migration flag set. Walk drafts and
  // essays, and where a writing has the migration flag but no
  // recoverable scene tag, mark it "Earth: unknown". Also clear any
  // stale v0.102 tree blob so the new shape isn't fighting old data.
  // Silent — no UI prompt — and gated on RECOVERY_FLAG so it runs
  // once per browser.
  (function recoverFromV0102() {
    try {
      if (localStorage.getItem(RECOVERY_FLAG)) return;

      const v0102Migrated = localStorage.getItem("tinker.earths.migration.v1");
      const fixField = (storageKey) => {
        try {
          const raw = localStorage.getItem(storageKey);
          if (!raw) return;
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr)) return;
          let changed = false;
          for (const item of arr) {
            if (!item || typeof item !== "object") continue;
            // If a v0.102 build was active and lost the field, restore
            // from any leftover `seed` value (the v0.102 rename copied
            // first) or mark as "unknown" so downstream code doesn't
            // crash on a missing field.
            if (v0102Migrated && !item.earth) {
              if (item.seed) {
                item.earth = item.seed;
              } else {
                item.earth = "unknown";
              }
              changed = true;
            }
          }
          if (changed) localStorage.setItem(storageKey, JSON.stringify(arr));
        } catch { /* ignore */ }
      };
      fixField(DRAFTS_KEY);
      fixField(ESSAYS_KEY);

      // Clear any v0.102-era tree blob. It would carry Seed and
      // Growth-vector records that don't apply anymore; the key is
      // reused for the new shape.
      try {
        const raw = localStorage.getItem(TREE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          // Any tree object that doesn't use one of the deck
          // headings as a top-level key is presumed v0.102 shaped.
          if (parsed && typeof parsed === "object") {
            const top = Object.keys(parsed).filter((k) => k !== "_meta");
            const looksLikeV103 = top.length === 0
              || top.every((k) => DECK_HEADINGS.includes(k));
            if (!looksLikeV103) {
              localStorage.removeItem(TREE_KEY);
              try { console.log("[tinker.recovery.v103] cleared stale tree blob"); }
              catch { /* ignore */ }
            }
          }
        }
      } catch { /* ignore */ }

      localStorage.setItem(RECOVERY_FLAG, "1");
    } catch { /* ignore */ }
  })();

  // ── Storage helpers ───────────────────────────────────────────────

  function loadTree() {
    try {
      const raw = localStorage.getItem(TREE_KEY);
      if (!raw) return emptyTree();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return emptyTree();
      // Defensive: drop any top-level key that isn't one of the eleven
      // (or _meta). This is a runtime check against a malformed blob.
      const cleaned = emptyTree();
      for (const heading of DECK_HEADINGS) {
        if (Array.isArray(parsed[heading])) {
          cleaned[heading] = parsed[heading].filter(isValidPhraseRecord);
        }
      }
      const meta = parsed._meta && typeof parsed._meta === "object" ? parsed._meta : {};
      cleaned._meta = {
        mostRecentlyTouched: DECK_HEADINGS.includes(meta.mostRecentlyTouched)
          ? meta.mostRecentlyTouched
          : null,
        expanded: meta.expanded && typeof meta.expanded === "object" ? { ...meta.expanded } : {},
        lastClassifyFailedAt: typeof meta.lastClassifyFailedAt === "number"
          ? meta.lastClassifyFailedAt
          : null,
      };
      return cleaned;
    } catch {
      return emptyTree();
    }
  }

  function emptyTree() {
    const t = { _meta: { mostRecentlyTouched: null, expanded: {}, lastClassifyFailedAt: null } };
    return t;
  }

  function isValidPhraseRecord(p) {
    return p && typeof p === "object"
      && typeof p.writingId === "string"
      && Number.isFinite(p.offset)
      && Number.isFinite(p.length)
      && p.length > 0;
  }

  function saveTree(tree) {
    try { localStorage.setItem(TREE_KEY, JSON.stringify(tree)); }
    catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushTree === "function") {
      window.tinkerSync.pushTree();
    }
  }

  function loadHiddenEarths() {
    try {
      // The hidden set tombstones earth (place) names. Writings whose
      // earth field is in this set are excluded from classification
      // input, per spec.
      const raw = localStorage.getItem(SEEDS_HIDDEN_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }

  function normalizeEarthKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function loadDrafts() {
    try {
      const raw = localStorage.getItem(DRAFTS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function loadEssays() {
    try {
      const raw = localStorage.getItem(ESSAYS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function loadOffPitchCount() {
    try {
      const raw = localStorage.getItem(OFFPITCH_KEY);
      const n = parseInt(raw || "0", 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch { return 0; }
  }

  function saveOffPitchCount(n) {
    try { localStorage.setItem(OFFPITCH_KEY, String(Math.max(0, n | 0))); }
    catch { /* ignore */ }
  }

  // Asymptotic fill — each off-pitch publication adds ~15% of the
  // remaining gap. The bar approaches but never reaches 100%, so the
  // founder always has room to grow on alternate journeys.
  function offPitchPct(n) {
    if (n <= 0) return 0;
    return 1 - Math.pow(0.85, n);
  }

  // ── Writing lookups ───────────────────────────────────────────────

  // The tree's phrase rows reference { writingId, offset, length }
  // into a draft body or an essay body. The draft body is the
  // founder's typed transcript joined; the essay body is the stitched
  // (or status-typed) prose. We re-resolve the body at render time so
  // edits to the underlying writing surface immediately.
  function findWriting(writingId) {
    const drafts = loadDrafts();
    const draft = drafts.find((d) => d.id === writingId);
    if (draft) return { kind: "draft", record: draft, body: bodyForDraft(draft) };
    const essays = loadEssays();
    const essay = essays.find((e) => e.id === writingId);
    if (essay) return { kind: "essay", record: essay, body: String(essay.body || "") };
    return null;
  }

  function bodyForDraft(draft) {
    // Mirror api/classify's view of a draft body: the stitched body if
    // available, otherwise the transcript's answers joined. This is
    // what the classifier was looking at when it picked the offset.
    if (draft && draft.stitched && draft.stitched.body) return String(draft.stitched.body);
    const turns = (draft && Array.isArray(draft.transcript)) ? draft.transcript : [];
    return turns.map((t) => String(t && t.a || "").trim()).filter(Boolean).join("\n\n");
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

  // ── DOM refs ──────────────────────────────────────────────────────

  let navEl = null;
  let listEl = null;
  let progressEl = null;
  let progressCountEl = null;
  let progressFillEl = null;
  let progressBarEl = null;
  let progressSecondaryEl = null;
  let progressSecondaryFillEl = null;
  // Pitch switcher + alt-pitch list mounts. Created lazily inside navEl
  // on first render so we don't need a static slot in index.html. Both
  // live inside [data-audit-ignore] wrappers — alt-pitch chrome is
  // model-generated chip text, outside the verbatim-phrase contract
  // that audits the rest of the tree.
  let switcherEl = null;
  let altListEl = null;

  function ensureMount() {
    navEl = document.querySelector(".sidebar__tree");
    listEl = navEl ? navEl.querySelector(".sidebar__tree-list") : null;
    progressEl = navEl ? navEl.querySelector("[data-tree-progress]") : null;
    // The inner num span is what updateProgress writes to. The outer
    // [data-tree-progress-count] wrapper also contains the transient
    // "stay tuned…" label, shown by CSS only during classifying.
    progressCountEl = navEl ? navEl.querySelector("[data-tree-progress-count-num]") : null;
    progressFillEl = navEl ? navEl.querySelector("[data-tree-progress-fill]") : null;
    progressBarEl = navEl ? navEl.querySelector("[data-tree-progress-bar]") : null;
    progressSecondaryEl = navEl ? navEl.querySelector("[data-tree-progress-secondary]") : null;
    progressSecondaryFillEl = navEl ? navEl.querySelector("[data-tree-progress-secondary-fill]") : null;
    if (!navEl) return;

    // Pitch switcher: a row of chips above the progress bar. Hidden
    // until there's more than one pitch to choose from.
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

    // Alt-pitch list: flat list of essays/drafts in the active alt
    // pitch. Rendered alongside (and instead of) the deck-headings list.
    if (!altListEl || !navEl.contains(altListEl)) {
      altListEl = navEl.querySelector("[data-alt-pitch-list]");
      if (!altListEl) {
        altListEl = document.createElement("div");
        altListEl.className = "sidebar__alt-pitch-list";
        altListEl.setAttribute("data-alt-pitch-list", "");
        altListEl.setAttribute("data-audit-ignore", "");
        altListEl.hidden = true;
        // Sits after the deck-heading list so the switcher → bars →
        // (deck OR alt list) flow reads top-to-bottom.
        if (listEl && listEl.parentNode === navEl) {
          listEl.insertAdjacentElement("afterend", altListEl);
        } else {
          navEl.appendChild(altListEl);
        }
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────

  let memTree = loadTree();

  const api = {
    render,
    /** Append a new phrase under a deck heading. Re-renders on update.
     *  If `writingId` already has a phrase somewhere in the tree, that
     *  prior phrase is replaced (and the heading may change). */
    upsertPhrase({ deckHeading, writingId, offset, length, addedAt }) {
      if (!DECK_HEADINGS.includes(deckHeading)) return;
      if (typeof writingId !== "string" || !writingId) return;
      if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) return;

      // Remove any existing phrase for this writingId in any heading.
      for (const h of DECK_HEADINGS) {
        if (Array.isArray(memTree[h])) {
          memTree[h] = memTree[h].filter((p) => p.writingId !== writingId);
          if (memTree[h].length === 0) delete memTree[h];
        }
      }
      const list = Array.isArray(memTree[deckHeading]) ? memTree[deckHeading] : [];
      list.push({ writingId, offset, length, addedAt: addedAt || Date.now() });
      // Keep the five most-recent (by addedAt).
      list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      memTree[deckHeading] = list.slice(0, MAX_PHRASES_PER_HEADING);
      memTree._meta = memTree._meta || { expanded: {} };
      memTree._meta.mostRecentlyTouched = deckHeading;
      memTree._meta.lastClassifyFailedAt = null;
      // Default-expand the just-touched heading on next paint.
      memTree._meta.expanded = { ...(memTree._meta.expanded || {}) };
      memTree._meta.expanded[deckHeading] = true;
      saveTree(memTree);
      render();
    },
    /** Classifier returned no heading. Drop the prior phrase for this
     *  writing if any, but don't add anything. */
    clearWritingFromTree(writingId) {
      if (!writingId) return;
      let touched = false;
      for (const h of DECK_HEADINGS) {
        if (Array.isArray(memTree[h])) {
          const before = memTree[h].length;
          memTree[h] = memTree[h].filter((p) => p.writingId !== writingId);
          if (memTree[h].length === 0) delete memTree[h];
          if (before !== (memTree[h] ? memTree[h].length : 0)) touched = true;
        }
      }
      if (touched) {
        saveTree(memTree);
        render();
      }
    },
    /** Mark the most recent classifier attempt as failed. Surfaces the
     *  retry affordance in the rendered tree. */
    markClassifyFailed() {
      memTree._meta = memTree._meta || { expanded: {} };
      memTree._meta.lastClassifyFailedAt = Date.now();
      saveTree(memTree);
      render();
    },
    /** Classifier succeeded again; clear the failure state. */
    markClassifySucceeded() {
      if (!memTree._meta) return;
      if (memTree._meta.lastClassifyFailedAt) {
        memTree._meta.lastClassifyFailedAt = null;
        saveTree(memTree);
        render();
      }
    },
    /** Re-classify the most-recently-touched writing on the founder's
     *  manual retry. The renderer wires this onto the ↻ affordance. */
    onManualRetry: null,
    /** Read-only: which writings should NOT be classified (hidden). */
    isWritingHidden(writingId) {
      const hidden = loadHiddenEarths();
      if (hidden.size === 0) return false;
      const drafts = loadDrafts();
      const essays = loadEssays();
      const all = drafts.concat(essays);
      const w = all.find((x) => x && x.id === writingId);
      if (!w) return false;
      const earthKey = normalizeEarthKey(w.earth || w.seed);
      return hidden.has(earthKey);
    },
    /** Public read for diagnostics / tests. */
    snapshot() { return JSON.parse(JSON.stringify(memTree)); },
    /** Deck headings whose phrases still resolve to a verbatim slice of
     *  a draft or essay. Same shape as countCoveredHeadings but returns
     *  the names. */
    coveredHeadings() {
      const out = [];
      for (const heading of DECK_HEADINGS) {
        const recs = Array.isArray(memTree[heading]) ? memTree[heading] : [];
        for (const rec of recs) {
          if (resolvePhraseText(rec)) { out.push(heading); break; }
        }
      }
      return out;
    },
    /** Deck headings that have no resolving phrase yet — the parts of
     *  the founder's pitch they haven't written into. Order matches the
     *  fixed deck order. */
    uncoveredHeadings() {
      const covered = new Set(api.coveredHeadings());
      return DECK_HEADINGS.filter((h) => !covered.has(h));
    },
    /** Visible-string audit. Returns an array of issues found in the
     *  rendered tree DOM. A clean audit is an empty array. */
    auditVisibleStrings,
    DECK_HEADINGS: DECK_HEADINGS.slice(),
  };

  window.tinkerTree = api;

  // ── Render ────────────────────────────────────────────────────────

  function render() {
    ensureMount();
    if (!navEl || !listEl) return;

    // What headings have at least one phrase whose offset still
    // resolves to a non-empty substring? We re-validate at render time
    // because the underlying writing may have been edited (and the
    // offset no longer lands cleanly).
    const renderable = [];
    for (const heading of DECK_HEADINGS) {
      const recs = Array.isArray(memTree[heading]) ? memTree[heading] : [];
      // Order by addedAt (newest first) so the cap retains the most
      // recent essay titles when stored data exceeds the limit (e.g.
      // a returning user whose v0.103 tree was written under the
      // previous five-per-heading cap).
      const ordered = recs.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      const resolved = [];
      for (const rec of ordered) {
        const r = resolvePhraseText(rec);
        if (!r) continue;
        resolved.push({ rec, text: r.slice, kind: r.kind, writing: r.record });
        if (resolved.length >= MAX_PHRASES_PER_HEADING) break;
      }
      if (resolved.length > 0) renderable.push({ heading, resolved });
    }

    const offPitchCount = loadOffPitchCount();

    // Pull alt-pitch state from the companion module (alt-pitches.js).
    // When the module hasn't booted yet we fall back to a single-pitch
    // world — the switcher stays hidden, the starter view renders as
    // before.
    const altModule = window.tinkerAltPitches;
    const pitches = altModule && typeof altModule.getPitches === "function"
      ? altModule.getPitches()
      : [{ id: "starter", title: "Starter", kind: "starter" }];
    const activePitchId = altModule && typeof altModule.getActivePitchId === "function"
      ? altModule.getActivePitchId()
      : "starter";
    const hasAltPitches = pitches.some((p) => p.kind === "alt");
    const onAltView = activePitchId !== "starter" && hasAltPitches
      && pitches.some((p) => p.id === activePitchId);

    // Cold-start / nothing-rendered: hide the entire nav unless the
    // founder has off-pitch publications, in which case the secondary
    // "Other founder journeys" bar carries the acknowledgement on its
    // own. Brand sits directly above Account when both are empty.
    if (renderable.length === 0 && offPitchCount === 0 && !hasAltPitches) {
      navEl.hidden = true;
      listEl.innerHTML = "";
      if (altListEl) { altListEl.hidden = true; altListEl.innerHTML = ""; }
      if (switcherEl) { switcherEl.hidden = true; switcherEl.innerHTML = ""; }
      updateProgress(0);
      renderSecondary(0);
      return;
    }
    navEl.hidden = false;
    renderPitchSwitcher(pitches, activePitchId);

    if (onAltView) {
      // Hide the deck-heading list + the pitch-progress bar; the
      // alt-pitch view runs on its own header (the switcher chip
      // identifies the active pitch).
      listEl.innerHTML = "";
      if (progressEl) progressEl.hidden = true;
      renderAltPitchView(activePitchId);
      refreshActive();
      return;
    }

    if (progressEl) progressEl.hidden = false;
    if (altListEl) { altListEl.hidden = true; altListEl.innerHTML = ""; }
    updateProgress(renderable.length);
    renderSecondary(offPitchCount);

    // No main-pitch headings yet, but off-pitch writing is being
    // acknowledged: render an empty list (no rows) under the bars.
    if (renderable.length === 0) {
      listEl.innerHTML = "";
      return;
    }

    const meta = memTree._meta || {};
    const failed = !!meta.lastClassifyFailedAt;
    const expanded = meta.expanded || {};

    // Default-expand the most-recently-touched heading; fall back to
    // the first renderable heading.
    let defaultExpanded = meta.mostRecentlyTouched && renderable.some((r) => r.heading === meta.mostRecentlyTouched)
      ? meta.mostRecentlyTouched
      : renderable[0].heading;

    listEl.innerHTML = "";
    let topRow = null;
    for (const { heading, resolved } of renderable) {
      const li = document.createElement("li");
      li.className = "sidebar__deck-heading-row";

      const headBtn = document.createElement("button");
      headBtn.type = "button";
      headBtn.className = "sidebar__account-item sidebar__deck-heading";
      headBtn.setAttribute("data-deck-heading", heading);
      const isOpen = heading in expanded ? !!expanded[heading] : heading === defaultExpanded;
      headBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      // Deck-position prefix (1.–11.) — the deck's slide order is fixed,
      // so the number is the heading's index in DECK_HEADINGS + 1. This
      // stays stable as headings appear and disappear from the tree.
      const num = document.createElement("span");
      num.className = "sidebar__deck-heading-num";
      num.setAttribute("aria-hidden", "true");
      num.textContent = `${DECK_HEADINGS.indexOf(heading) + 1}.`;
      headBtn.appendChild(num);
      const label = document.createElement("span");
      label.className = "sidebar__account-label";
      label.textContent = heading;
      headBtn.appendChild(label);

      // Retry affordance — only on the topmost row, only when the
      // most recent classification failed.
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

      headBtn.addEventListener("click", () => toggleExpanded(heading));
      li.appendChild(headBtn);
      if (topRow === null) topRow = li;

      if (isOpen) {
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
          phraseLi.appendChild(phraseBtn);
          inner.appendChild(phraseLi);
        }
        li.appendChild(inner);
      }

      listEl.appendChild(li);
    }

    // Active-row treatment is whisper-quiet (handled in CSS via
    // data-active); only the currently-open row carries the bg.
    refreshActive();
  }

  // ── Pitch switcher ────────────────────────────────────────────────
  //
  // A row of chips at the top of the sidebar tree. One chip per pitch
  // — starter first, then any alt-pitches the model has clustered out
  // of the founder's off-pitch writings. Tapping a chip flips the
  // active pitch and re-renders the tree. The whole switcher lives in
  // a [data-audit-ignore] wrapper since the alt-pitch titles are
  // model-generated rather than verbatim founder text.
  function renderPitchSwitcher(pitches, activePitchId) {
    if (!switcherEl) return;
    if (!pitches || pitches.length <= 1) {
      switcherEl.hidden = true;
      switcherEl.innerHTML = "";
      return;
    }
    switcherEl.hidden = false;
    switcherEl.innerHTML = "";

    const label = document.createElement("div");
    label.className = "sidebar__pitch-switcher-label";
    label.textContent = "Pitches";
    switcherEl.appendChild(label);

    const chipRow = document.createElement("div");
    chipRow.className = "sidebar__pitch-switcher-chips";
    switcherEl.appendChild(chipRow);

    for (const p of pitches) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "sidebar__pitch-chip";
      chip.setAttribute("data-pitch-id", p.id);
      if (p.id === activePitchId) chip.setAttribute("data-active", "");
      chip.textContent = p.title;
      chip.addEventListener("click", () => {
        const altModule = window.tinkerAltPitches;
        if (!altModule) return;
        altModule.setActivePitch(p.id);
      });
      chipRow.appendChild(chip);
    }
  }

  // ── Alt-pitch view ────────────────────────────────────────────────
  //
  // Flat list of the off-pitch writings the model bucketed into the
  // active alt pitch. Each row is a tappable button that opens the
  // writing in the centre column (same routing as a phrase row in the
  // starter pitch). All chrome here is model-generated or
  // developer-authored, so the entire surface sits inside
  // [data-audit-ignore].
  function renderAltPitchView(pitchId) {
    if (!altListEl) return;
    altListEl.hidden = false;
    altListEl.innerHTML = "";

    const altModule = window.tinkerAltPitches;
    const pitch = altModule && typeof altModule.getPitch === "function"
      ? altModule.getPitch(pitchId)
      : null;
    const writings = altModule && typeof altModule.getPitchWritings === "function"
      ? altModule.getPitchWritings(pitchId)
      : [];

    if (!pitch || writings.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sidebar__alt-pitch-empty";
      empty.textContent = "Nothing here yet.";
      altListEl.appendChild(empty);
      return;
    }

    const header = document.createElement("div");
    header.className = "sidebar__alt-pitch-header";
    const headTitle = document.createElement("span");
    headTitle.className = "sidebar__alt-pitch-headline";
    headTitle.textContent = pitch.title;
    const headCount = document.createElement("span");
    headCount.className = "sidebar__alt-pitch-count";
    headCount.textContent = `${writings.length} piece${writings.length === 1 ? "" : "s"}`;
    header.appendChild(headTitle);
    header.appendChild(headCount);
    altListEl.appendChild(header);

    const ul = document.createElement("ul");
    ul.className = "sidebar__alt-pitch-items";
    for (const { kind, record } of writings) {
      if (!record || !record.id) continue;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sidebar__account-item sidebar__alt-pitch-item";
      btn.setAttribute("data-writing-id", record.id);
      const snippet = altPitchPreview(record, kind);
      btn.textContent = snippet;
      btn.title = snippet;
      btn.addEventListener("click", () => openWriting(kind, record));
      li.appendChild(btn);
      ul.appendChild(li);
    }
    altListEl.appendChild(ul);
  }

  function altPitchPreview(record, kind) {
    if (!record) return "Untitled";
    if (record.title) return record.title;
    const body = kind === "draft"
      ? bodyForDraft(record).trim()
      : String(record.body || "").trim();
    if (!body) return "Untitled";
    const words = body.split(/\s+/).slice(0, 9);
    const text = words.join(" ");
    return body.length > text.length ? `${text}…` : text;
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

  function renderSecondary(n) {
    if (!progressSecondaryEl) return;
    if (n <= 0) {
      progressSecondaryEl.hidden = true;
      if (progressSecondaryFillEl) progressSecondaryFillEl.style.width = "0%";
      return;
    }
    const wasHidden = progressSecondaryEl.hidden;
    progressSecondaryEl.hidden = false;
    if (!progressSecondaryFillEl) return;
    const targetPct = Math.round(offPitchPct(n) * 100);
    if (wasHidden) {
      // First appearance: pin to 0% in this frame, then animate to the
      // target on the next, so the bar visibly grows in instead of
      // popping in at its resting width.
      progressSecondaryFillEl.style.width = "0%";
      const fillEl = progressSecondaryFillEl;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fillEl.style.width = `${targetPct}%`;
        });
      });
    } else {
      progressSecondaryFillEl.style.width = `${targetPct}%`;
    }
  }

  // How many of the eleven headings currently resolve to at least one
  // verbatim phrase. Re-validates offsets the same way render() does
  // so prior counts always match what the founder is looking at.
  function countCoveredHeadings() {
    let n = 0;
    for (const heading of DECK_HEADINGS) {
      const recs = Array.isArray(memTree[heading]) ? memTree[heading] : [];
      const ordered = recs.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      for (const rec of ordered) {
        if (resolvePhraseText(rec)) { n++; break; }
      }
    }
    return n;
  }

  // Mirror the progress-state attribute onto both the progress
  // container and the <body> so the brand globe (sidebar header,
  // [data-rainbow-logo]) can react via a body-scoped selector.
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
    if (transientTimer) {
      clearTimeout(transientTimer);
      transientTimer = null;
    }
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

  function nudgeOffPitch() {
    const next = loadOffPitchCount() + 1;
    saveOffPitchCount(next);
    // Re-render so the secondary bar's width animates from old to new.
    render();
    setProgressState("off-pitch");
    if (transientTimer) clearTimeout(transientTimer);
    transientTimer = setTimeout(() => {
      transientTimer = null;
      setProgressState("idle");
    }, TRANSIENT_MS);
  }

  function toggleExpanded(heading) {
    memTree._meta = memTree._meta || { expanded: {} };
    const current = memTree._meta.expanded || {};
    const next = { ...current };
    // If there's no explicit state for this heading yet, default to
    // open (which means tap-to-close).
    const isOpen = heading in current ? !!current[heading] : true;
    next[heading] = !isOpen;
    memTree._meta.expanded = next;
    saveTree(memTree);
    render();
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
    // Mark the row whose data-writing-id matches the currently-open
    // writing, if any. The renderer / writing flow can call
    // setActiveWriting later as the open writing changes.
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
  //
  // Walks every text node inside .sidebar__tree and verifies each is
  // either (a) one of the eleven deck-heading literals, (b) the ↻ retry
  // glyph during a failure, (c) a developer-authored chrome string
  // (deck-position number "N.", or anything inside a [data-audit-ignore]
  // container such as the pitch-progress bar), or (d) a verbatim
  // substring of one of the founder's drafts or essays, located at the
  // offset recorded on that row's data-writing-id. Anything outside
  // (a)–(d) is a bug. Returns an array of issue strings; empty array
  // means clean.
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
      // (c) developer-authored chrome:
      //   - deck-position number "N." inside .sidebar__deck-heading-num
      //   - progress-bar text inside [data-audit-ignore]
      const parent = node.parentElement;
      if (parent) {
        if (parent.closest("[data-audit-ignore]")) continue;
        if (parent.closest(".sidebar__deck-heading-num") && /^\d+\.$/.test(txt)) continue;
      }
      // (d) verbatim substring of a writing
      const phraseRow = node.parentElement && node.parentElement.closest("[data-writing-id]");
      if (phraseRow) {
        const writingId = phraseRow.getAttribute("data-writing-id");
        const recs = [];
        for (const h of DECK_HEADINGS) {
          if (Array.isArray(memTree[h])) {
            for (const rec of memTree[h]) {
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
      // Not in any of (a)–(d).
      issues.push(`unexpected visible string: "${txt.slice(0, 60)}"`);
    }
    return issues;
  }

  // ── Classifier client ─────────────────────────────────────────────
  //
  // Posts a writing's body to /api/classify and folds the response
  // back into the tree. The endpoint enforces the deck-heading
  // allowlist and validates the phrase substring, so the only thing
  // we do here is fork on the shape of the reply.
  //
  // Tracked per-writingId so re-saving the same writing during a
  // session doesn't kick off a parallel classify; the second
  // invocation re-uses the in-flight promise.
  const inflight = new Map();
  let lastClassifiedWritingId = null;

  async function classifyWriting(writingId, opts) {
    if (!writingId) return null;
    if (inflight.has(writingId)) return inflight.get(writingId);

    if (api.isWritingHidden(writingId)) {
      // Hidden writings stay out of classification input entirely.
      return null;
    }
    const found = findWriting(writingId);
    if (!found || !found.body || !found.body.trim()) return null;

    // `fresh` means this is a just-published writing — the founder
    // is watching for feedback. The backfill loop leaves it false so
    // returning-user catch-up runs silently.
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
          body: JSON.stringify({ writingId, body: found.body }),
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
        // Writing doesn't fit any heading — strip any prior phrase.
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
        // Decide which post-classify state to enter. Errors clear the
        // classifying state without crediting the off-pitch counter —
        // a network failure isn't a journey, just a setback.
        if (errored) {
          clearTransientState();
        } else {
          const nextCovered = countCoveredHeadings();
          if (nextCovered > priorCovered) pulseStrengthened();
          else nudgeOffPitch();
        }
      }
      return result;
    } catch (err) {
      // Defensive: don't let the spinning globe linger if anything
      // unexpected escaped the inner promise.
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

  // ── One-shot v0.103 backfill ──────────────────────────────────────
  //
  // Returning users have writings that were never seen by the v0.103
  // classifier (it didn't exist when they wrote them). Without this,
  // the sidebar stays empty until they write a new piece. Walk every
  // draft and essay that isn't already represented in the tree, and
  // classify them one at a time with a small gap so we don't slam
  // Anthropic. Hidden writings are excluded via classifyWriting's own
  // guard. Gated on a flag so it runs once per browser; the version
  // suffix bumps with each shipped change so a browser stuck on a
  // prior empty pass gets one more try with the newer model /
  // validators.
  const BACKFILL_FLAG = "tinker.backfill.v103.v4";
  const BACKFILL_GAP_MS = 400;

  function writingIdsInTree() {
    const ids = new Set();
    for (const h of DECK_HEADINGS) {
      if (Array.isArray(memTree[h])) {
        for (const rec of memTree[h]) ids.add(rec.writingId);
      }
    }
    return ids;
  }

  async function runBackfill() {
    try {
      if (localStorage.getItem(BACKFILL_FLAG)) return;
    } catch { return; }

    // Defer until the user is signed in — no token, no classifier
    // calls. We re-attempt when auth changes (and on next boot).
    let token = "";
    try { token = localStorage.getItem("tinker_jwt") || ""; }
    catch { /* ignore */ }
    if (!token) return;

    const drafts = loadDrafts();
    const essays = loadEssays();
    const known = writingIdsInTree();
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

    // Empty queue is NOT the latch signal: it might just mean
    // hydrate hasn't populated localStorage with the user's drafts
    // and essays yet. If we set the flag now, the next tinker:hydrated
    // run is a no-op and the founder's writings stay invisible
    // forever. Only set the flag after at least one queue item has
    // actually been processed — the cheap re-entries when there's
    // nothing to do are harmless.
    if (queue.length === 0) return;

    try { console.log(`[tinker.backfill.v103] classifying ${queue.length} writing(s) — sidebar will fill in as results land`); }
    catch { /* ignore */ }

    for (const id of queue) {
      try { await classifyWriting(id); }
      catch { /* skip on failure; future edits will reclassify */ }
      // Small spacing between calls so the tree fills in
      // progressively and the API doesn't get hammered.
      await new Promise((r) => setTimeout(r, BACKFILL_GAP_MS));
    }

    try { localStorage.setItem(BACKFILL_FLAG, "1"); } catch { /* ignore */ }
  }

  // ── Event hooks ───────────────────────────────────────────────────
  //
  // writing.js and renderer.js dispatch "tinker:writing-saved" with
  // detail { writingId } on every session-close transition (drafts)
  // and on publish (essays). We listen and run the classifier.
  window.addEventListener("tinker:writing-saved", (e) => {
    const writingId = e && e.detail && e.detail.writingId;
    if (!writingId) return;
    classifyWriting(writingId, { fresh: true });
  });

  // ── Boot ──────────────────────────────────────────────────────────

  function boot() {
    ensureMount();
    render();
    // Returning-user backfill: fire after the initial render so the
    // cold-start state paints first and the tree fills in as results
    // land. No-op when there's a token + nothing to backfill, or when
    // the flag has already been set on a prior boot.
    runBackfill();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // Server hydration may have overwritten the tree blob after this
  // module's initial load. Re-read and re-render. If hydrate just
  // brought in writings the local browser hasn't classified yet, the
  // backfill retries (it's a no-op if the flag is already set or the
  // queue is empty).
  window.addEventListener("tinker:hydrated", () => {
    memTree = loadTree();
    render();
    runBackfill();
  });

  // Auth changed (e.g. just signed in) — same idea: retry backfill
  // now that a token exists.
  window.addEventListener("tinker:auth-changed", () => {
    runBackfill();
  });

  // Alt-pitches module signals when the bucket list changes or when
  // the founder taps a different pitch chip. Either way the sidebar
  // tree owns the rendering, so we re-render on both.
  window.addEventListener("tinker:alt-pitches-changed", () => { render(); });
  window.addEventListener("tinker:active-pitch-changed", () => { render(); });
})();
