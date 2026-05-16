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
  const homeListEl = $("#home-list");
  const readBody = $("#read-body");
  const readDelete = $("#read-delete");
  const categoryFeedView = $("#category-feed");
  const categoryFeedTitle = $("#category-feed-title");
  const categoryFeedSub = $("#category-feed-sub");
  const categoryFeedList = $("#category-feed-list");
  const categoryFeedEmpty = $("#category-feed-empty");

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
      renderHome();
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
      // Land on the seed's category feed (now containing the
      // just-published essay). For a brand-new seed with no
      // classification yet, fall through to the read view.
      const leafKey = (window.tinkerHeatmap && typeof window.tinkerHeatmap.getCategoryKeyForSeed === "function")
        ? window.tinkerHeatmap.getCategoryKeyForSeed(essay.seed)
        : null;
      if (!leafKey || !showCategoryFeed(leafKey)) {
        showRead(essay);
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
    setSidebarActive({ seedName: draft.seed || null });
    if (window.tinkerWriting) window.tinkerWriting.open(draft);
  }

  function closeActiveDraft() {
    activeId = null;
    renderSidebar();
    showFeed();
  }

  // Push the "where am I" signal into the sidebar so the active seed
  // card and its enclosing channel get highlighted. Safe no-op until
  // heatmap.js loads.
  function setSidebarActive(target) {
    if (window.tinkerHeatmap && typeof window.tinkerHeatmap.setActive === "function") {
      window.tinkerHeatmap.setActive(target);
    }
  }

  // ── Views ───────────────────────────────────────────────────────────
  function showFeed() {
    feedView.setAttribute("data-active", "");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    activeId = null;
    readingEssayId = null;
    renderSidebar();
    renderHome();
    setSidebarActive(null);
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
    setSidebarActive({ seedName: essay.seed || null });
    readBody.innerHTML =
      `<header class="read__head">` +
        `<div class="read__author">${escapeHtml(essay.author)}</div>` +
        `<h1 class="read__title">${escapeHtml(essay.title)}</h1>` +
      `</header>` +
      paragraphs(essay.body);
  }
  function showCategoryFeed(categoryKey) {
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
    renderSidebar();
    setSidebarActive({ categoryKey });

    categoryFeedTitle.textContent = feed.name;
    if (feed.description) {
      categoryFeedSub.textContent = feed.description;
      categoryFeedSub.hidden = false;
    } else {
      categoryFeedSub.textContent = "";
      categoryFeedSub.hidden = true;
    }

    categoryFeedList.innerHTML = "";
    if (!feed.essays.length) {
      categoryFeedEmpty.hidden = false;
      return true;
    }
    categoryFeedEmpty.hidden = true;
    for (const essay of feed.essays) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "category-feed__card";
      const body = paragraphs(essay.body);
      card.innerHTML =
        `<span class="category-feed__card-author">${escapeHtml(essay.author || "you")}</span>` +
        `<h3 class="category-feed__card-title">${escapeHtml(essay.title || "Untitled")}</h3>` +
        (body ? `<div class="category-feed__card-body">${body}</div>` : "");
      card.addEventListener("click", () => showRead(essay));
      categoryFeedList.appendChild(card);
    }
    return true;
  }

  // ── Rendering ───────────────────────────────────────────────────────
  // Sidebar's drafts+essays list is gone — seeds now own the sidebar
  // (see #home-list). Each seed card surfaces the latest writing
  // produced there. Kept as a no-op so existing call sites compile.
  function renderSidebar() {
    if (!sessionsEl) return;
    sessionsEl.innerHTML = "";
  }

  function renderHome() {
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

  if (readDelete) {
    readDelete.addEventListener("click", () => {
      if (!readingEssayId) return;
      const essay = essays.find((e) => e.id === readingEssayId);
      if (!essay) return;
      if (confirm(`Delete "${essay.title || "Untitled"}"? This can't be undone.`)) {
        store.deleteEssay(essay.id);
      }
    });
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
  window.tinkerShowCategoryFeed = (categoryKey) => showCategoryFeed(categoryKey);

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
