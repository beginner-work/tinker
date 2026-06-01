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
      // Drop the founder onto a calm "being assessed" confirmation and
      // let a background watcher tell them where it landed once the
      // organize job actually settles (see showPitchAssessing). The
      // sidebar-tree's classify listener (fired by the event above) and
      // pitches.scheduleOrganize do the real placement work.
      showPitchAssessing(essay);
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
    // now — kind "essay", like any other — flagged pendingPitch, and
    // let flushPendingPitches() send it off to classify + organize the
    // moment we're back online. No Claude call, no stitching: the body
    // is exactly what they typed.
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
      if (window.tinkerTree && typeof window.tinkerTree.clearWritingFromTree === "function") {
        window.tinkerTree.clearWritingFromTree(draft.id);
      }
      // Online already? Send it off now. Offline? It waits for reconnect.
      flushPendingPitches();
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

  // Send any essays saved in free write mode off to be added to a pitch
  // — the same classify + organize path a normal publish fires (via the
  // tinker:writing-saved event), just deferred until we're back online.
  // No-op while free write mode is on (the network is gated) or when
  // nothing is waiting.
  function flushPendingPitches() {
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
    // The normal publish path arms this via showPitchAssessing(); the
    // deferred path has no confirmation screen, so arm it here so the
    // founder still gets the "where it landed" note once the organize
    // round these writing-saved events kicked off settles.
    watchPlacement(pending);
  }

  // A free-write essay written with no connection has just been sent off
  // now that we're back online. Reuse the notification component for a
  // sticky, cross-device notice so the founder knows it made it out —
  // unlike the auto-dismissing placement toast, this one stays until they
  // acknowledge it, on whichever device they next open. The id is keyed
  // to the essay so the same notice never lands twice (e.g. when another
  // device flushed it first and it arrives over sync).
  function emitOfflineEssayNotification(essay) {
    if (!essay) return;
    const titleText = essay.title || "Your essay";
    const payload = {
      id: "offline_" + (essay.id || Date.now().toString(36)),
      kind: "offline-essay",
      sticky: true,
      title: "Back online",
      body: `“${titleText}” — written offline — is on its way into your pitches.`,
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
    readBody.innerHTML = readBookHtml(essay);
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

  // ── Post-publish flow ────────────────────────────────────────────
  //
  // Publishing used to drop the founder onto a live "arrangement"
  // screen that narrated the organize job phase-by-phase and locked in
  // a placement after a single round. That placement was a lie: the
  // backend re-clusters on every later writing change, so an essay the
  // screen announced as "a new direction" could quietly get folded into
  // another pitch seconds (or a session) later.
  //
  // The new flow makes no premature claim. Publishing shows a calm
  // confirmation ("Your pitch is being assessed") and lets the founder
  // keep writing or close the app. A background watcher waits for the
  // organize job to actually SETTLE — placement unchanged, nothing
  // pending or in flight — and only then fires a native-style toast
  // notification telling the founder where the essay truly landed, and
  // which pitch it became part of. If they've left, the notification is
  // persisted and waits for them on the next visit.

  // Tracks the in-flight placement watcher so a second publish supersedes
  // the first rather than racing it.
  let placementWatchToken = 0;

  function showPitchAssessing(essay) {
    if (!writingFitView || !writingFitContent) {
      // No confirmation surface available — still kick off the watcher
      // so the notification fires, then fall back to the feed.
      watchPlacement(essay);
      showFeed();
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

    const titleText = essay.title || "your essay";
    writingFitContent.innerHTML =
      `<div class="assessing">` +
        `<div class="assessing__mark" aria-hidden="true"><span class="assessing__pulse"></span></div>` +
        `<p class="assessing__crumb">You created another essay</p>` +
        `<h1 class="assessing__headline">Your pitch is being assessed.</h1>` +
        `<p class="assessing__sub">We're reading <span class="assessing__title">${escapeHtml(titleText)}</span> ` +
          `against your pitches. You'll get a note the moment it settles into one — keep writing, ` +
          `or step away and we'll let you know where it landed.</p>` +
        `<div class="assessing__actions">` +
          `<button type="button" class="assessing__close" data-assessing-action="close">Close app</button>` +
          `<button type="button" class="assessing__keep" data-assessing-action="keep">Keep writing →</button>` +
        `</div>` +
      `</div>`;

    const keepBtn = writingFitContent.querySelector('[data-assessing-action="keep"]');
    const closeBtn = writingFitContent.querySelector('[data-assessing-action="close"]');
    if (keepBtn) keepBtn.addEventListener("click", () => {
      if (typeof window.tinkerNewSession === "function") window.tinkerNewSession();
      else showFeed();
    });
    if (closeBtn) closeBtn.addEventListener("click", () => closeApp());

    // Kick off the background settle-watcher — it fires the toast once
    // the organize job has stopped moving this essay.
    watchPlacement(essay);
  }

  // Closes the desktop window / standalone PWA. On a plain web tab (where
  // window.close() is a no-op for tabs the user opened themselves) we fall
  // back to the feed so the button is never dead.
  function closeApp() {
    try {
      if (window.tinker && typeof window.tinker.close === "function") {
        window.tinker.close();
        return;
      }
    } catch { /* ignore */ }
    try { window.close(); } catch { /* ignore */ }
    setTimeout(() => { try { showFeed(); } catch { /* ignore */ } }, 50);
  }

  // Waits for the backend organize job to settle on a final home for the
  // just-published essay, then emits a placement notification. "Settled"
  // means an organize round completed and, after a short grace window, no
  // further round started — so the debounced scheduleOrganize and any
  // later writing-triggered rounds have all drained and the placement we
  // read won't be contradicted moments later. A max-wait guards the case
  // where organize never runs (no token, nothing off-pitch), in which case
  // we report wherever the essay currently sits.
  function watchPlacement(essays) {
    const list = Array.isArray(essays) ? essays.filter(Boolean) : (essays ? [essays] : []);
    if (!list.length) return;
    const pitches = window.tinkerPitches;
    if (!pitches || typeof pitches.findPitchForWriting !== "function") return;

    const token = ++placementWatchToken;
    const SETTLE_GRACE_MS = 1500;   // quiet window after a round before we trust it
    const FIRST_WAIT_MS = 7000;     // > ORGANIZE_DEBOUNCE_MS, so the first round can begin
    const MAX_WAIT_MS = 45000;      // absolute ceiling so we never wait forever
    let settleTimer = null;
    let maxTimer = null;
    let done = false;

    const cleanup = () => {
      window.removeEventListener("tinker:organize-started", onStarted);
      window.removeEventListener("tinker:organize-completed", onCompleted);
      if (settleTimer) clearTimeout(settleTimer);
      if (maxTimer) clearTimeout(maxTimer);
    };
    const finalize = () => {
      if (done || token !== placementWatchToken) { cleanup(); return; }
      done = true;
      cleanup();
      // One organize round settles every essay in the batch at once, so
      // notify for each — covers a reconnect that flushes several essays
      // written offline in the same session.
      for (const essay of list) emitPlacementNotification(essay);
    };
    const onStarted = () => {
      // A new round began — whatever we were about to trust is now stale.
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    };
    const onCompleted = () => {
      if (token !== placementWatchToken) { cleanup(); return; }
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(finalize, SETTLE_GRACE_MS);
    };

    window.addEventListener("tinker:organize-started", onStarted);
    window.addEventListener("tinker:organize-completed", onCompleted);

    // If no organize round ever starts (nothing drifted, or no auth token)
    // resolve after FIRST_WAIT_MS with whatever placement exists; cap the
    // total wait either way.
    settleTimer = setTimeout(finalize, FIRST_WAIT_MS);
    maxTimer = setTimeout(finalize, MAX_WAIT_MS);
  }

  // Builds and dispatches the "where it landed" notification for a settled
  // essay. Reuses the same pitch-name/slide lookup the read view's subtitle
  // uses, so the label in the toast matches what the founder sees on the
  // essay itself. When the essay couldn't be slotted we say so plainly
  // rather than inventing a home.
  function emitPlacementNotification(essay) {
    const pitches = window.tinkerPitches;
    const placement = (pitches && typeof pitches.findPitchForWriting === "function")
      ? pitches.findPitchForWriting(essay.id)
      : null;
    const titleText = essay.title || "Your essay";

    let body;
    let pitchId = null;
    if (placement && placement.pitchId) {
      pitchId = placement.pitchId;
      const pitch = (typeof pitches.getPitch === "function") ? pitches.getPitch(pitchId) : null;
      const pitchName = (pitch && (pitch.personalTitle || pitch.aiTitle)) || "a pitch";
      const heading = placement.deckHeading;
      body = heading
        ? `Landed in “${pitchName}” — on the ${heading} slide.`
        : `Landed in “${pitchName}”.`;
    } else {
      body = `It's standing on its own for now — keep writing and it'll gather a pitch of its own.`;
    }

    const payload = {
      kind: "placement",
      title: `“${titleText}” found its place`,
      body,
      essayId: essay.id,
      pitchId,
    };
    if (typeof window.tinkerNotify === "function") {
      window.tinkerNotify(payload);
    } else {
      try { window.dispatchEvent(new CustomEvent("tinker:notify", { detail: payload })); }
      catch { /* ignore */ }
    }
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

  // Build the "<PitchName> · <SlideTitle>" subtitle for a known pitch +
  // deck heading. SlideTitle is coloured to match that slide's row in
  // the sidebar; PitchName prefers the founder's personal title and
  // falls back to the AI-generated one. Returns just the pitch name
  // when no heading is given, and the empty string when the pitch can't
  // be resolved (callers decide their own fallback).
  function subtitleHtmlFor(pitchId, heading) {
    if (!pitchId || !window.tinkerPitches) return "";
    const pitches = window.tinkerPitches;
    const pitch = typeof pitches.getPitch === "function" ? pitches.getPitch(pitchId) : null;
    const pitchName = (pitch && (pitch.personalTitle || pitch.aiTitle)) || "Untitled pitch";
    if (!heading) return escapeHtml(pitchName);
    const color = slideColorFor(heading);
    return escapeHtml(pitchName)
      + ` <span class="essay-subtitle__sep" aria-hidden="true">·</span> `
      + `<span class="essay-subtitle__slide" style="color: ${color}">${escapeHtml(heading)}</span>`;
  }

  // The per-essay subtitle, resolved through the essay's canonical
  // placement (the first pitch + slide it's slotted under). Returns the
  // empty string when the essay isn't slotted anywhere yet (e.g. a
  // freshly published essay the classifier hasn't placed yet) so callers
  // can decide on a fallback themselves.
  function pitchSubtitleHtmlFor(essay) {
    if (!essay || !window.tinkerPitches) return "";
    const pitches = window.tinkerPitches;
    if (typeof pitches.findPitchForWriting !== "function") return "";
    const placement = pitches.findPitchForWriting(essay.id);
    if (!placement) return "";
    return subtitleHtmlFor(placement.pitchId, placement.deckHeading);
  }

  // Resolve a writingId — an essay id, or a not-yet-published draft id —
  // to a readable { id, title, body, author }. The book spread shows
  // the *next* writing in a pitch, which is almost always a published
  // essay but can briefly be a draft before the organize job re-slots
  // it, so we look in both stores.
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
  // <article class="read__page">. `placement` ({ pitchId, heading })
  // pins the subtitle to a known slide so a book spread stays in step
  // with the sequence it was built from; without it we fall back to the
  // essay's canonical placement.
  function readPageHtml(essay, placement, extraClass) {
    const subtitle = (placement
      ? subtitleHtmlFor(placement.pitchId, placement.heading)
      : pitchSubtitleHtmlFor(essay)) || escapeHtml(essay.author || "you");
    // Title wraps the text in an inner span so the mobile floating
    // title bar can centre with text-overflow: ellipsis — both
    // properties only behave when applied to a sized child, not to a
    // flex container directly.
    const titleHtml = essay.title
      ? `<h1 class="read__title"><span>${escapeHtml(essay.title)}</span></h1>`
      : "";
    return `<article class="read__page${extraClass ? " " + extraClass : ""}">` +
      `<header class="read__head">` +
        `<div class="read__author">${subtitle}</div>` +
        titleHtml +
      `</header>` +
      paragraphs(essay.body) +
    `</article>`;
  }

  // Work out the book spread for an opened essay: which essay sits on
  // the left page and which on the right. Normally the opened essay is
  // on the left and the next essay in the pitch deck is on the right.
  // On the last slide of a pitch (e.g. The Ask) there's no "next", so
  // the opened essay closes the book on the RIGHT — the way a printed
  // deck ends on its final slide — and the preceding essay takes the
  // left. Returns null when the essay isn't in a pitch or has no
  // neighbour, in which case the read view shows a single page.
  function readingSpreadFor(essay) {
    const pitches = window.tinkerPitches;
    if (!essay || !pitches) return null;
    if (typeof pitches.findPitchForWriting !== "function"
      || typeof pitches.readingOrder !== "function") return null;
    const placement = pitches.findPitchForWriting(essay.id);
    if (!placement) return null;
    const order = pitches.readingOrder(placement.pitchId);
    if (!Array.isArray(order) || order.length < 2) return null;
    const i = order.findIndex((o) => o && o.writingId === essay.id);
    if (i < 0) return null;

    // Resolve a sequence entry to a page descriptor. `known` lets us
    // reuse the already-in-hand opened essay instead of re-resolving it.
    const pageFor = (entry, known) => {
      const readable = known && known.id === entry.writingId
        ? known
        : readableForWritingId(entry.writingId);
      if (!readable) return null;
      return { essay: readable, placement: { pitchId: placement.pitchId, heading: entry.heading } };
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
  // opened essay + its pitch neighbour), collapsing to a single centred
  // page on narrow screens or when there's nothing to pair with.
  function readBookHtml(essay) {
    const spread = readingSpreadFor(essay);
    if (!spread) {
      return `<div class="read__book">` +
        readPageHtml(essay, null, "read__page--current") +
      `</div>`;
    }
    const leftRole = spread.currentSide === "left" ? "read__page--current" : "read__page--adjacent";
    const rightRole = spread.currentSide === "right" ? "read__page--current" : "read__page--adjacent";
    return `<div class="read__book read__book--spread">` +
      readPageHtml(spread.left.essay, spread.left.placement, "read__page--left " + leftRole) +
      readPageHtml(spread.right.essay, spread.right.placement, "read__page--right " + rightRole) +
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
  // essay is held locally and sent off to the pitch when free write mode
  // ends — i.e. the device reconnects (or the override is switched off).
  window.tinkerOnFreewriteSave = (draft, opts) => store.publishDeferred(draft, opts || {});
  window.addEventListener("tinker:freewrite-changed", (e) => {
    if (e && e.detail && e.detail.on === false) flushPendingPitches();
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

  // A placement toast was clicked — open the essay it's about in the read
  // view. Falls back to making its pitch active if the essay can't be found
  // (e.g. it was deleted between the notification firing and the click).
  window.addEventListener("tinker:open-essay", (e) => {
    const detail = (e && e.detail) || {};
    if (detail.essayId) {
      const essay = essays.find((x) => x.id === detail.essayId);
      if (essay) { showRead(essay); return; }
    }
    if (detail.pitchId && window.tinkerPitches && typeof window.tinkerPitches.setActivePitch === "function") {
      window.tinkerPitches.setActivePitch(detail.pitchId);
      showFeed();
    }
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
    flushPendingPitches();
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
  // Catch any essay saved offline in a prior session and never sent off
  // — send it to the pitch now if we're back online.
  flushPendingPitches();
})();
