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

  // ── DOM refs ─────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const sessionsEl = $("#sessions"); // legacy mount; null after the sidebar restructure
  const navHome = $("#nav-home");
  const feedView = $("#welcome");
  const writingView = $("#writing");
  const readView = $("#read");
  const readBody = $("#read-body");
  const readDelete = $("#read-delete");
  const categoryFeedView = $("#category-feed");
  const categoryFeedTitle = $("#category-feed-title");
  const categoryFeedSub = $("#category-feed-sub");
  const categoryFeedList = $("#category-feed-list");
  const categoryFeedEmpty = $("#category-feed-empty");
  const statusComposer = $("#status-composer");
  const statusComposerInput = $("#status-composer-input");
  const statusComposerPost = $("#status-composer-post");
  const statusComposerHint = $("#status-composer-hint");

  // Which category feed is currently on screen, and what earth the user
  // tapped to land here. The composer attaches new statuses to that
  // earth so they show up under the channel they were typed into.
  let activeCategoryKey = null;
  let activeCategoryEarth = null;

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
    },
    deleteEssay(id) {
      const essay = essays.find((e) => e.id === id);
      if (!essay) return null;
      essays = essays.filter((e) => e.id !== id);
      saveEssays(essays);
      if (readingEssayId === id) showFeed();
      if (window.tinkerTree && typeof window.tinkerTree.refresh === "function") {
        window.tinkerTree.refresh();
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
        // Carry earth through so the clustering step on session close
        // can group this writing under the right place.
        earth: draft.earth || null,
      };
      essays = [essay, ...essays];
      saveEssays(essays);
      drafts = drafts.filter((d) => d.id !== draft.id);
      saveDrafts(drafts);
      activeId = null;
      renderSidebar();
      // Kick a clustering refresh — the writing session is closing
      // and we want the tree to reflect this new writing.
      if (window.tinkerTree && typeof window.tinkerTree.refresh === "function") {
        window.tinkerTree.refresh();
      }
      // Land on the earth's category feed (now containing the
      // just-published essay). For a brand-new earth with no
      // classification yet, fall through to the read view.
      const leafKey = (window.tinkerHeatmap && typeof window.tinkerHeatmap.getCategoryKeyForSeed === "function")
        ? window.tinkerHeatmap.getCategoryKeyForSeed(essay.earth)
        : null;
      if (!leafKey || !showCategoryFeed(leafKey)) {
        showRead(essay);
      }
      return essay;
    },
    // Short-form post: typed straight into the textarea at the top of
    // a category feed. Skips the interview flow and the stitching/
    // verification logic — the body is exactly what the founder typed.
    // No title; the card and read view render without one. Tied to an
    // earth so clustering keeps it grouped under the same place the
    // founder posted from.
    publishStatus({ body, earth }) {
      const trimmed = String(body || "").trim();
      if (!trimmed) return null;
      const earthName = earth ? String(earth).trim() : null;
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
        earth: earthName || null,
      };
      essays = [essay, ...essays];
      saveEssays(essays);
      // Make sure the earth exists in the explicit list so it has a
      // sidebar row. add() is a no-op if it's already there.
      if (earthName && window.tinkerEarths && typeof window.tinkerEarths.add === "function") {
        window.tinkerEarths.add(earthName);
      }
      if (window.tinkerTree && typeof window.tinkerTree.refresh === "function") {
        window.tinkerTree.refresh();
      }
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
      // checks `active.earth === undefined`, so once we assign
      // a string (or null) the prompt is skipped and the founder
      // jumps straight into the mood-tuned first question.
      if (preset.earth !== undefined) draft.earth = preset.earth || null;
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
    feedView.setAttribute("data-active", "");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    activeId = null;
    readingEssayId = null;
    activeCategoryKey = null;
    activeCategoryEarth = null;
    renderSidebar();
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
  }
  function showRead(essay) {
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = false;
    if (categoryFeedView) categoryFeedView.hidden = true;
    activeId = null;
    readingEssayId = essay.id;
    renderSidebar();
    const titleHtml = essay.title
      ? `<h1 class="read__title">${escapeHtml(essay.title)}</h1>`
      : "";
    readBody.innerHTML =
      `<header class="read__head">` +
        `<div class="read__author">${escapeHtml(essay.author)}</div>` +
        titleHtml +
      `</header>` +
      paragraphs(essay.body);
  }
  function showCategoryFeed(categoryKey, originatingEarth) {
    if (!categoryFeedView) return false;
    const feed = (window.tinkerHeatmap && typeof window.tinkerHeatmap.getCategoryFeed === "function")
      ? window.tinkerHeatmap.getCategoryFeed(categoryKey)
      : null;
    if (!feed) return false;

    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = true;
    categoryFeedView.hidden = false;
    activeId = null;
    activeCategoryKey = categoryKey;
    // Prefer the earth the user just tapped. Fall back to the most-
    // recently-touched earth in this category so the composer still
    // has somewhere to attach a status (e.g. when the feed is opened
    // by routing after publish, with no clicked row in hand).
    activeCategoryEarth = originatingEarth || pickEarthForCategory(feed) || null;
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

  function pickEarthForCategory(feed) {
    if (!feed || !Array.isArray(feed.essays) || feed.essays.length === 0) return null;
    // Essays in the feed are already sorted most-recent first; take
    // the first one carrying an earth.
    for (const essay of feed.essays) {
      if (essay && essay.earth) return essay.earth;
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
    if (statusComposerInput) {
      statusComposerInput.value = "";
      statusComposerInput.placeholder = activeCategoryEarth
        ? `Post a quick thought in ${activeCategoryEarth}…`
        : "What's on your mind?";
    }
    if (statusComposerPost) statusComposerPost.disabled = true;
    if (statusComposerHint) statusComposerHint.textContent = "";
  }

  // ── Rendering ───────────────────────────────────────────────────────
  // The drafts+essays sidebar list is gone — the three-tier tree
  // owned by tree.js renders into #sidebar-tree instead. This helper
  // stays as a no-op so existing call sites compile.
  function renderSidebar() {
    if (!sessionsEl) return;
    sessionsEl.innerHTML = "";
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
  // above a 2×2 grid of four earths — Cafe, Home, Work, Somewhere
  // else. The first three drop you straight into a writing session
  // pinned to that earth. "Somewhere else" reveals a small input
  // so the founder can specify the place themselves.
  const welcomeGrid = document.getElementById("welcome-grid");
  const welcomeForm = document.getElementById("welcome-form");
  const welcomeInput = document.getElementById("welcome-input");

  function startSessionWith(earth) {
    if (window.tinkerEarths && typeof window.tinkerEarths.add === "function") {
      window.tinkerEarths.add(earth);
    }
    if (typeof window.tinkerNewSession === "function") {
      window.tinkerNewSession({ earth });
    }
  }

  const EARTH_LABELS = { cafe: "Cafe", home: "Home", work: "Work" };

  if (welcomeGrid) {
    welcomeGrid.addEventListener("click", (e) => {
      const tile = e.target.closest("[data-earth]");
      if (!tile) return;
      const key = tile.getAttribute("data-earth");
      if (key === "other") {
        if (!welcomeForm || !welcomeInput) return;
        welcomeForm.hidden = false;
        // Highlight the chosen tile so the founder knows why the input
        // appeared, and remember it in case other tiles get aria-pressed.
        for (const t of welcomeGrid.querySelectorAll("[data-earth]")) {
          t.setAttribute("aria-pressed", t === tile ? "true" : "false");
        }
        setTimeout(() => { welcomeInput.focus(); welcomeInput.select(); }, 30);
        return;
      }
      const label = EARTH_LABELS[key];
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

  // Re-render the sidebar tree whenever the earth set changes (add /
  // remove via the welcome grid or the add modal). Clustering doesn't
  // rerun on a pure add — the tree just hides Earths with no Seeds —
  // but a remove that drops the last writing from an Earth would
  // leave a phantom row until the next refresh, so we kick one.
  if (window.tinkerEarths && typeof window.tinkerEarths.subscribe === "function") {
    window.tinkerEarths.subscribe(() => {
      if (window.tinkerTree && typeof window.tinkerTree.refresh === "function") {
        window.tinkerTree.refresh();
      }
    });
  }

  if (readDelete) {
    readDelete.addEventListener("click", () => {
      if (!readingEssayId) return;
      const essay = essays.find((e) => e.id === readingEssayId);
      if (!essay) return;
      const label = essay.title
        || (essay.body ? essay.body.trim().slice(0, 48).replace(/\s+/g, " ") + (essay.body.length > 48 ? "…" : "") : "Untitled");
      if (confirm(`Delete "${label}"? This can't be undone.`)) {
        store.deleteEssay(essay.id);
      }
    });
  }

  // Tell writing.js how to ask the renderer to do things.
  window.tinkerOnWritingClose = () => closeActiveDraft();
  window.tinkerOnWritingPublish = (draft, stitched) => store.publish(draft, stitched);
  window.tinkerOnDraftChange = (draftId, patch) => store.updateDraft(draftId, patch);

  // Used by the sidebar tree: open a fresh draft pre-filled with scene
  // context so the founder jumps straight into mood-tuned reflection.
  window.tinkerNewSession = (preset) => newDraft({ activate: true, preset: preset || null });

  // Used by the tree's growth-vector rows: tap routes to the
  // underlying writing instead of always spawning a new session.
  window.tinkerOpenEssay = (essayId) => {
    const essay = essays.find((e) => e.id === essayId);
    if (essay) showRead(essay);
  };
  window.tinkerResumeDraft = (draftId) => openDraft(draftId);
  window.tinkerShowCategoryFeed = (categoryKey, originatingEarth) =>
    showCategoryFeed(categoryKey, originatingEarth);

  // Status composer wiring. The textarea enables the Post button once
  // there's non-whitespace input; Cmd/Ctrl+Enter submits without
  // hunting for the button. After posting, re-render the feed so the
  // new card lands at the top.
  if (statusComposer && statusComposerInput && statusComposerPost) {
    const updateEnabled = () => {
      statusComposerPost.disabled = statusComposerInput.value.trim().length === 0;
    };
    statusComposerInput.addEventListener("input", updateEnabled);
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
      const essay = store.publishStatus({ body, earth: activeCategoryEarth });
      if (!essay) return;
      // Stay on this category feed so the founder sees their post
      // land at the top of the channel they just typed into.
      showCategoryFeed(activeCategoryKey, activeCategoryEarth);
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
  });

  // ── Boot ────────────────────────────────────────────────────────────
  renderSidebar();
  showFeed();
})();
