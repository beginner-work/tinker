/* tinker — sidebar tree (v0.104)
 *
 * Renders the active pitch's eleven-slide deck inside the sidebar.
 * Every pitch follows the same shape (deck headings + verbatim
 * phrases lifted from the founder's drafts and essays); the pitch
 * dropdown at the top swaps which pitch's deck is on screen.
 *
 * The data layer (load/save pitches, active selection, rehome to
 * /api/alt-pitches) lives in pitches.js. This module is purely a
 * renderer + the /api/classify caller — it reads the active pitch
 * from window.tinkerPitches and writes new phrase records back
 * through pitches.upsertPhrase.
 *
 * Visible-string contract: the eleven deck-heading literals and the
 * "N." position prefix are developer-authored chrome; every other
 * visible string under a phrase row must be a verbatim slice of the
 * founder's writing at the recorded offset. The dropdown UI lives
 * inside [data-audit-ignore] wrappers because pitch titles are
 * model-generated (or founder-edited) rather than verbatim phrases.
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
    const renderable = [];
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
      if (resolved.length > 0) renderable.push({ heading, resolved });
    }

    // Cold-start: no pitches, no resolved phrases. Hide the whole nav
    // so brand sits directly above Account.
    if (pitches.length === 0 && renderable.length === 0) {
      navEl.hidden = true;
      listEl.innerHTML = "";
      if (switcherEl) { switcherEl.hidden = true; switcherEl.innerHTML = ""; }
      updateProgress(0);
      return;
    }
    navEl.hidden = false;

    renderSwitcher(pitches, activeId);
    if (progressEl) progressEl.hidden = false;
    updateProgress(renderable.length);

    if (renderable.length === 0) {
      // Pitch exists but the active deck is empty — nothing to list.
      listEl.innerHTML = "";
      return;
    }

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
      const num = document.createElement("span");
      num.className = "sidebar__deck-heading-num";
      num.setAttribute("aria-hidden", "true");
      num.textContent = `${DECK_HEADINGS.indexOf(heading) + 1}.`;
      headBtn.appendChild(num);
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

      headBtn.addEventListener("click", () => {
        const pm2 = pitchesApi();
        if (pm2 && typeof pm2.toggleExpanded === "function") {
          pm2.toggleExpanded(null, heading);
        }
      });
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

    refreshActive();
  }

  // ── Switcher: dropdown ────────────────────────────────────────────
  //
  // Always visible once at least one pitch exists. The button face
  // shows the active pitch's title; tapping it expands a menu of all
  // pitches. The whole surface sits inside [data-audit-ignore]
  // because titles are model-generated or founder-edited rather than
  // verbatim founder phrases.
  let switcherOpen = false;

  // Render the two-line title block used in the dropdown face and
  // in each menu item. Personal title on top (the founder's
  // recognition name), AI title underneath as a muted subtitle.
  // When only one of the two exists, it sits alone — no awkward
  // empty rows.
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
    return wrap;
  }

  function renderSwitcher(pitches, activeId) {
    if (!switcherEl) return;
    if (!pitches || pitches.length === 0) {
      switcherEl.hidden = true;
      switcherEl.innerHTML = "";
      return;
    }
    switcherEl.hidden = false;
    switcherEl.innerHTML = "";

    const label = document.createElement("div");
    label.className = "sidebar__pitch-switcher-label";
    label.textContent = "Pitch";
    switcherEl.appendChild(label);

    const row = document.createElement("div");
    row.className = "sidebar__pitch-switcher-row";
    switcherEl.appendChild(row);

    const active = pitches.find((p) => p.id === activeId) || pitches[0];

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
      render();
    });
    row.appendChild(face);

    if (switcherOpen) {
      const menu = document.createElement("ul");
      menu.className = "sidebar__pitch-menu";
      menu.setAttribute("role", "listbox");
      for (const p of pitches) {
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
      // (c) developer-authored chrome:
      //   - deck-position number "N." inside .sidebar__deck-heading-num
      //   - anything inside a [data-audit-ignore] container
      const parent = node.parentElement;
      if (parent) {
        if (parent.closest("[data-audit-ignore]")) continue;
        if (parent.closest(".sidebar__deck-heading-num") && /^\d+\.$/.test(txt)) continue;
      }
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
    render();
  });

  // Close the dropdown if the user clicks outside.
  document.addEventListener("click", (e) => {
    if (!switcherOpen) return;
    if (!switcherEl) return;
    if (switcherEl.contains(e.target)) return;
    switcherOpen = false;
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
