/* tinker — renderer chrome
 *
 * Coordinates three views inside the centre column:
 *   - feed     (welcome page, LinkedIn-shaped column of essay cards)
 *   - writing  (onboarding-shaped guided writing flow — see writing.js)
 *   - read     (an opened essay)
 *
 * The sidebar's "Drafts" list is the founder's in-progress essays. Each
 * draft is a small object persisted to localStorage. Selecting a draft
 * opens the writing flow at the question the founder left off on.
 *
 * State boundaries:
 *   - drafts     → localStorage["tinker.drafts.v1"]    (id, title, transcript, currentStep, …)
 *   - essays     → localStorage["tinker.essays.v1"]    (published; rendered in the feed)
 *   - activeId   → which draft (if any) is currently open
 */

(() => {
  "use strict";

  const STORAGE_DRAFTS = "tinker.drafts.v1";
  const STORAGE_ESSAYS = "tinker.essays.v1";
  // Status-composer drafts: half-typed quick thoughts that haven't been
  // posted yet. Keyed by `${categoryKey}::${seed||""}` so each channel
  // gets its own slot — switching categories doesn't clobber the others.
  const STORAGE_STATUS_DRAFTS = "tinker.statusDrafts.v1";

  // ── DOM refs ─────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const sessionsEl = $("#sessions"); // legacy mount; null after the sidebar restructure
  const navHome = $("#nav-home");
  const feedView = $("#welcome");
  const writingView = $("#writing");
  const readView = $("#read");
  const homeListEl = $("#home-list");
  const readBody = $("#read-body");
  const readMenuTrigger = $("#read-menu-trigger");
  const readMenuPop = $("#read-menu-pop");
  const categoryFeedView = $("#category-feed");
  const categoryFeedTitle = $("#category-feed-title");
  const categoryFeedSub = $("#category-feed-sub");
  const categoryFeedList = $("#category-feed-list");
  const categoryFeedEmpty = $("#category-feed-empty");
  const writingFitView = $("#writing-fit");
  const writingFitContent = $("#writing-fit-content");
  const foundersView = $("#founders");
  const pitchScriptView = $("#pitch-script");
  const statusComposer = $("#status-composer");
  const statusComposerInput = $("#status-composer-input");
  const statusComposerPost = $("#status-composer-post");
  const statusComposerHint = $("#status-composer-hint");

  // Which category feed is currently on screen, and what seed the user
  // tapped to land here. The composer attaches new statuses to that
  // seed so they show up under the channel they were typed into.
  let activeCategoryKey = null;
  let activeCategorySeed = null;

  // ── Storage helpers ──────────────────────────────────────────────────
  const uid = () => "d_" + Math.random().toString(36).slice(2, 10);

  function loadDrafts() {
    try {
      const raw = localStorage.getItem(STORAGE_DRAFTS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function saveDrafts(drafts) {
    try { localStorage.setItem(STORAGE_DRAFTS, JSON.stringify(drafts)); } catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushDrafts === "function") {
      window.tinkerSync.pushDrafts();
    }
  }
  function loadEssays() {
    try {
      const raw = localStorage.getItem(STORAGE_ESSAYS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function saveEssays(essays) {
    try { localStorage.setItem(STORAGE_ESSAYS, JSON.stringify(essays)); } catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushEssays === "function") {
      window.tinkerSync.pushEssays();
    }
  }
  function loadStatusDrafts() {
    try {
      const raw = localStorage.getItem(STORAGE_STATUS_DRAFTS);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch { return {}; }
  }
  function saveStatusDrafts(map) {
    try { localStorage.setItem(STORAGE_STATUS_DRAFTS, JSON.stringify(map)); } catch { /* ignore */ }
  }
  function statusDraftKey(categoryKey, seed) {
    return `${categoryKey || ""}::${seed || ""}`;
  }
  function getStatusDraft(categoryKey, seed) {
    const map = loadStatusDrafts();
    const entry = map[statusDraftKey(categoryKey, seed)];
    return entry && typeof entry.body === "string" ? entry : null;
  }
  function setStatusDraft(categoryKey, seed, body) {
    const map = loadStatusDrafts();
    const key = statusDraftKey(categoryKey, seed);
    const trimmed = String(body || "");
    if (!trimmed) {
      delete map[key];
    } else {
      map[key] = { body: trimmed, updatedAt: Date.now() };
    }
    saveStatusDrafts(map);
  }
  function clearStatusDraft(categoryKey, seed) {
    const map = loadStatusDrafts();
    delete map[statusDraftKey(categoryKey, seed)];
    saveStatusDrafts(map);
  }

  // ── State ────────────────────────────────────────────────────────────
  let drafts = loadDrafts();
  let essays = loadEssays();
  let activeId = null; // current draft id, or null when on the feed/read view
  let readingEssayId = null; // currently opened essay in the read view, or null

  // Expose so writing.js can mutate the active draft's state.
  const store = {
    get drafts() { return drafts; },
    get essays() { return essays; },
    getDraft(id) { return drafts.find((d) => d.id === id) || null; },
    getActive() { return drafts.find((d) => d.id === activeId) || null; },
    updateDraft(id, patch) {
      const idx = drafts.findIndex((d) => d.id === id);
      if (idx === -1) return null;
      drafts[idx] = { ...drafts[idx], ...patch, updatedAt: Date.now() };
      saveDrafts(drafts);
      renderSidebar();
      return drafts[idx];
    },
    deleteDraft(id) {
      drafts = drafts.filter((d) => d.id !== id);
      saveDrafts(drafts);
      if (activeId === id) showFeed();
      renderSidebar();
      if (window.tinkerTree && typeof window.tinkerTree.clearWritingFromTree === "function") {
        window.tinkerTree.clearWritingFromTree(id);
      }
    },
    deleteEssay(id) {
      const essay = essays.find((e) => e.id === id);
      if (!essay) return null;
      essays = essays.filter((e) => e.id !== id);
      saveEssays(essays);
      if (readingEssayId === id) showFeed();
      renderHome();
      if (window.tinkerTree && typeof window.tinkerTree.clearWritingFromTree === "function") {
        window.tinkerTree.clearWritingFromTree(id);
      }
      return essay;
    },
    // Soft-hide: keeps the essay in the founder's blob (still synced
    // by PUT /api/user-data/essays) but excluded from category feeds
    // and detached from any pitch slot. The founder can ask for an
    // archived view later — for now, archive is "out of sight, not
    // gone".
    archiveEssay(id) {
      const essay = essays.find((e) => e.id === id);
      if (!essay) return null;
      if (essay.archived) return essay;
      essay.archived = true;
      saveEssays(essays);
      if (readingEssayId === id) showFeed();
      renderHome();
      if (window.tinkerTree && typeof window.tinkerTree.clearWritingFromTree === "function") {
        window.tinkerTree.clearWritingFromTree(id);
      }
      return essay;
    },
    publish(draft, stitched) {
      const slug = slugify(draft.title || stitched.title || "untitled") + "-" + draft.id.slice(2, 6);
      const essay = {
        id: "e_" + Math.random().toString(36).slice(2, 10),
        slug,
        author: stitched.author || "you",
        title: stitched.title || draft.title || "Untitled",
        body: stitched.body || "",
        createdAt: Date.now(),
        url: `/${stitched.author || "you"}/${slug}`,
        sourceDraft: draft.id,
        kind: "essay",
        // Carry seed through so the home list's vector classifier
        // can keep reading the writing content after publish.
        seed: draft.seed || null,
      };
      essays = [essay, ...essays];
      saveEssays(essays);
      drafts = drafts.filter((d) => d.id !== draft.id);
      saveDrafts(drafts);
      activeId = null;
      renderSidebar();
      renderHome();
      // Drop the draft from the tree before classifying the new
      // essay — the draft no longer exists. Then ask the v0.103
      // classifier to place the essay under one of the eleven deck
      // headings.
      if (window.tinkerTree && typeof window.tinkerTree.clearWritingFromTree === "function") {
        window.tinkerTree.clearWritingFromTree(draft.id);
      }
      try {
        window.dispatchEvent(new CustomEvent("tinker:writing-saved", {
          detail: { writingId: essay.id },
        }));
      } catch { /* ignore */ }
      // Replace the post-publish category feed with a screen that
      // tells the founder where this latest writing slots into their
      // eleven-slide starter pitch — or that it doesn't fit yet. The
      // sidebar-tree's classify listener (fired by the event above)
      // already has the call in flight; showWritingFit attaches to
      // that same promise via the inflight dedupe.
      showWritingFit(essay);
      return essay;
    },
    // Short-form post: typed straight into the textarea at the top of
    // a category feed. Skips the interview flow and the stitching/
    // verification logic — the body is exactly what the founder typed.
    // No title; the card and read view render without one. Tied to a
    // seed so the home-list classifier keeps placing it in the same
    // category the founder posted from.
    publishStatus({ body, seed }) {
      const trimmed = String(body || "").trim();
      if (!trimmed) return null;
      const seedName = seed ? String(seed).trim() : null;
      const slug = "status-" + Math.random().toString(36).slice(2, 8);
      const essay = {
        id: "e_" + Math.random().toString(36).slice(2, 10),
        slug,
        author: "you",
        title: null,
        body: trimmed,
        createdAt: Date.now(),
        url: `/you/${slug}`,
        sourceDraft: null,
        kind: "status",
        seed: seedName || null,
      };
      essays = [essay, ...essays];
      saveEssays(essays);
      // Make sure the seed exists in the explicit list so it has a
      // sidebar card. add() is a no-op if it's already there.
      if (seedName && window.tinkerSeeds && typeof window.tinkerSeeds.add === "function") {
        window.tinkerSeeds.add(seedName);
      }
      renderHome();
      try {
        window.dispatchEvent(new CustomEvent("tinker:writing-saved", {
          detail: { writingId: essay.id },
        }));
      } catch { /* ignore */ }
      return essay;
    },
  };
  window.tinkerStore = store;

  function slugify(s) {
    return (s || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 48) || "untitled";
  }

  // ── Drafts as sidebar tabs ──────────────────────────────────────────
  function newDraft({ activate = true, preset = null } = {}) {
    const draft = {
      id: uid(),
      title: "Untitled draft",
      transcript: [],         // [{ q: string, a: string }, …]
      currentStep: 0,         // index into transcript (cursor)
      stitched: null,         // last computed { title, body } from the engine
      pending: null,          // last asked but not-yet-answered question
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (preset && typeof preset === "object") {
      // Pre-set the scene fields. writing.js' renderSeedPrompt
      // checks `active.seed === undefined`, so once we assign
      // a string (or null) the prompt is skipped and the founder
      // jumps straight into the mood-tuned first question.
      if (preset.seed !== undefined) draft.seed = preset.seed || null;
      if (preset.facing !== undefined) draft.facing = preset.facing || null;
      if (preset.lastPurchased !== undefined) draft.lastPurchased = preset.lastPurchased || null;
    }
    drafts.unshift(draft);
    saveDrafts(drafts);
    renderSidebar();
    if (activate) openDraft(draft.id);
    return draft;
  }

  function openDraft(id) {
    const draft = store.getDraft(id);
    if (!draft) return;
    activeId = id;
    renderSidebar();
    showWriting();
    if (window.tinkerWriting) window.tinkerWriting.open(draft);
  }

  function closeActiveDraft() {
    activeId = null;
    renderSidebar();
    showFeed();
  }

  // ── Views ───────────────────────────────────────────────────────────
  function showFeed() {
    if (typeof window.tinkerCloseReadMenu === "function") window.tinkerCloseReadMenu();
    feedView.setAttribute("data-active", "");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    if (foundersView) foundersView.hidden = true;
    if (pitchScriptView) pitchScriptView.hidden = true;
    activeId = null;
    readingEssayId = null;
    activeCategoryKey = null;
    activeCategorySeed = null;
    renderSidebar();
    renderHome();
    // If the "Somewhere else" specify input is already open, drop focus
    // there; otherwise leave focus on the grid (the tiles are buttons,
    // so keyboard users land on the first one via Tab).
    const formEl = document.getElementById("welcome-form");
    const inputEl = document.getElementById("welcome-input");
    if (formEl && !formEl.hidden && inputEl) {
      setTimeout(() => { inputEl.focus(); inputEl.select(); }, 30);
    }
  }
  function showWriting() {
    feedView.removeAttribute("data-active");
    writingView.hidden = false;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    if (foundersView) foundersView.hidden = true;
    if (pitchScriptView) pitchScriptView.hidden = true;
  }
  function showRead(essay) {
    if (typeof window.tinkerCloseReadMenu === "function") window.tinkerCloseReadMenu();
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = false;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    if (foundersView) foundersView.hidden = true;
    if (pitchScriptView) pitchScriptView.hidden = true;
    activeId = null;
    readingEssayId = essay.id;
    renderSidebar();
    // Title wraps the text in an inner span so the mobile floating
    // title bar can centre with text-overflow: ellipsis — both
    // properties only behave when applied to a sized child, not to
    // a flex container directly.
    const titleHtml = essay.title
      ? `<h1 class="read__title"><span>${escapeHtml(essay.title)}</span></h1>`
      : "";
    // Subtitle: which pitch + which slide this essay sits under. Falls
    // back to the author label (the older "you" line) when the essay
    // hasn't been placed in any pitch yet, so the slot is never empty.
    const subtitle = pitchSubtitleHtmlFor(essay) || escapeHtml(essay.author || "you");
    readBody.innerHTML =
      `<header class="read__head">` +
        `<div class="read__author">${subtitle}</div>` +
        titleHtml +
      `</header>` +
      paragraphs(essay.body);
  }
  function showCategoryFeed(categoryKey, originatingSeed) {
    if (!categoryFeedView) return false;
    const feed = (window.tinkerHeatmap && typeof window.tinkerHeatmap.getCategoryFeed === "function")
      ? window.tinkerHeatmap.getCategoryFeed(categoryKey)
      : null;
    if (!feed) return false;

    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = true;
    categoryFeedView.hidden = false;
    if (writingFitView) writingFitView.hidden = true;
    if (foundersView) foundersView.hidden = true;
    if (pitchScriptView) pitchScriptView.hidden = true;
    activeId = null;
    activeCategoryKey = categoryKey;
    // Prefer the seed the user just tapped. Fall back to the most-
    // recently-touched seed in this category so the composer still
    // has somewhere to attach a status (e.g. when the feed is opened
    // by routing after publish, with no clicked seed in hand).
    activeCategorySeed = originatingSeed || pickSeedForCategory(feed) || null;
    renderSidebar();

    categoryFeedTitle.textContent = feed.name;
    if (feed.description) {
      categoryFeedSub.textContent = feed.description;
      categoryFeedSub.hidden = false;
    } else {
      categoryFeedSub.textContent = "";
      categoryFeedSub.hidden = true;
    }

    refreshStatusComposer();

    categoryFeedList.innerHTML = "";
    if (!feed.essays.length) {
      categoryFeedEmpty.hidden = false;
      return true;
    }
    categoryFeedEmpty.hidden = true;
    for (const essay of feed.essays) {
      categoryFeedList.appendChild(renderFeedCard(essay));
    }
    return true;
  }

  // Post-publish arrangement screen. Replaces the older "writing-fit"
  // confirmation that reported a single placement up front — that was
  // a lie when the server-side organize job moved the essay or renamed
  // the pitch a few seconds later. This screen instead shows the whole
  // arrangement as it settles: every pitch as a row, the new essay
  // entering "reconsideration", and — when organize returns — any swaps,
  // renames, or pitch dissolutions that happened in the round.
  //
  // Three phases, driven off real lifecycle events from
  // window.tinkerPitches:
  //   1. reconsidering — classify is in flight; the essay hasn't been
  //      slotted anywhere yet.
  //   2. settling — classify landed, organize is running on the server.
  //      The essay shows in its tentative pitch with a rainbow bar.
  //   3. locked — organize returned; the bar fills, swaps + renames +
  //      dissolved pitches are called out.
  //
  // ArrangementState is the single source of truth for what the screen
  // currently shows; we mutate fields on it and call renderArrangement
  // to repaint, so phase transitions don't race with each other.
  let arrangementState = null;
  let arrangementOrganizeHandler = null;

  function showWritingFit(essay) {
    if (!writingFitView || !writingFitContent) {
      showRead(essay);
      return;
    }
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    writingFitView.hidden = false;
    if (foundersView) foundersView.hidden = true;
    if (pitchScriptView) pitchScriptView.hidden = true;
    activeId = null;
    readingEssayId = null;
    activeCategoryKey = null;
    activeCategorySeed = null;
    renderSidebar();

    // Detach any previous organize listener from a prior publish.
    if (arrangementOrganizeHandler) {
      window.removeEventListener("tinker:organize-completed", arrangementOrganizeHandler);
      arrangementOrganizeHandler = null;
    }

    arrangementState = {
      essay,
      phase: "reconsidering",          // reconsidering → settling → locked → error
      classifyResult: undefined,       // undefined = pending, null = errored, object = settled
      placement: null,                 // { pitchId, deckHeading } once classify lands
      diff: null,                      // populated when organize returns
      organizeError: null,             // populated on organize failure
      titlesBefore: snapshotTitles(),  // captured pre-organize for rename callouts
    };
    renderArrangement();

    const tree = window.tinkerTree;
    const pitches = window.tinkerPitches;
    if (!tree || typeof tree.classify !== "function") {
      arrangementState.classifyResult = null;
      arrangementState.phase = "error";
      renderArrangement();
      return;
    }

    Promise.resolve()
      .then(() => tree.classify(essay.id, { fresh: true }))
      .then((result) => {
        if (!arrangementState || arrangementState.essay.id !== essay.id) return;
        arrangementState.classifyResult = result || null;
        // Read where pitches.js actually slotted the writing — classify
        // calls upsertPhrase, which may have created a fresh pitch if
        // none existed yet.
        if (pitches && typeof pitches.findPitchForWriting === "function") {
          arrangementState.placement = pitches.findPitchForWriting(essay.id);
        }
        arrangementState.phase = "settling";
        renderArrangement();

        if (!pitches || typeof pitches.triggerOrganizeNow !== "function") {
          arrangementState.phase = "locked";
          renderArrangement();
          return;
        }

        arrangementOrganizeHandler = (evt) => {
          if (!arrangementState || arrangementState.essay.id !== essay.id) return;
          const detail = (evt && evt.detail) || {};
          if (detail.ok) {
            arrangementState.diff = detail.diff || null;
            arrangementState.phase = "locked";
          } else {
            arrangementState.organizeError = detail.reason || "unknown";
            arrangementState.phase = "locked";   // still surface the classify placement
          }
          renderArrangement();
          window.removeEventListener("tinker:organize-completed", arrangementOrganizeHandler);
          arrangementOrganizeHandler = null;
        };
        window.addEventListener("tinker:organize-completed", arrangementOrganizeHandler);

        pitches.triggerOrganizeNow({ force: true }).catch(() => { /* surfaced via event */ });
      })
      .catch(() => {
        if (!arrangementState || arrangementState.essay.id !== essay.id) return;
        arrangementState.classifyResult = null;
        arrangementState.phase = "error";
        renderArrangement();
      });
  }

  function snapshotTitles() {
    const pitches = window.tinkerPitches;
    if (!pitches || typeof pitches.getPitches !== "function") return {};
    const out = {};
    for (const p of pitches.getPitches()) {
      out[p.id] = p.displayName || null;
    }
    return out;
  }

  function renderArrangement() {
    if (!arrangementState || !writingFitContent) return;
    const { essay, phase, classifyResult, placement, diff, organizeError } = arrangementState;
    const headings = (window.tinkerTree && window.tinkerTree.DECK_HEADINGS) || [];
    const titleText = fitTitleFor(essay);
    const pitches = window.tinkerPitches;
    const allPitches = (pitches && typeof pitches.getPitches === "function")
      ? pitches.getPitches()
      : [];

    const phaseCopy = phaseLabel(phase, classifyResult, organizeError);

    // Phrase the classifier lifted (if any) — shown as a chip alongside
    // the essay so the founder sees what the model latched onto.
    let phraseText = "";
    if (classifyResult && classifyResult.phrase && essay.body) {
      const { offset, length } = classifyResult.phrase;
      if (Number.isFinite(offset) && Number.isFinite(length)
          && offset >= 0 && offset + length <= essay.body.length) {
        phraseText = String(essay.body).slice(offset, offset + length);
      }
    }

    const finalPlacement = (phase === "locked" && pitches && typeof pitches.findPitchForWriting === "function")
      ? pitches.findPitchForWriting(essay.id)
      : placement;
    const finalPitchId = finalPlacement ? finalPlacement.pitchId : null;
    const tentativePitchId = (placement && placement.pitchId !== finalPitchId) ? placement.pitchId : null;

    // Per-pitch colour is keyed to each pitch's stable position in the
    // underlying list, captured BEFORE we reorder for display — so a
    // pitch keeps the same hue across the reconsidering → settling →
    // locked lifecycle even as the rows shuffle by completeness.
    const totalHeadings = headings.length || 11;
    const colorByPitchId = new Map();
    allPitches.forEach((p, i) => colorByPitchId.set(p.id, pitchColorForIndex(i)));

    // The existing pitches stay hidden until the very end. During
    // reconsidering/settling the placement is still tentative — showing
    // the rows then made it look like the essay locked into one pitch
    // and then jumped to another, which read as confusing. So we only
    // reveal the rows once the arrangement is locked (or errored, a
    // terminal state); until then a neutral skeleton stands in so the
    // screen still reads as "thinking" without naming a pitch we might
    // not keep.
    const showRows = phase === "locked" || phase === "error";

    // Order: the pitch the essay locked into rises to the very top, then
    // the rest by completeness (most-covered first). On error there's no
    // lock, so it's a straight completeness sort.
    const orderedPitches = allPitches.slice().sort((a, b) => {
      if (a.id === finalPitchId && b.id !== finalPitchId) return -1;
      if (b.id === finalPitchId && a.id !== finalPitchId) return 1;
      return (b.robustness || 0) - (a.robustness || 0);
    });

    const rowsHtml = !showRows
      ? ""
      : orderedPitches.length === 0
      ? `<div class="arrangement__empty">No pitches yet — this essay will seed your first one.</div>`
      : orderedPitches.map((p) => {
          const isFinal = p.id === finalPitchId;
          const isTentative = p.id === tentativePitchId;
          const rowColor = colorByPitchId.get(p.id) || pitchColorForIndex(0);
          const summaryText = pitchDirectionSummary(p.id);
          const wasRenamed = diff && diff.renamedPitches.some((r) => r.pitchId === p.id);
          const rowState =
            phase === "locked" ? (isFinal ? "locked" : "idle")
            : (isFinal || isTentative) ? "active"
            : "idle";
          // Bar fill is the pitch's real completeness: how many of the
          // eleven deck headings it covers. No more fake settling
          // percentages — the bar means the same thing in every phase.
          const fillPct = Math.round(((p.robustness || 0) / totalHeadings) * 100);
          const chipHtml = isFinal && phase === "locked"
            ? arrangementChipHtml(essay, classifyResult, phase, isTentative)
            : "";
          const beforeName = arrangementState.titlesBefore && arrangementState.titlesBefore[p.id];
          const renameHtml = wasRenamed && beforeName && beforeName !== p.displayName
            ? `<div class="arrangement__rename">renamed from <span class="arrangement__rename-from">${escapeHtml(beforeName)}</span></div>`
            : "";
          return (
            `<div class="arrangement__row" data-row-state="${rowState}" style="--pitch-color: ${rowColor}">` +
              `<div class="arrangement__row-head">` +
                `<span class="arrangement__row-title">` +
                  `<span class="arrangement__row-swatch" aria-hidden="true"></span>` +
                  `${escapeHtml(p.displayName || "Untitled pitch")}` +
                `</span>` +
                `<span class="arrangement__row-count">${p.robustness} / ${totalHeadings}</span>` +
              `</div>` +
              `<p class="arrangement__row-summary">${escapeHtml(summaryText)}</p>` +
              renameHtml +
              `<div class="arrangement__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${fillPct}">` +
                `<div class="arrangement__bar-fill" style="width: ${fillPct}%"></div>` +
              `</div>` +
              chipHtml +
            `</div>`
          );
        }).join("");

    // Skeleton stand-in while the arrangement is still settling — three
    // neutral shimmer rows so the space reads as "considering your
    // pitches" without revealing (or prematurely committing to) any.
    const skeletonHtml = (phase === "reconsidering" || phase === "settling")
      ? `<div class="arrangement__rows" aria-hidden="true">` +
          [0, 1, 2].map(() =>
            `<div class="arrangement__skeleton">` +
              `<div class="arrangement__skeleton-line"></div>` +
              `<div class="arrangement__skeleton-bar"></div>` +
            `</div>`
          ).join("") +
        `</div>`
      : "";

    // Dissolved pitches: any id that was in titlesBefore but isn't in
    // the current pitch list. Surfaced as a quiet block so the founder
    // sees that the organize round can also END a pitch line.
    const currentIds = new Set(allPitches.map((p) => p.id));
    const dissolvedIds = Object.keys(arrangementState.titlesBefore || {})
      .filter((id) => !currentIds.has(id));
    const dissolvedHtml = phase === "locked" && dissolvedIds.length > 0
      ? `<div class="arrangement__dissolved">` +
          dissolvedIds.map((id) => {
            const name = arrangementState.titlesBefore[id];
            return `<div class="arrangement__dissolved-row">` +
              `<span class="arrangement__dissolved-label">Dissolved</span>` +
              `<span class="arrangement__dissolved-name">${escapeHtml(name || "Untitled pitch")}</span>` +
            `</div>`;
          }).join("") +
        `</div>`
      : "";

    // Did this essay open a NEW direction? Two cases count: organize
    // minted a brand-new pitch and the essay landed in it, or nothing
    // could slot it at all. Either way the founder asked for this to be
    // called out UP TOP — "you thought it was going into pitch X, but
    // it actually started its own thing" — rather than buried below the
    // rows. Built in the assembled markup below as newDirectionHtml.
    const seededNewPitch = !!(diff && finalPitchId
      && Array.isArray(diff.newPitchIds) && diff.newPitchIds.includes(finalPitchId));
    const unplaced = phase === "locked" && !(finalPlacement && finalPlacement.deckHeading);
    const isNewDirection = phase === "locked" && (seededNewPitch || unplaced);

    let newDirectionHtml = "";
    if (isNewDirection) {
      const newPitch = finalPitchId ? orderedPitches.find((p) => p.id === finalPitchId) : null;
      const newName = newPitch ? newPitch.displayName : null;
      const newColor = (finalPitchId && colorByPitchId.get(finalPitchId)) || pitchColorForIndex(0);
      const placedHeading = finalPlacement && finalPlacement.deckHeading;
      const headingColor = placedHeading ? slideColorFor(placedHeading) : null;

      // "Why it doesn't fit": grounded in real data, not an invented
      // model rationale (the namer only ever returns a one-word title,
      // and this codebase never fabricates prose for the founder). We
      // name the pitches that existed beforehand and point out that
      // none of them were already on this beat.
      const priorNames = Object.keys(arrangementState.titlesBefore || {})
        .filter((id) => id !== finalPitchId)
        .map((id) => arrangementState.titlesBefore[id])
        .filter(Boolean);
      // Additive framing: a new direction is its own thread that stands
      // beside the founder's other pitches — never a miss, an orphan, or
      // a thing none of them "caught." It still stays grounded: we name
      // the pitches that existed beforehand and note they were each on
      // their own ground (true — none was on this beat), rather than
      // inventing a model rationale.
      const outcome = seededNewPitch
        ? "so this one starts a thread of its own beside them."
        : "so this one will gather a thread of its own as you keep writing.";
      let whyText;
      if (priorNames.length === 0) {
        whyText = seededNewPitch
          ? "Your first pitch on this beat — a thread all its own."
          : "A thread all its own — it'll gather its pitch as you keep writing.";
      } else {
        const shown = priorNames.slice(0, 3);
        let list;
        if (shown.length === 1) list = shown[0];
        else if (shown.length === 2) list = `${shown[0]} and ${shown[1]}`;
        else list = `${shown[0]}, ${shown[1]} and ${shown[2]}`;
        const more = priorNames.length - shown.length;
        const tail = more > 0 ? `${list}, and ${more} more` : list;
        whyText = `${tail} are each on their own ground, ${outcome}`;
      }

      const nameHtml = newName
        ? `<h2 class="arrangement__newdir-name">` +
            `<span class="arrangement__newdir-swatch" aria-hidden="true"></span>` +
            escapeHtml(newName) +
          `</h2>`
        : `<h2 class="arrangement__newdir-name">A direction of its own</h2>`;
      const beatHtml = placedHeading
        ? `<p class="arrangement__newdir-beat">Anchored on ` +
            `<span class="arrangement__newdir-heading" style="color: ${headingColor}">${escapeHtml(placedHeading)}</span></p>`
        : "";
      const quoteHtml = phraseText
        ? `<blockquote class="arrangement__newdir-phrase">${escapeHtml(phraseText)}</blockquote>`
        : "";

      newDirectionHtml =
        `<div class="arrangement__newdir" style="--pitch-color: ${newColor}">` +
          `<p class="arrangement__newdir-tag">You found a new direction</p>` +
          nameHtml +
          beatHtml +
          quoteHtml +
          `<p class="arrangement__newdir-why">${escapeHtml(whyText)}</p>` +
        `</div>`;
    }

    // Slot/heading callout for the ordinary case — the essay landed in
    // an existing pitch's slide. The new-direction case is handled up
    // top by newDirectionHtml instead, so we skip it here.
    let slotHtml = "";
    if (phase === "locked" && !isNewDirection) {
      const placedHeading = finalPlacement && finalPlacement.deckHeading;
      if (placedHeading) {
        const slotNum = headings.indexOf(placedHeading) + 1;
        const slotLabel = slotNum > 0 ? `Slide ${slotNum} of ${totalHeadings}` : "Pitch slide";
        slotHtml =
          `<div class="arrangement__slot">` +
            `<div class="arrangement__slot-num">${escapeHtml(slotLabel)}</div>` +
            `<h2 class="arrangement__slot-heading">${escapeHtml(placedHeading)}</h2>` +
            (phraseText ? `<blockquote class="arrangement__phrase">${escapeHtml(phraseText)}</blockquote>` : "") +
          `</div>`;
      }
    }

    // The reveal's one clear door: a single primary action that takes the
    // founder INTO the pitch this essay just strengthened (the locked
    // pitch, or — for a new direction — the brand-new pitch), so they keep
    // building the thread that just grew instead of bouncing to a list.
    //
    // [NEEDS INPUT: action set] The founder hadn't confirmed whether the
    // door replaces "Read it →" or sits beside it. Per the no-dashboard
    // line we ship one primary door + one quiet secondary ("Done") — a
    // single calm choice, never a button bar.
    //
    // Build step 3 / graceful degrade: if the essay couldn't be slotted
    // anywhere there's no pitch to open, so the primary falls back to the
    // existing "Read it →" rather than offering a door that goes nowhere.
    const doorPitchId = finalPitchId;
    let actionsHtml = "";
    if (phase === "locked") {
      const primaryHtml = doorPitchId
        ? `<button type="button" class="writing-action writing-action--primary" data-arrangement-action="open">Open this pitch →</button>`
        : `<button type="button" class="writing-action writing-action--primary" data-arrangement-action="read">Read it →</button>`;
      actionsHtml =
        `<div class="arrangement__actions">` +
          `<button type="button" class="writing-action" data-arrangement-action="done">Done</button>` +
          primaryHtml +
        `</div>`;
    }

    // Subtitle: "<PitchName>. <SlideTitle>", but only once the
    // arrangement is locked. Before that the placement is tentative, so
    // naming a pitch here would just be the flip-flop we're trying to
    // avoid — we hold on the author label until the end.
    const subtitleInner = (phase === "locked" && pitchSubtitleHtmlFor(essay))
      || escapeHtml(essay.author || "you");
    const subtitleHtml = `<p class="arrangement__subtitle">${subtitleInner}</p>`;

    writingFitContent.innerHTML =
      `<div class="arrangement" data-arrangement-phase="${phase}">` +
        `<p class="arrangement__crumb">You created another essay</p>` +
        `<h1 class="arrangement__headline"><span>${escapeHtml(titleText)}</span></h1>` +
        subtitleHtml +
        `<p class="arrangement__phase-line"><span class="arrangement__phase-dot" aria-hidden="true"></span>${escapeHtml(phaseCopy)}</p>` +
        newDirectionHtml +
        skeletonHtml +
        (rowsHtml ? `<div class="arrangement__rows">${rowsHtml}</div>` : "") +
        dissolvedHtml +
        slotHtml +
        actionsHtml +
      `</div>`;

    const doneBtn = writingFitContent.querySelector('[data-arrangement-action="done"]');
    const readBtn = writingFitContent.querySelector('[data-arrangement-action="read"]');
    const openBtn = writingFitContent.querySelector('[data-arrangement-action="open"]');
    if (doneBtn) doneBtn.addEventListener("click", () => showFeed());
    if (readBtn) readBtn.addEventListener("click", () => showRead(essay));
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        // [NEEDS INPUT: door destination] The founder hadn't decided where
        // this lands (option 1: pitch-script view; option 2: make active +
        // home deck; option 3: a new page). Shipping the prompt's
        // recommended default — option 2: make the pitch active and drop
        // the founder home into its slide deck, the best surface for "keep
        // writing into the pitch that just grew." For option 1, swap the
        // body for window.tinkerShowPitchScript(doorPitchId).
        if (doorPitchId && pitches && typeof pitches.setActivePitch === "function") {
          pitches.setActivePitch(doorPitchId);
        }
        showFeed();
      });
    }
  }

  function phaseLabel(phase, classifyResult, organizeError) {
    if (phase === "reconsidering") return "Reconsidering across your pitches…";
    if (phase === "settling") return "Settling — checking with the rest of your deck…";
    if (phase === "error") return "The pitch reader didn't respond. Your essay saved fine.";
    if (phase === "locked") {
      if (organizeError) return "Locked in (the rearrange step didn't finish — sidebar will catch up).";
      if (classifyResult === null) return "Locked in — couldn't slot this one yet.";
      return "Locked in.";
    }
    return "";
  }

  function arrangementChipHtml(essay, classifyResult, phase, isTentative) {
    const titleText = fitTitleFor(essay);
    const chipState = phase === "locked" ? "locked" : (isTentative ? "tentative" : "considering");
    const headingPart = classifyResult && classifyResult.deckHeading
      ? `<span class="arrangement__chip-heading">${escapeHtml(classifyResult.deckHeading)}</span>`
      : "";
    return (
      `<div class="arrangement__chip" data-chip-state="${chipState}">` +
        `<span class="arrangement__chip-title">${escapeHtml(titleText)}</span>` +
        headingPart +
      `</div>`
    );
  }

  function showFounders() {
    if (!foundersView) return;
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    if (pitchScriptView) pitchScriptView.hidden = true;
    foundersView.hidden = false;
    activeId = null;
    readingEssayId = null;
    activeCategoryKey = null;
    activeCategorySeed = null;
    renderSidebar();
    if (window.tinkerFounders && typeof window.tinkerFounders.refresh === "function") {
      window.tinkerFounders.refresh();
    }
  }

  function showPitchScript(pitchId) {
    if (!pitchScriptView) return;
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    if (foundersView) foundersView.hidden = true;
    pitchScriptView.hidden = false;
    activeId = null;
    readingEssayId = null;
    activeCategoryKey = null;
    activeCategorySeed = null;
    renderSidebar();
    if (window.tinkerPitchScript && typeof window.tinkerPitchScript.show === "function") {
      window.tinkerPitchScript.show(pitchId);
    }
  }
  // The pitch-script view's "back" button calls this to return to the
  // home view; exposed on window so pitch-script.js (loaded after
  // renderer.js) can reach it without a circular import.
  window.tinkerShowPitch = () => showFeed();
  window.tinkerShowPitchScript = (pitchId) => showPitchScript(pitchId);

  // The 7-colour rainbow cycle from the sidebar (styles.css:258-264),
  // mirrored here so the same hue follows a given deck heading whether
  // it's surfaced in the sidebar's phrase row or the essay/read view's
  // subtitle. With 11 headings the cycle wraps; that's the same rule
  // the sidebar already uses.
  const SLIDE_COLOR_CYCLE = [
    "var(--logo-pink)",
    "var(--logo-orange)",
    "var(--logo-yellow)",
    "var(--logo-leaf)",
    "var(--logo-sky)",
    "var(--logo-mint)",
    "var(--logo-purple)",
  ];
  function slideColorFor(heading) {
    const headings = (window.tinkerTree && window.tinkerTree.DECK_HEADINGS) || [];
    const i = headings.indexOf(heading);
    if (i < 0) return SLIDE_COLOR_CYCLE[0];
    return SLIDE_COLOR_CYCLE[i % SLIDE_COLOR_CYCLE.length];
  }

  // Per-pitch colour for the arrangement screen. The founder asked to
  // tell their pitches apart at a glance after publishing — so each
  // pitch row gets its own hue (swatch + progress bar) drawn from the
  // same logo palette as the slides. Keyed by the pitch's position in
  // the list rather than a hash of its id, so the first seven pitches
  // are guaranteed distinct colours (a hash could collide). The cycle
  // wraps past seven, same rule the sidebar already uses for slides.
  function pitchColorForIndex(index) {
    const i = Number.isFinite(index) && index >= 0 ? index : 0;
    return SLIDE_COLOR_CYCLE[i % SLIDE_COLOR_CYCLE.length];
  }

  // A one-line "what direction is this pitch taking" summary, built
  // from the deck headings the pitch has actually filled in. Covered
  // headings ARE the direction — a pitch leaning on "The Problem" and
  // "The Product" reads very differently from one built around "The
  // Vision" and "The Ask". Listed in deck order (stable), capped at
  // three names with a "+N more" tail so the row stays compact.
  function pitchDirectionSummary(pitchId) {
    const pitches = window.tinkerPitches;
    // Resolve through pitches.coveredHeadings so the summary lists the
    // exact same headings the "X / 11" count is built from — they can't
    // drift apart.
    const covered = (pitches && typeof pitches.coveredHeadings === "function")
      ? pitches.coveredHeadings(pitchId)
      : [];
    if (!covered || covered.length === 0) return "Still wide open — no slides filled in yet.";
    const shown = covered.slice(0, 3);
    let list;
    if (shown.length === 1) list = shown[0];
    else if (shown.length === 2) list = `${shown[0]} & ${shown[1]}`;
    else list = `${shown[0]}, ${shown[1]} & ${shown[2]}`;
    const more = covered.length - shown.length;
    return more > 0 ? `Leans on ${list} +${more} more` : `Leans on ${list}`;
  }

  // Build the per-essay subtitle: "<PitchName>. <SlideTitle>" where
  // SlideTitle is coloured to match that slide's row in the sidebar.
  // PitchName prefers the founder's personal title; falls back to the
  // AI-generated one. Returns the empty string when the essay isn't
  // slotted anywhere yet (e.g. during the reconsidering phase, or for
  // essays the classifier couldn't place) so callers can decide on a
  // fallback themselves.
  function pitchSubtitleHtmlFor(essay) {
    if (!essay || !window.tinkerPitches) return "";
    const pitches = window.tinkerPitches;
    if (typeof pitches.findPitchForWriting !== "function") return "";
    const placement = pitches.findPitchForWriting(essay.id);
    if (!placement) return "";
    const pitch = typeof pitches.getPitch === "function"
      ? pitches.getPitch(placement.pitchId)
      : null;
    const pitchName = (pitch && (pitch.personalTitle || pitch.aiTitle)) || "Untitled pitch";
    const heading = placement.deckHeading;
    if (!heading) return escapeHtml(pitchName);
    const color = slideColorFor(heading);
    return escapeHtml(pitchName)
      + ` <span class="essay-subtitle__sep" aria-hidden="true">·</span> `
      + `<span class="essay-subtitle__slide" style="color: ${color}">${escapeHtml(heading)}</span>`;
  }

  function fitTitleFor(essay) {
    if (essay.title) return essay.title;
    const body = String(essay.body || "").trim();
    if (!body) return "Untitled";
    const words = body.split(/\s+/);
    const head = words.slice(0, 8).join(" ");
    return words.length > 8 ? `${head}…` : head;
  }

  function renderFeedCard(essay) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "category-feed__card";
    if (essay.kind === "status") card.classList.add("category-feed__card--status");
    const body = paragraphs(essay.body);
    const titleHtml = essay.title
      ? `<h3 class="category-feed__card-title">${escapeHtml(essay.title)}</h3>`
      : "";
    card.innerHTML =
      `<span class="category-feed__card-author">${escapeHtml(essay.author || "you")}</span>` +
      titleHtml +
      (body ? `<div class="category-feed__card-body">${body}</div>` : "");
    card.addEventListener("click", () => showRead(essay));
    return card;
  }

  function pickSeedForCategory(feed) {
    if (!feed || !Array.isArray(feed.essays) || feed.essays.length === 0) return null;
    // Essays in the feed are already sorted most-recent first; take
    // the first one carrying a seed.
    for (const essay of feed.essays) {
      if (essay && essay.seed) return essay.seed;
    }
    return null;
  }

  function refreshStatusComposer() {
    if (!statusComposer) return;
    if (!activeCategoryKey) {
      statusComposer.hidden = true;
      return;
    }
    statusComposer.hidden = false;
    const saved = getStatusDraft(activeCategoryKey, activeCategorySeed);
    if (statusComposerInput) {
      statusComposerInput.value = saved ? saved.body : "";
      statusComposerInput.placeholder = activeCategorySeed
        ? `Post a quick thought in ${activeCategorySeed}…`
        : "What's on your mind?";
    }
    if (statusComposerPost) {
      statusComposerPost.disabled = !(saved && saved.body.trim().length > 0);
    }
    if (statusComposerHint) {
      statusComposerHint.textContent = saved ? "Draft restored" : "";
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────
  // Sidebar's drafts+essays list is gone — the v0.103 pitch-deck tree
  // owns the sidebar surface between brand and Account (see
  // sidebar-tree.js). renderSidebar/renderHome are kept as no-ops so
  // existing call sites compile.
  function renderSidebar() {
    if (!sessionsEl) return;
    sessionsEl.innerHTML = "";
  }

  function renderHome() {
    // The v0.103 sidebar drops the heatmap-rendered home list; the
    // mount node is gone from the DOM and this becomes a no-op.
    if (!homeListEl) return;
    if (window.tinkerHeatmap && typeof window.tinkerHeatmap.render === "function") {
      window.tinkerHeatmap.render(homeListEl);
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function paragraphs(body) {
    return String(body || "")
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
      .filter((p) => p !== "<p></p>")
      .join("");
  }
  function relTime(ts) {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // ── Wire up ─────────────────────────────────────────────────────────
  navHome.addEventListener("click", () => showFeed());

  // Welcome screen: the H1 is the standing line ("Everyone is a
  // founder.") and the question ("Where are you right now?") sits
  // above a 2×2 grid of four locations — Cafe, Home, Work, Somewhere
  // else. The first three drop you straight into a writing session
  // seeded with that location. "Somewhere else" reveals a small input
  // so the founder can specify the place themselves.
  const welcomeGrid = document.getElementById("welcome-grid");
  const welcomeForm = document.getElementById("welcome-form");
  const welcomeInput = document.getElementById("welcome-input");

  function startSessionWith(seed) {
    if (window.tinkerSeeds && typeof window.tinkerSeeds.add === "function") {
      window.tinkerSeeds.add(seed);
    }
    if (typeof window.tinkerNewSession === "function") {
      window.tinkerNewSession({ seed });
    }
  }

  const LOCATION_LABELS = { cafe: "Cafe", home: "Home", work: "Work" };

  if (welcomeGrid) {
    welcomeGrid.addEventListener("click", (e) => {
      const tile = e.target.closest("[data-location]");
      if (!tile) return;
      const key = tile.getAttribute("data-location");
      if (key === "other") {
        if (!welcomeForm || !welcomeInput) return;
        welcomeForm.hidden = false;
        // Highlight the chosen tile so the founder knows why the input
        // appeared, and remember it in case other tiles get aria-pressed.
        for (const t of welcomeGrid.querySelectorAll("[data-location]")) {
          t.setAttribute("aria-pressed", t === tile ? "true" : "false");
        }
        setTimeout(() => { welcomeInput.focus(); welcomeInput.select(); }, 30);
        return;
      }
      const label = LOCATION_LABELS[key];
      if (!label) return;
      if (welcomeForm) welcomeForm.hidden = true;
      if (welcomeInput) welcomeInput.value = "";
      startSessionWith(label);
    });
  }

  if (welcomeForm && welcomeInput) {
    welcomeForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = welcomeInput.value.trim();
      if (!name) { welcomeInput.focus(); return; }
      welcomeInput.value = "";
      welcomeForm.hidden = true;
      startSessionWith(name);
    });
  }

  // Re-render the home list whenever seeds change.
  if (window.tinkerSeeds && typeof window.tinkerSeeds.subscribe === "function") {
    window.tinkerSeeds.subscribe(() => {
      renderHome();
    });
  }

  if (readMenuTrigger && readMenuPop) {
    const setMenuOpen = (open) => {
      readMenuPop.hidden = !open;
      readMenuTrigger.setAttribute("aria-expanded", open ? "true" : "false");
    };
    readMenuTrigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setMenuOpen(readMenuPop.hidden);
    });
    readMenuPop.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      e.stopPropagation();
      const action = btn.getAttribute("data-action");
      setMenuOpen(false);
      if (!readingEssayId) return;
      const essay = essays.find((es) => es.id === readingEssayId);
      if (!essay) return;
      if (action === "archive") {
        store.archiveEssay(essay.id);
      } else if (action === "delete") {
        const label = essay.title
          || (essay.body ? essay.body.trim().slice(0, 48).replace(/\s+/g, " ") + (essay.body.length > 48 ? "…" : "") : "Untitled");
        if (confirm(`Delete "${label}"? This can't be undone.`)) {
          store.deleteEssay(essay.id);
        }
      }
    });
    document.addEventListener("click", (e) => {
      if (readMenuPop.hidden) return;
      if (readMenuTrigger.contains(e.target)) return;
      if (readMenuPop.contains(e.target)) return;
      setMenuOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !readMenuPop.hidden) setMenuOpen(false);
    });
    // Expose so view-switchers (showFeed, showRead) can collapse the
    // popup when the read view is replaced or rerendered.
    window.tinkerCloseReadMenu = () => setMenuOpen(false);
  }

  // Tell writing.js how to ask the renderer to do things.
  window.tinkerOnWritingClose = () => closeActiveDraft();
  window.tinkerOnWritingPublish = (draft, stitched) => store.publish(draft, stitched);
  window.tinkerOnDraftChange = (draftId, patch) => store.updateDraft(draftId, patch);

  // Used by the seed list in the sidebar: open a fresh draft
  // pre-filled with scene context so the founder jumps straight into
  // mood-tuned reflection.
  window.tinkerNewSession = (preset) => newDraft({ activate: true, preset: preset || null });

  // Used by the seed list when a card already carries a published
  // essay or an in-progress draft — tap routes to the right surface
  // instead of always spawning a new session.
  window.tinkerOpenEssay = (essayId) => {
    const essay = essays.find((e) => e.id === essayId);
    if (essay) showRead(essay);
  };
  window.tinkerResumeDraft = (draftId) => openDraft(draftId);
  window.tinkerShowCategoryFeed = (categoryKey, originatingSeed) =>
    showCategoryFeed(categoryKey, originatingSeed);

  // Status composer wiring. The textarea enables the Post button once
  // there's non-whitespace input; Cmd/Ctrl+Enter submits without
  // hunting for the button. After posting, re-render the feed so the
  // new card lands at the top.
  if (statusComposer && statusComposerInput && statusComposerPost) {
    let statusDraftTimer = null;
    const updateEnabled = () => {
      statusComposerPost.disabled = statusComposerInput.value.trim().length === 0;
    };
    statusComposerInput.addEventListener("input", () => {
      updateEnabled();
      if (!activeCategoryKey) return;
      // Debounce to avoid hitting localStorage on every keystroke. The
      // hint flashes "Draft saved" so an interrupted founder knows their
      // half-typed thought survived.
      clearTimeout(statusDraftTimer);
      statusDraftTimer = setTimeout(() => {
        setStatusDraft(activeCategoryKey, activeCategorySeed, statusComposerInput.value);
        if (statusComposerHint) {
          statusComposerHint.textContent = statusComposerInput.value.trim()
            ? "Draft saved"
            : "";
        }
      }, 350);
    });
    statusComposerInput.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!statusComposerPost.disabled) statusComposer.requestSubmit();
      }
    });
    statusComposer.addEventListener("submit", (e) => {
      e.preventDefault();
      const body = statusComposerInput.value;
      if (!body.trim() || !activeCategoryKey) return;
      const draftKeyCat = activeCategoryKey;
      const draftKeySeed = activeCategorySeed;
      const essay = store.publishStatus({ body, seed: activeCategorySeed });
      if (!essay) return;
      // Posted — drop the saved draft for this channel so refresh
      // doesn't restore an already-published thought.
      clearTimeout(statusDraftTimer);
      clearStatusDraft(draftKeyCat, draftKeySeed);
      // Stay on this category feed so the founder sees their post
      // land at the top of the channel they just typed into.
      showCategoryFeed(activeCategoryKey, activeCategorySeed);
    });
  }

  // Keyboard shortcuts. Cmd/Ctrl+T = new draft. Cmd/Ctrl+W = close
  // (delete) the current draft. The address-bar shortcut is gone — there
  // is no address bar in v1; [NEEDS INPUT] confirm that's the right call.
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      newDraft();
    } else if (e.key === "w" || e.key === "W") {
      if (!activeId) return;
      e.preventDefault();
      const d = store.getActive();
      if (d && confirm(`Delete "${d.title || "Untitled draft"}"?`)) store.deleteDraft(d.id);
    }
  });

  // Server hydration may have overwritten the drafts + essays storage
  // keys after this module's initial load. Re-read both, then re-render
  // the views that depend on them. An active draft is preserved if its
  // id still exists in the new list; otherwise we drop back to the feed.
  window.addEventListener("tinker:hydrated", () => {
    drafts = loadDrafts();
    essays = loadEssays();
    if (activeId && !drafts.some((d) => d.id === activeId)) {
      activeId = null;
      showFeed();
      return;
    }
    renderSidebar();
    if (readView && !readView.hidden) return;
    if (writingView && !writingView.hidden) return;
    renderHome();
  });

  // ── Boot ────────────────────────────────────────────────────────────
  renderSidebar();
  renderHome();
  showFeed();
})();
