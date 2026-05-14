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
  const newSessionBtn = $("#new-session");
  const navHome = $("#nav-home");
  const feedView = $("#welcome");
  const writingView = $("#writing");
  const readView = $("#read");
  const homeListEl = $("#home-list");
  const homeAddBtn = $("#home-add");
  const readUrl = $("#read-url");
  const readBody = $("#read-body");
  const readClose = $("#read-close");

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
  }

  // ── State ────────────────────────────────────────────────────────────
  let drafts = loadDrafts();
  let essays = loadEssays();
  let activeId = null; // current draft id, or null when on the feed/read view

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
        // Carry location through so the home list's vector classifier
        // can keep reading the writing content after publish.
        location: draft.location || null,
      };
      essays = [essay, ...essays];
      saveEssays(essays);
      drafts = drafts.filter((d) => d.id !== draft.id);
      saveDrafts(drafts);
      activeId = null;
      renderSidebar();
      renderHome();
      showRead(essay);
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
      // Pre-set the scene fields. writing.js' renderLocationPrompt
      // checks `active.location === undefined`, so once we assign
      // a string (or null) the prompt is skipped and the founder
      // jumps straight into the mood-tuned first question.
      if (preset.location !== undefined) draft.location = preset.location || null;
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
    activeId = null;
    renderSidebar();
    renderHome();
    // Drop focus onto the welcome question so the founder can just
    // type the place they're at and hit Enter.
    const inputEl = document.getElementById("welcome-input");
    if (inputEl) setTimeout(() => { inputEl.focus(); inputEl.select(); }, 30);
  }
  function showWriting() {
    feedView.removeAttribute("data-active");
    writingView.hidden = false;
    readView.hidden = true;
  }
  function showRead(essay) {
    feedView.removeAttribute("data-active");
    writingView.hidden = true;
    readView.hidden = false;
    activeId = null;
    renderSidebar();
    readUrl.textContent = essay.url;
    readBody.innerHTML =
      `<header class="read__head">` +
        `<div class="read__author">${escapeHtml(essay.author)}</div>` +
        `<h1 class="read__title">${escapeHtml(essay.title)}</h1>` +
      `</header>` +
      paragraphs(essay.body);
  }

  // ── Rendering ───────────────────────────────────────────────────────
  // Sidebar's drafts+essays list is gone — locations now own the sidebar
  // (see #home-list). Each location card surfaces the latest writing
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
  newSessionBtn.addEventListener("click", () => newDraft());
  navHome.addEventListener("click", () => showFeed());

  if (homeAddBtn) {
    homeAddBtn.addEventListener("click", () => {
      if (window.tinkerLocations && typeof window.tinkerLocations.openAddModal === "function") {
        window.tinkerLocations.openAddModal();
      }
    });
  }

  // Welcome screen prompt: "Where are you?".
  // On submit: register the place as a location (so it persists in
  // the sidebar) and spawn a writing session anchored there. Empty
  // submissions just re-focus the input.
  const welcomeForm = document.getElementById("welcome-form");
  const welcomeInput = document.getElementById("welcome-input");
  if (welcomeForm && welcomeInput) {
    welcomeForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = welcomeInput.value.trim();
      if (!name) { welcomeInput.focus(); return; }
      if (window.tinkerLocations && typeof window.tinkerLocations.add === "function") {
        window.tinkerLocations.add(name);
      }
      welcomeInput.value = "";
      if (typeof window.tinkerNewSession === "function") {
        window.tinkerNewSession({ location: name });
      }
    });
  }

  // Re-render the home list whenever locations change.
  if (window.tinkerLocations && typeof window.tinkerLocations.subscribe === "function") {
    window.tinkerLocations.subscribe(() => renderHome());
  }

  readClose.addEventListener("click", () => showFeed());

  // Tell writing.js how to ask the renderer to do things.
  window.tinkerOnWritingClose = () => closeActiveDraft();
  window.tinkerOnWritingPublish = (draft, stitched) => store.publish(draft, stitched);
  window.tinkerOnDraftChange = (draftId, patch) => store.updateDraft(draftId, patch);

  // Used by the location list in the sidebar: open a fresh draft
  // pre-filled with scene context so the founder jumps straight into
  // mood-tuned reflection.
  window.tinkerNewSession = (preset) => newDraft({ activate: true, preset: preset || null });

  // Used by the location list when a card already carries a published
  // essay or an in-progress draft — tap routes to the right surface
  // instead of always spawning a new session.
  window.tinkerOpenEssay = (essayId) => {
    const essay = essays.find((e) => e.id === essayId);
    if (essay) showRead(essay);
  };
  window.tinkerResumeDraft = (draftId) => openDraft(draftId);

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

  // ── Boot ────────────────────────────────────────────────────────────
  renderSidebar();
  renderHome();
  showFeed();
})();
