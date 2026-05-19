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
  const readDelete = $("#read-delete");
  const categoryFeedView = $("#category-feed");
  const categoryFeedTitle = $("#category-feed-title");
  const categoryFeedSub = $("#category-feed-sub");
  const categoryFeedList = $("#category-feed-list");
  const categoryFeedEmpty = $("#category-feed-empty");
  const writingFitView = $("#writing-fit");
  const writingFitContent = $("#writing-fit-content");
  const linkedinFitView = $("#linkedin-fit");
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
      // classifier to place the essay under one of the eight deck
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
      // eight-slide starter pitch — or that it doesn't fit yet. The
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
    feedView.setAttribute("data-active", "");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    if (linkedinFitView) linkedinFitView.hidden = true;
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
    if (linkedinFitView) linkedinFitView.hidden = true;
  }
  function showRead(essay) {
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = false;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    if (linkedinFitView) linkedinFitView.hidden = true;
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
    if (linkedinFitView) linkedinFitView.hidden = true;
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

  // Post-publish fit screen. Shows which of the eight starter-pitch
  // slides this essay slots under (lifted verbatim phrase included) or
  // — when the classifier returns nothing — flags it as a new direction
  // the deck hasn't named yet. The classifier call has already been
  // kicked off by the tinker:writing-saved dispatch in publish(); the
  // sidebar-tree's inflight dedupe means our classify() call here just
  // attaches to that same promise.
  function showWritingFit(essay) {
    if (!writingFitView || !writingFitContent) {
      // Fallback to read view if the fit surface didn't mount for any
      // reason (older cached HTML, audit harness, etc).
      showRead(essay);
      return;
    }
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    writingFitView.hidden = false;
    if (linkedinFitView) linkedinFitView.hidden = true;
    activeId = null;
    readingEssayId = null;
    activeCategoryKey = null;
    activeCategorySeed = null;
    renderSidebar();

    renderWritingFitLoading();

    const tree = window.tinkerTree;
    if (tree && typeof tree.classify === "function") {
      Promise.resolve()
        .then(() => tree.classify(essay.id, { fresh: true }))
        .then((result) => renderWritingFitResult(essay, result))
        .catch(() => renderWritingFitResult(essay, null));
    } else {
      renderWritingFitResult(essay, null);
    }
  }

  function renderWritingFitLoading() {
    writingFitContent.innerHTML =
      `<p class="writing-fit__crumb">You just published</p>` +
      `<div class="writing-fit__loading">` +
        `<div class="thinking-dots" aria-hidden="true">` +
          `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>` +
        `</div>` +
        `<div class="writing-fit__loading-text">Seeing where this fits in your pitch…</div>` +
      `</div>`;
  }

  function renderWritingFitResult(essay, result) {
    const headings = (window.tinkerTree && window.tinkerTree.DECK_HEADINGS) || [];
    const totalSlots = headings.length || 8;
    const titleText = fitTitleFor(essay);

    // `null` from classify means the call couldn't run (network, no
    // token, parse error). The model deciding "no slide fits" comes
    // back as { deckHeading: null }. Distinguishing the two so we
    // don't tell the founder their writing missed the deck when the
    // classifier never actually weighed in.
    let slotHtml;
    let leadHtml = "";
    if (result === null || result === undefined) {
      slotHtml =
        `<div class="writing-fit__slot writing-fit__slot--miss">` +
          `<div class="writing-fit__slot-num">Hold tight</div>` +
          `<h2 class="writing-fit__slot-heading">Couldn't see where this fits right now.</h2>` +
          `<p class="writing-fit__sub">The pitch reader didn't respond. Your essay saved fine — open it below, or come back and the sidebar will catch up.</p>` +
        `</div>`;
    } else if (result.deckHeading) {
      const heading = result.deckHeading;
      const phrase = result.phrase;
      let phraseText = "";
      if (phrase && essay.body
          && Number.isFinite(phrase.offset) && Number.isFinite(phrase.length)
          && phrase.offset >= 0 && phrase.offset + phrase.length <= essay.body.length) {
        phraseText = String(essay.body).slice(phrase.offset, phrase.offset + phrase.length);
      }
      const slotNum = headings.indexOf(heading) + 1;
      const slotLabel = slotNum > 0 ? `Slide ${slotNum} of ${totalSlots}` : "Pitch slide";
      slotHtml =
        `<div class="writing-fit__slot">` +
          `<div class="writing-fit__slot-num">${escapeHtml(slotLabel)}</div>` +
          `<h2 class="writing-fit__slot-heading">${escapeHtml(heading)}</h2>` +
          (phraseText ? `<blockquote class="writing-fit__phrase">${escapeHtml(phraseText)}</blockquote>` : "") +
        `</div>`;
      leadHtml = `<p class="writing-fit__sub">It lands in your starter pitch here:</p>`;
    } else {
      slotHtml =
        `<div class="writing-fit__slot writing-fit__slot--miss">` +
          `<div class="writing-fit__slot-num">Off the deck</div>` +
          `<h2 class="writing-fit__slot-heading">Doesn't fit your starter pitch — yet.</h2>` +
          `<p class="writing-fit__sub">None of your eight slides quite hold this one. That's how a new beat usually shows up first.</p>` +
        `</div>`;
    }

    writingFitContent.innerHTML =
      `<p class="writing-fit__crumb">You just published</p>` +
      `<h1 class="writing-fit__headline">${escapeHtml(titleText)}</h1>` +
      leadHtml +
      slotHtml +
      `<div class="writing-fit__actions">` +
        `<button type="button" class="writing-action" data-fit-action="done">Done</button>` +
        `<button type="button" class="writing-action writing-action--primary" data-fit-action="read">Read it →</button>` +
      `</div>`;

    const doneBtn = writingFitContent.querySelector('[data-fit-action="done"]');
    const readBtn = writingFitContent.querySelector('[data-fit-action="read"]');
    if (doneBtn) doneBtn.addEventListener("click", () => showFeed());
    if (readBtn) readBtn.addEventListener("click", () => showRead(essay));
  }

  function showLinkedinFits() {
    if (!linkedinFitView) return;
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    linkedinFitView.hidden = false;
    activeId = null;
    readingEssayId = null;
    activeCategoryKey = null;
    activeCategorySeed = null;
    renderSidebar();
    if (window.tinkerLinkedinFit && typeof window.tinkerLinkedinFit.render === "function") {
      window.tinkerLinkedinFit.render();
    }
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

  const navLinkedin = $("#nav-linkedin");
  if (navLinkedin) navLinkedin.addEventListener("click", () => showLinkedinFits());

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
