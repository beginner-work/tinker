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
  const storyView = $("#story");
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
    },
    deleteEssay(id) {
      const essay = essays.find((e) => e.id === id);
      if (!essay) return null;
      essays = essays.filter((e) => e.id !== id);
      saveEssays(essays);
      if (readingEssayId === id) showFeed();
      renderHome();
      renderSidebar();
      return essay;
    },
    // The one-shot category tag (see story.js' classifier client).
    // Stored on the essay so it syncs with the essays blob; null means
    // "looked at it, fits nothing". Owned here so the in-memory essays
    // array and localStorage never diverge.
    setEssaySlide(id, slide) {
      const essay = essays.find((e) => e.id === id);
      if (!essay) return null;
      essay.slide = typeof slide === "string" && slide ? slide : null;
      essay.slideCheckedAt = Date.now();
      saveEssays(essays);
      return essay;
    },
    // Soft-hide: keeps the essay in the founder's blob (still synced
    // by PUT /api/user-data/essays) but excluded from category feeds
    // and from the story. The founder can ask for an archived view
    // later — for now, archive is "out of sight, not gone".
    archiveEssay(id) {
      const essay = essays.find((e) => e.id === id);
      if (!essay) return null;
      if (essay.archived) return essay;
      essay.archived = true;
      saveEssays(essays);
      if (readingEssayId === id) showFeed();
      renderHome();
      renderSidebar();
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
      // The writing-saved event keeps the voice model training on the
      // founder's published words; the story sidebar listens too.
      try {
        window.dispatchEvent(new CustomEvent("tinker:writing-saved", {
          detail: { writingId: essay.id },
        }));
      } catch { /* ignore */ }
      // No assessment, no placement, no waiting: the essay is part of
      // the story the moment it exists. Say exactly that.
      showStoryAdded(essay);
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
    // Free write mode: the founder wrote freely and pressed "This is
    // everything" with no connection. Save the essay to local storage
    // now — kind "essay", like any other; it's part of the story
    // immediately. The pendingPitch flag (legacy field name, kept so
    // older synced data round-trips) just marks it for the back-online
    // notice + sync flush in flushDeferredEssays(). No Claude call, no
    // stitching: the body is exactly what they typed.
    publishDeferred(draft, { body } = {}) {
      const text = String(body || "").trim();
      if (!text || !draft) return null;
      const title = firstLine(text);
      const slug = slugify(title || "untitled") + "-" + draft.id.slice(2, 6);
      const essay = {
        id: "e_" + Math.random().toString(36).slice(2, 10),
        slug,
        author: "you",
        title: title || "Untitled",
        body: text,
        createdAt: Date.now(),
        url: `/you/${slug}`,
        sourceDraft: draft.id,
        kind: "essay",
        seed: draft.seed || null,
        pendingPitch: true,
      };
      essays = [essay, ...essays];
      saveEssays(essays);
      drafts = drafts.filter((d) => d.id !== draft.id);
      saveDrafts(drafts);
      activeId = null;
      renderSidebar();
      renderHome();
      // Online already? Flush now. Offline? It waits for reconnect.
      flushDeferredEssays();
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

  // First line of a free-write, trimmed to a sane title length. Used to
  // label free-write essays that never went through the interview's
  // title step.
  function firstLine(text) {
    const line = String(text || "").trim().split("\n")[0].trim();
    if (line.length <= 72) return line;
    return line.slice(0, 71).trimEnd() + "…";
  }

  // Essays saved in free write mode become part of the story the moment
  // they're written; this just clears their offline flag once we're back
  // online (so the sync layer pushes them) and raises the back-online
  // notice. No-op while free write mode is on (the network is gated) or
  // when nothing is waiting.
  function flushDeferredEssays() {
    if (window.tinkerFreewrite && window.tinkerFreewrite.isOn()) return;
    const pending = essays.filter((e) => e && e.pendingPitch);
    if (!pending.length) return;
    for (const essay of pending) delete essay.pendingPitch;
    saveEssays(essays);
    for (const essay of pending) {
      try {
        window.dispatchEvent(new CustomEvent("tinker:writing-saved", {
          detail: { writingId: essay.id },
        }));
      } catch { /* ignore */ }
      emitOfflineEssayNotification(essay);
    }
  }

  // A free-write essay written with no connection has just synced now
  // that we're back online. Reuse the notification component for a
  // sticky, cross-device notice so the founder knows it made it out —
  // it stays until they acknowledge it, on whichever device they next
  // open. The id is keyed to the essay so the same notice never lands
  // twice (e.g. when another device flushed it first and it arrives
  // over sync).
  function emitOfflineEssayNotification(essay) {
    if (!essay) return;
    const titleText = essay.title || "Your essay";
    const payload = {
      id: "offline_" + (essay.id || Date.now().toString(36)),
      kind: "offline-essay",
      sticky: true,
      title: "Back online",
      body: `“${titleText}” — written offline — is now part of your story.`,
      essayId: essay.id || null,
    };
    const send = () => {
      if (typeof window.tinkerNotify === "function") window.tinkerNotify(payload);
      else {
        try { window.dispatchEvent(new CustomEvent("tinker:notify", { detail: payload })); }
        catch { /* ignore */ }
      }
    };
    // notifications.js loads after this module, so a synchronous boot-time
    // flush can land before it's ready — defer to the next tick in that
    // case so neither the call nor the event fallback is dropped.
    if (typeof window.tinkerNotify === "function") send();
    else setTimeout(send, 0);
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
    // Starting another write after the first essay → ask for their profile now
    // (the overlay sits over the fresh draft). shouldPromptProfile() requires
    // ≥1 saved essay, so a founder's very first session is never interrupted.
    if (activate) maybePromptProfile();
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

  // ── Deferred profile capture ────────────────────────────────────────
  // Founders try the product before we ask for their details: two early
  // testers bounced when handed a profile form up front. So profile.js parks
  // the capture, and we only prompt it once they've saved their first essay —
  // and then only at a transition (returning home, starting another write, or
  // reopening the app), never mid-essay.
  function shouldPromptProfile() {
    const p = window.tinkerProfile;
    return !!(
      p &&
      typeof p.needsOnboarding === "function" &&
      p.needsOnboarding() &&
      essays.length >= 1
    );
  }
  function maybePromptProfile() {
    if (shouldPromptProfile()) window.tinkerProfile.runOnboarding();
  }
  // Covers "reopen the app after the first essay": on a fresh load the boot
  // showFeed() runs before profile.js has resolved the (async) profile lookup,
  // so we re-check when it announces a missing profile.
  window.addEventListener("tinker:profile-needed", maybePromptProfile);

  // ── Views ───────────────────────────────────────────────────────────
  function showFeed() {
    if (typeof window.tinkerCloseReadMenu === "function") window.tinkerCloseReadMenu();
    feedView.setAttribute("data-active", "");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    if (storyView) storyView.hidden = true;
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
    // Back home after the first essay → now ask for their profile.
    maybePromptProfile();
  }
  function showWriting() {
    feedView.removeAttribute("data-active");
    writingView.hidden = false;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    if (storyView) storyView.hidden = true;
  }
  function showRead(essay) {
    if (typeof window.tinkerCloseReadMenu === "function") window.tinkerCloseReadMenu();
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = false;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    if (storyView) storyView.hidden = true;
    activeId = null;
    readingEssayId = essay.id;
    renderSidebar();
    readBody.innerHTML = readBookHtml(essay);
  }
  // The whole story, verbatim, in one place — rendered by story.js into
  // #story. `anchorEssayId` scrolls a particular piece into view (the
  // sidebar's story rows pass it).
  function showStory(anchorEssayId) {
    if (!storyView) return;
    if (typeof window.tinkerCloseReadMenu === "function") window.tinkerCloseReadMenu();
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    if (writingFitView) writingFitView.hidden = true;
    storyView.hidden = false;
    activeId = null;
    readingEssayId = null;
    activeCategoryKey = null;
    activeCategorySeed = null;
    renderSidebar();
    if (window.tinkerStory && typeof window.tinkerStory.renderView === "function") {
      window.tinkerStory.renderView(anchorEssayId || null);
    }
  }
  window.tinkerShowStory = (anchorEssayId) => showStory(anchorEssayId);
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
    if (storyView) storyView.hidden = true;
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

  // ── Post-publish flow ────────────────────────────────────────────
  //
  // There is no assessment and no placement anymore: the essay is part
  // of the story the moment it exists. The confirmation says exactly
  // that and offers the two true next steps — read the story, or keep
  // writing.
  function showStoryAdded(essay) {
    if (!writingFitView || !writingFitContent) {
      showFeed();
      return;
    }
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = true;
    if (categoryFeedView) categoryFeedView.hidden = true;
    writingFitView.hidden = false;
    if (storyView) storyView.hidden = true;
    activeId = null;
    readingEssayId = null;
    activeCategoryKey = null;
    activeCategorySeed = null;
    renderSidebar();

    const titleText = essay.title || "your writing";
    writingFitContent.innerHTML =
      `<div class="assessing">` +
        `<div class="assessing__mark" aria-hidden="true"><span class="assessing__pulse"></span></div>` +
        `<p class="assessing__crumb">You wrote another piece</p>` +
        `<h1 class="assessing__headline">It's part of your story.</h1>` +
        `<p class="assessing__sub"><span class="assessing__title">${escapeHtml(titleText)}</span> ` +
          `is in, word for word. Read the whole story, or keep writing.</p>` +
        `<div class="assessing__actions">` +
          `<button type="button" class="assessing__read" data-assessing-action="story">Read your story</button>` +
          `<button type="button" class="assessing__keep" data-assessing-action="keep">Keep writing →</button>` +
        `</div>` +
      `</div>`;

    const keepBtn = writingFitContent.querySelector('[data-assessing-action="keep"]');
    const storyBtn = writingFitContent.querySelector('[data-assessing-action="story"]');
    if (keepBtn) keepBtn.addEventListener("click", () => showFeed());
    if (storyBtn) storyBtn.addEventListener("click", () => showStory(essay.id));
  }

  // Resolve a writingId — an essay id, or a not-yet-published draft id —
  // to a readable { id, title, body, author }. The book spread shows
  // the *next* piece of the story; we look in both stores so an id
  // that's still a draft resolves too.
  function readableForWritingId(id) {
    if (!id) return null;
    const essay = essays.find((e) => e && e.id === id);
    if (essay) return essay;
    const draft = drafts.find((d) => d && d.id === id);
    if (!draft) return null;
    return {
      id: draft.id,
      author: "you",
      title: (draft.stitched && draft.stitched.title) || draft.title || null,
      body: bodyForDraft(draft),
      kind: "draft",
    };
  }

  function bodyForDraft(draft) {
    if (draft && draft.stitched && draft.stitched.body) return String(draft.stitched.body);
    const turns = draft && Array.isArray(draft.transcript) ? draft.transcript : [];
    return turns.map((t) => String((t && t.a) || "").trim()).filter(Boolean).join("\n\n");
  }

  // One page of the read view: subtitle + title + body wrapped in an
  // <article class="read__page">. The subtitle is the piece's place in
  // the story ("part N of M · 3d") when it has one, else the author.
  function readPageHtml(essay, subtitleText, extraClass) {
    const subtitle = subtitleText || essay.author || "you";
    // Title wraps the text in an inner span so the mobile floating
    // title bar can centre with text-overflow: ellipsis — both
    // properties only behave when applied to a sized child, not to a
    // flex container directly.
    const titleHtml = essay.title
      ? `<h1 class="read__title"><span>${escapeHtml(essay.title)}</span></h1>`
      : "";
    return `<article class="read__page${extraClass ? " " + extraClass : ""}">` +
      `<header class="read__head">` +
        `<div class="read__author">${escapeHtml(subtitle)}</div>` +
        titleHtml +
      `</header>` +
      paragraphs(essay.body) +
    `</article>`;
  }

  // "part N of M · <when>" — the piece's position in the story. Empty
  // string when the essay isn't part of the story (archived, draft).
  function storySubtitleFor(essayId, order) {
    const i = order.findIndex((o) => o && o.id === essayId);
    if (i < 0) return "";
    const when = order[i].createdAt ? relTime(order[i].createdAt) : "";
    return `part ${i + 1} of ${order.length}${when ? ` · ${when}` : ""}`;
  }

  // Work out the book spread for an opened essay: which piece sits on
  // the left page and which on the right. The order is the story —
  // chronological, oldest first. Normally the opened essay is on the
  // left and the next piece on the right; on the story's final piece
  // there's no "next", so the opened essay closes the book on the
  // RIGHT — the way a printed story ends on its last page — and the
  // preceding piece takes the left. Returns null when there's no
  // neighbour, in which case the read view shows a single page.
  function readingSpreadFor(essay) {
    const story = window.tinkerStory;
    if (!essay || !story || typeof story.storyPieces !== "function") return null;
    const order = story.storyPieces();
    if (!Array.isArray(order) || order.length < 2) return null;
    const i = order.findIndex((o) => o && o.id === essay.id);
    if (i < 0) return null;

    const pageFor = (entry, known) => {
      const readable = known && known.id === entry.id
        ? known
        : readableForWritingId(entry.id);
      if (!readable) return null;
      return { essay: readable, subtitle: storySubtitleFor(entry.id, order) };
    };

    if (i < order.length - 1) {
      const left = pageFor(order[i], essay);
      const right = pageFor(order[i + 1], null);
      return left && right ? { left, right, currentSide: "left" } : null;
    }
    const left = pageFor(order[i - 1], null);
    const right = pageFor(order[i], essay);
    return left && right ? { left, right, currentSide: "right" } : null;
  }

  // The read view's content: a two-page book on a wide desktop (the
  // opened essay + its story neighbour), collapsing to a single centred
  // page on narrow screens or when there's nothing to pair with.
  function readBookHtml(essay) {
    const spread = readingSpreadFor(essay);
    if (!spread) {
      return `<div class="read__book">` +
        readPageHtml(essay, "", "read__page--current") +
      `</div>`;
    }
    const leftRole = spread.currentSide === "left" ? "read__page--current" : "read__page--adjacent";
    const rightRole = spread.currentSide === "right" ? "read__page--current" : "read__page--adjacent";
    return `<div class="read__book read__book--spread">` +
      readPageHtml(spread.left.essay, spread.left.subtitle, "read__page--left " + leftRole) +
      readPageHtml(spread.right.essay, spread.right.subtitle, "read__page--right " + rightRole) +
    `</div>`;
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
  // The sidebar surface between brand and Account is the story block,
  // owned by story.js — renderSidebar just asks it to repaint after a
  // draft/essay mutation. (sessionsEl is a legacy mount, long gone.)
  function renderSidebar() {
    if (window.tinkerStory && typeof window.tinkerStory.renderNav === "function") {
      window.tinkerStory.renderNav();
    }
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
  //
  // The floating bottom mode nav (#mode-nav, owned by freewrite.js) is a
  // pure mode switch: on the welcome screen tapping AI / No AI has no
  // immediate effect beyond setting the mode — it only decides which
  // screen the next session opens into (the AI interview, or the No AI
  // free-write composer). The launch itself stays here, in the grid.
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
  // Free write mode: the free-write composer saves through here. The
  // essay is held locally and syncs out when free write mode ends —
  // i.e. the device reconnects (or the override is switched off).
  window.tinkerOnFreewriteSave = (draft, opts) => store.publishDeferred(draft, opts || {});
  window.addEventListener("tinker:freewrite-changed", (e) => {
    if (e && e.detail && e.detail.on === false) flushDeferredEssays();
  });

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

  // A notification was clicked — open the essay it's about in the read
  // view. Falls back to the story when the essay can't be found (e.g.
  // it was deleted between the notice firing and the click).
  window.addEventListener("tinker:open-essay", (e) => {
    const detail = (e && e.detail) || {};
    if (detail.essayId) {
      const essay = essays.find((x) => x.id === detail.essayId);
      if (essay) { showRead(essay); return; }
    }
    showStory();
  });

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
    // A sign-in may have surfaced essays saved offline on another device.
    flushDeferredEssays();
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
  // Catch any essay saved offline in a prior session and never flushed
  // — sync it out now if we're back online.
  flushDeferredEssays();
})();
