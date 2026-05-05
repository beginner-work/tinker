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
  const sessionsEl = $("#sessions");
  const newSessionBtn = $("#new-session");
  const navHome = $("#nav-home");
  const composer = $("#composer");
  const feedView = $("#welcome");
  const writingView = $("#writing");
  const readView = $("#read");
  const feedListEl = $("#feed-list");
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
      };
      essays = [essay, ...essays];
      saveEssays(essays);
      drafts = drafts.filter((d) => d.id !== draft.id);
      saveDrafts(drafts);
      activeId = null;
      renderSidebar();
      renderFeed();
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
  function newDraft({ activate = true } = {}) {
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
    renderFeed();
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
  function renderSidebar() {
    sessionsEl.innerHTML = "";
    if (drafts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "session__empty";
      empty.textContent = "No drafts yet.";
      sessionsEl.appendChild(empty);
      return;
    }
    for (const draft of drafts) {
      const el = document.createElement("button");
      el.className = "session";
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(draft.id === activeId));
      el.dataset.id = draft.id;
      el.title = draft.title;

      const icon = document.createElement("span");
      icon.className = "session__icon";
      icon.innerHTML =
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none">' +
        '<path d="M3 13V3h7l3 3v7H3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<path d="M10 3v3h3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

      const title = document.createElement("span");
      title.className = "session__title";
      title.textContent = draft.title || "Untitled draft";

      const close = document.createElement("span");
      close.className = "session__close";
      close.setAttribute("role", "button");
      close.setAttribute("aria-label", "Delete draft");
      close.innerHTML =
        '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
        '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${draft.title || "Untitled draft"}"?`)) return;
        store.deleteDraft(draft.id);
      });

      el.append(icon, title, close);
      el.addEventListener("click", () => openDraft(draft.id));
      sessionsEl.appendChild(el);
    }
  }

  function renderFeed() {
    feedListEl.innerHTML = "";
    const all = [...essays, ...sampleEssays()];
    if (all.length === 0) {
      const empty = document.createElement("div");
      empty.className = "feed__empty";
      empty.textContent = "Nothing in the feed yet.";
      feedListEl.appendChild(empty);
      return;
    }
    for (const essay of all) {
      const card = document.createElement("article");
      card.className = "feed-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");

      const head = document.createElement("header");
      head.className = "feed-card__head";
      head.innerHTML =
        `<div class="feed-card__author">${escapeHtml(essay.author)}</div>` +
        `<div class="feed-card__dot">·</div>` +
        `<div class="feed-card__when">${relTime(essay.createdAt)}</div>`;
      card.appendChild(head);

      const title = document.createElement("h3");
      title.className = "feed-card__title";
      title.textContent = essay.title;
      card.appendChild(title);

      const preview = document.createElement("div");
      preview.className = "feed-card__preview";
      preview.innerHTML = previewParagraphs(essay.body);
      card.appendChild(preview);

      const more = document.createElement("div");
      more.className = "feed-card__more";
      more.textContent = "Read more →";
      card.appendChild(more);

      const open = () => showRead(essay);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
      feedListEl.appendChild(card);
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
  function previewParagraphs(body) {
    const paras = String(body || "").split(/\n{2,}/).slice(0, 2);
    return paras.map((p) => `<p>${escapeHtml(p.trim())}</p>`).join("");
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

  // Hard-coded sample feed so day one isn't blank.
  // [NEEDS INPUT] feed source for v1: chronological global, follower
  // graph, curated set? Hard-coded samples are fine for the prototype.
  function sampleEssays() {
    return [
      {
        id: "sample_oxymel",
        slug: "what-an-oxymel-taught-me",
        author: "mara",
        title: "What an oxymel taught me about asking for money",
        body:
          "I made my first oxymel for a friend who was sick. She took a sip and her face changed. That was the moment I knew I had something.\n\n" +
          "I sold the next batch for fifteen dollars a bottle. I still feel weird about it. Fifteen dollars feels like a lot for a small jar of vinegar and honey, even when I know what went into it.\n\n" +
          "What I am learning is that the price is not the ask. The ask is, do you trust me. Once someone trusts you, fifteen dollars stops being the question.",
        createdAt: Date.now() - 1000 * 60 * 60 * 6,
        url: "/mara/what-an-oxymel-taught-me",
      },
      {
        id: "sample_couch",
        slug: "the-couch-is-the-competition",
        author: "leo",
        title: "The couch is the competition",
        body:
          "I have a thing I want to make. I have had it for two years. The thing I keep doing instead is sitting on the couch.\n\n" +
          "Nobody is stopping me. There is no boss, no client, no deadline. The thing that wins, every single night, is the couch.\n\n" +
          "I used to think this was a discipline problem. I think now it is a beginning problem. The couch is not asking me to start. The thing is. So I sit with the easier of the two.",
        createdAt: Date.now() - 1000 * 60 * 60 * 28,
        url: "/leo/the-couch-is-the-competition",
      },
      {
        id: "sample_first",
        slug: "the-first-stranger",
        author: "isla",
        title: "The first stranger who paid me",
        body:
          "Her name was Diane. She found me through a friend of a friend. She paid me eighty dollars to lead a sound healing.\n\n" +
          "I had done this maybe forty times for free. The forty-first time, with money on the table, I almost cancelled. I told my partner I was going to make up an excuse.\n\n" +
          "He said, you are not better or worse than you were last week. You are just being paid for it now. He was right. I led the session. Diane cried. She booked again the next month.",
        createdAt: Date.now() - 1000 * 60 * 60 * 50,
        url: "/isla/the-first-stranger",
      },
      {
        id: "sample_kitchen",
        slug: "saturday-morning-kitchen",
        author: "ben",
        title: "Saturday morning, kitchen",
        body:
          "I told myself I would do it before the kids were up. I made coffee. I sat down. I opened the laptop. The cursor blinked.\n\n" +
          "I did not write anything. I cleaned the counter. I refilled the kettle. I checked my phone. The kids woke up.\n\n" +
          "Next Saturday I am going to write the first sentence before the coffee. That is the rule.",
        createdAt: Date.now() - 1000 * 60 * 60 * 96,
        url: "/ben/saturday-morning-kitchen",
      },
      {
        id: "sample_market",
        slug: "the-farmers-market-thing",
        author: "rin",
        title: "The farmer's market thing",
        body:
          "At the farmer's market, the vendor hands you a sample. You taste it. You buy it or you don't. There is no checkout flow. There is no credit card. There is a small piece of bread on a wooden board.\n\n" +
          "I keep thinking about that. The whole internet is built like a checkout flow. The farmer's market is built like a sample table. I would rather build the sample table.",
        createdAt: Date.now() - 1000 * 60 * 60 * 120,
        url: "/rin/the-farmers-market-thing",
      },
    ];
  }

  // ── Wire up ─────────────────────────────────────────────────────────
  newSessionBtn.addEventListener("click", () => newDraft());
  navHome.addEventListener("click", () => showFeed());

  composer.addEventListener("click", () => newDraft());
  composer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); newDraft(); }
  });

  readClose.addEventListener("click", () => showFeed());

  // Tell writing.js how to ask the renderer to do things.
  window.tinkerOnWritingClose = () => closeActiveDraft();
  window.tinkerOnWritingPublish = (draft, stitched) => store.publish(draft, stitched);
  window.tinkerOnDraftChange = (draftId, patch) => store.updateDraft(draftId, patch);

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
  renderFeed();
  showFeed();
})();
