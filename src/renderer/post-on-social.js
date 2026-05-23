/* tinker — Post on Social
 *
 * Two-step flow opened on impulse to post on a chosen platform:
 *   1) Pick a platform (LinkedIn, X, Bluesky, Threads, Substack Notes, Other)
 *   2) Jump to the strongest essay that hasn't been posted to this
 *      platform yet, with the reader-POV question above an inline
 *      composer. Founder writes the post in tinker, copies it to the
 *      clipboard, and marks it as posted — that essay drops off the
 *      next-up list for this platform.
 *
 * The model never writes post text — only score, reason, reader_question.
 * Per-session step state lives in module locals; verdicts and posted-state
 * are cached in localStorage["tinker.postOnSocial.v1"] keyed by
 * `${essayId}::${platform}`. Cache entry shape:
 *   { score, reason, reader_question, scorer_model, ts,
 *     posted?: true, postedAt?: number, postText?: string }
 *
 * Entry point: window.tinkerPostOnSocial.render(). Wired in renderer.js.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.postOnSocial.v1";
  const FIT_THRESHOLD = 7;
  const CONCURRENCY = 3;
  const COPIED_RESET_MS = 2000;

  // Default platforms in display order. The Other tile reveals a
  // freeform input so the founder can name an off-list platform.
  const DEFAULT_PLATFORMS = [
    "LinkedIn",
    "X",
    "Bluesky",
    "Threads",
    "Substack Notes",
    "Other",
  ];

  // ── Cache ─────────────────────────────────────────────────────────
  let cache = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch { return {}; }
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); }
    catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushPostOnSocial === "function") {
      window.tinkerSync.pushPostOnSocial();
    }
  }
  function cacheKey(essayId, platform) {
    return `${essayId}::${platform}`;
  }
  function getCached(essayId, platform) {
    const v = cache[cacheKey(essayId, platform)];
    return v && typeof v === "object" ? v : null;
  }
  function setCached(essayId, platform, verdict) {
    const prev = cache[cacheKey(essayId, platform)] || {};
    cache[cacheKey(essayId, platform)] = { ...prev, ...verdict, ts: Date.now() };
    persist();
  }
  function isPosted(essayId, platform) {
    const v = getCached(essayId, platform);
    return !!(v && v.posted);
  }
  function markPosted(essayId, platform, postText) {
    const prev = cache[cacheKey(essayId, platform)] || {};
    cache[cacheKey(essayId, platform)] = {
      ...prev,
      posted: true,
      postedAt: Date.now(),
      postText: String(postText || ""),
    };
    persist();
  }

  // ── Per-session state ──────────────────────────────────────────────
  // Reopening the page resets to step 1. "When the impulse hits" — each
  // session is a fresh decision about where the impulse is pointing.
  let chosenPlatform = null;

  // ── DOM ────────────────────────────────────────────────────────────
  let viewEl = null;

  function mount() {
    viewEl = document.getElementById("post-on-social");
    return !!viewEl;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // Snippet pattern carried over from the old file — used when an
  // essay has no title.
  function fitTitleFor(essay) {
    if (essay.title) return essay.title;
    const body = String(essay.body || "").trim();
    if (!body) return "";
    const words = body.split(/\s+/);
    const head = words.slice(0, 8).join(" ");
    return words.length > 8 ? `${head}…` : head;
  }

  function getPublishedEssays() {
    const store = window.tinkerStore;
    if (!store || !Array.isArray(store.essays)) return [];
    return store.essays.filter((e) => e && String(e.body || "").trim());
  }

  function getJwt() {
    try { return localStorage.getItem("tinker_jwt") || ""; }
    catch { return ""; }
  }

  // ── Concurrency-N pool ────────────────────────────────────────────
  async function runPool(items, worker, concurrency) {
    const queue = items.slice();
    const workers = [];
    for (let i = 0; i < Math.max(1, concurrency); i++) {
      workers.push((async () => {
        while (queue.length) {
          const item = queue.shift();
          try { await worker(item); }
          catch { /* per-item errors handled by worker */ }
        }
      })());
    }
    await Promise.all(workers);
  }

  // ── API call ──────────────────────────────────────────────────────
  async function scoreEssayOnce(platform, essay) {
    const token = getJwt();
    if (!token) throw new Error("Sign in first.");
    const res = await fetch("/api/post-on-social", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        platform,
        essay: { id: essay.id, title: essay.title || null, body: essay.body || "" },
      }),
    });
    if (!res.ok) {
      let text = "";
      try { text = await res.text(); } catch { /* ignore */ }
      throw new Error(text || `HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json || typeof json !== "object") throw new Error("Bad response.");
    return json;
  }

  // ── Step 1: platform chooser ───────────────────────────────────────
  function renderStep1() {
    const tiles = DEFAULT_PLATFORMS.map((p) =>
      `<button type="button" class="post-on-social__platform" data-platform="${escapeHtml(p)}">` +
        `<span class="post-on-social__platform-label">${escapeHtml(p)}</span>` +
      `</button>`
    ).join("");

    viewEl.innerHTML =
      `<div class="post-on-social__inner">` +
        `<div class="post-on-social__step-indicator">1 / 2</div>` +
        `<h1 class="post-on-social__title">Where are you posting?</h1>` +
        `<div class="post-on-social__platforms" role="list">${tiles}</div>` +
        `<form class="post-on-social__other-form" data-role="other-form" hidden autocomplete="off">` +
          `<input type="text" class="post-on-social__other-input" data-role="other-input" maxlength="48" placeholder="Name the platform" aria-label="Name the platform" />` +
        `</form>` +
      `</div>`;

    const platforms = viewEl.querySelector('.post-on-social__platforms');
    const otherForm = viewEl.querySelector('[data-role="other-form"]');
    const otherInput = viewEl.querySelector('[data-role="other-input"]');

    platforms.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-platform]');
      if (!btn) return;
      const platform = btn.getAttribute("data-platform");
      if (platform === "Other") {
        otherForm.hidden = false;
        for (const tile of platforms.querySelectorAll('[data-platform]')) {
          tile.setAttribute("aria-pressed", tile === btn ? "true" : "false");
        }
        setTimeout(() => { otherInput.focus(); otherInput.select(); }, 30);
        return;
      }
      advanceTo(platform);
    });

    otherForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = (otherInput.value || "").trim();
      if (!name) { otherInput.focus(); return; }
      advanceTo(name);
    });
  }

  async function advanceTo(platform) {
    chosenPlatform = platform;
    await renderStep2();
  }

  // ── Step 2: score in background, then show the top unposted essay
  //            with an inline composer ───────────────────────────────
  async function renderStep2() {
    const platform = chosenPlatform;
    const essays = getPublishedEssays();

    if (!essays.length) {
      renderStep2EmptyState(`No published essays yet. Finish a draft first.`);
      return;
    }

    const unposted = essays.filter((e) => !isPosted(e.id, platform));
    if (!unposted.length) {
      renderStep2AllPostedState();
      return;
    }

    // Loading state — sits behind the scoring round. If every essay is
    // already cached, this paint is replaced almost immediately.
    renderStep2Loading();

    // Score whichever unposted essays don't yet have a cached verdict.
    const toScore = unposted.filter((e) => !getCached(e.id, platform));
    const errors = new Set();
    if (toScore.length) {
      await runPool(toScore, async (essay) => {
        try {
          const v = await scoreEssayOnce(platform, essay);
          setCached(essay.id, platform, v);
        } catch {
          errors.add(essay.id);
        }
      }, CONCURRENCY);
    }

    // Pick the highest-scoring unposted essay we have a verdict for.
    // Defensive: it's possible the founder navigated away mid-scoring;
    // bail if the chosen platform changed under us.
    if (chosenPlatform !== platform) return;

    const scored = unposted
      .map((e) => ({ essay: e, verdict: getCached(e.id, platform) }))
      .filter((x) => x.verdict && !x.verdict.posted);

    if (!scored.length) {
      renderStep2ScoringFailed();
      return;
    }

    scored.sort((a, b) => {
      const sd = (Number(b.verdict.score) || 0) - (Number(a.verdict.score) || 0);
      if (sd !== 0) return sd;
      return Number(b.essay.createdAt || 0) - Number(a.essay.createdAt || 0);
    });

    const top = scored[0];
    renderStep2Compose(top.essay, top.verdict, platform);
  }

  function renderStep2Loading() {
    const platform = chosenPlatform;
    viewEl.innerHTML =
      `<div class="post-on-social__inner">` +
        `<div class="post-on-social__step-indicator">2 / 2</div>` +
        `<h1 class="post-on-social__title">${escapeHtml(`Reading your essays for ${platform}…`)}</h1>` +
        `<div class="post-on-social__loading">` +
          `<span class="thinking-dots" aria-hidden="true">` +
            `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>` +
          `</span>` +
        `</div>` +
      `</div>`;
  }

  function renderStep2EmptyState(message) {
    viewEl.innerHTML =
      `<div class="post-on-social__inner">` +
        `<div class="post-on-social__step-indicator">2 / 2</div>` +
        `<p class="post-on-social__empty">${escapeHtml(message)}</p>` +
        `<div class="post-on-social__back-row">` +
          `<button type="button" class="post-on-social__back" data-role="back">Pick another platform →</button>` +
        `</div>` +
      `</div>`;
    wireBackButton();
  }

  function renderStep2AllPostedState() {
    const platform = chosenPlatform;
    viewEl.innerHTML =
      `<div class="post-on-social__inner">` +
        `<div class="post-on-social__step-indicator">2 / 2</div>` +
        `<p class="post-on-social__empty">${escapeHtml(`You've posted every essay to ${platform}.`)}</p>` +
        `<div class="post-on-social__back-row">` +
          `<button type="button" class="post-on-social__back" data-role="back">Pick another platform →</button>` +
        `</div>` +
      `</div>`;
    wireBackButton();
  }

  function renderStep2ScoringFailed() {
    viewEl.innerHTML =
      `<div class="post-on-social__inner">` +
        `<div class="post-on-social__step-indicator">2 / 2</div>` +
        `<p class="post-on-social__empty">Couldn't read any essays right now.</p>` +
        `<div class="post-on-social__back-row">` +
          `<button type="button" class="post-on-social__back" data-role="back">Try again</button>` +
        `</div>` +
      `</div>`;
    const btn = viewEl.querySelector('[data-role="back"]');
    if (btn) btn.addEventListener("click", () => { renderStep2(); });
  }

  function wireBackButton() {
    const btn = viewEl.querySelector('[data-role="back"]');
    if (btn) btn.addEventListener("click", () => { renderStep1(); });
  }

  function renderStep2Compose(essay, verdict, platform) {
    const titleText = fitTitleFor(essay);
    const scoreFit = Number(verdict.score) >= FIT_THRESHOLD ? "yes" : "no";

    viewEl.innerHTML =
      `<div class="post-on-social__inner">` +
        `<div class="post-on-social__step-indicator">2 / 2</div>` +
        `<div class="post-on-social__prompt">` +
          `<div class="post-on-social__prompt-meta">` +
            `<span class="post-on-social__score-chip" data-fit="${scoreFit}">${verdict.score}/10</span>` +
            `<span class="post-on-social__prompt-source">${escapeHtml(titleText)}</span>` +
          `</div>` +
          `<p class="post-on-social__prompt-reason">${escapeHtml(verdict.reason)}</p>` +
          `<p class="post-on-social__prompt-question">${escapeHtml(verdict.reader_question)}</p>` +
          `<button type="button" class="post-on-social__read-again" data-role="read-again">Read the essay again</button>` +
        `</div>` +
        `<form class="post-on-social__composer" data-role="composer" autocomplete="off">` +
          `<textarea class="post-on-social__textarea" data-role="post-text" rows="8" ` +
            `placeholder="${escapeHtml(`Write your post for ${platform}…`)}" ` +
            `aria-label="${escapeHtml(`Write your post for ${platform}`)}"></textarea>` +
          `<div class="post-on-social__compose-actions">` +
            `<button type="button" class="post-on-social__copy" data-role="copy" disabled>Copy</button>` +
            `<button type="button" class="post-on-social__mark-posted" data-role="mark-posted" disabled>Mark as posted →</button>` +
          `</div>` +
        `</form>` +
      `</div>`;

    const readAgain = viewEl.querySelector('[data-role="read-again"]');
    const textarea = viewEl.querySelector('[data-role="post-text"]');
    const copyBtn = viewEl.querySelector('[data-role="copy"]');
    const markBtn = viewEl.querySelector('[data-role="mark-posted"]');

    if (readAgain) {
      readAgain.addEventListener("click", () => {
        if (typeof window.tinkerOpenEssay === "function") {
          window.tinkerOpenEssay(essay.id);
        }
      });
    }

    const updateEnabled = () => {
      const has = textarea.value.trim().length > 0;
      copyBtn.disabled = !has;
      markBtn.disabled = !has;
    };
    textarea.addEventListener("input", updateEnabled);

    // Cmd/Ctrl+Enter is a quick shortcut to mark as posted once
    // there's text — same pattern the status composer uses elsewhere.
    textarea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!markBtn.disabled) markBtn.click();
      }
    });

    copyBtn.addEventListener("click", async () => {
      const text = textarea.value;
      if (!text.trim()) return;
      let ok = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(text); ok = true; }
        catch { /* fall through */ }
      }
      if (!ok) fallbackCopy(text);
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      clearTimeout(copyBtn._labelTimer);
      copyBtn._labelTimer = setTimeout(() => {
        copyBtn.textContent = original;
      }, COPIED_RESET_MS);
    });

    markBtn.addEventListener("click", () => {
      const text = textarea.value;
      if (!text.trim()) return;
      markPosted(essay.id, platform, text);
      renderStep2Posted(platform);
    });

    setTimeout(() => { textarea.focus(); }, 30);
  }

  function renderStep2Posted(platform) {
    viewEl.innerHTML =
      `<div class="post-on-social__inner">` +
        `<div class="post-on-social__step-indicator">2 / 2</div>` +
        `<p class="post-on-social__posted-confirm">${escapeHtml(`Posted to ${platform}.`)}</p>` +
        `<div class="post-on-social__back-row">` +
          `<button type="button" class="post-on-social__back" data-role="back">Pick another platform →</button>` +
        `</div>` +
      `</div>`;
    wireBackButton();
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch { /* ignore */ }
  }

  // ── Render ─────────────────────────────────────────────────────────
  function render() {
    if (!mount()) return;
    // Reset per-session state on every open. The page is composed by
    // impulse — each visit picks a platform from scratch.
    chosenPlatform = null;
    renderStep1();
  }

  // Re-read cache after a server hydrate (e.g. sign-in pulled remote
  // verdicts). The page itself doesn't auto-rerender — it's opened on
  // impulse — but the next open should see the freshest cache.
  window.addEventListener("tinker:hydrated", () => { cache = load(); });

  window.tinkerPostOnSocial = { render };
})();
