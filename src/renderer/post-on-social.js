/* tinker — Post on Social
 *
 * Three-step flow opened on impulse to post on a chosen platform:
 *   1) Pick a platform (LinkedIn, X, Bluesky, Threads, Substack Notes, Other)
 *   2) See verdicts for the founder's published essays scored for that platform
 *   3) See the strongest essay + a reader-POV question, then open the
 *      platform's composer in a new tab. The composer arrives empty;
 *      the founder writes the post in their own words.
 *
 * The model never writes post text — only score, reason, reader_question.
 * Per-session step state lives in module locals; verdicts are cached in
 * localStorage["tinker.postOnSocial.v1"] keyed by `${essayId}::${platform}`.
 *
 * Entry point: window.tinkerPostOnSocial.render(). Wired in renderer.js.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.postOnSocial.v1";
  const FIT_THRESHOLD = 7;
  const CONCURRENCY = 3;

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

  // Documented compose-intent URLs. Each opens an empty composer; no
  // text= parameter — the founder writes the post from scratch.
  const COMPOSE_URLS = {
    "LinkedIn":       "https://www.linkedin.com/feed/?shareActive=true",
    "X":              "https://x.com/intent/post",
    "Bluesky":        "https://bsky.app/intent/compose",
    "Threads":        "https://www.threads.net/intent/post",
    "Substack Notes": "https://substack.com/notes",
    // "Other" → no URL; we show an inline note instead of a button.
  };

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
    cache[cacheKey(essayId, platform)] = { ...verdict, ts: Date.now() };
    persist();
  }

  // ── Per-session state ──────────────────────────────────────────────
  // Reopening the page resets to step 1. "When the impulse hits" — each
  // session is a fresh decision about where the impulse is pointing.
  let chosenPlatform = null;
  let topPickEssayId = null;
  // Snapshot of the verdicts visible on the current step 2 render. Used
  // by step 3 to look up the top pick's reader_question without
  // re-touching cache (which may have been refreshed in another tab).
  let activeVerdicts = {};

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

  // Same snippet pattern the old file used — keep it local now.
  function fitTitleFor(essay) {
    if (essay.title) return essay.title;
    const body = String(essay.body || "").trim();
    if (!body) return "Untitled";
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

  // ── Concurrency-3 pool ─────────────────────────────────────────────
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
        `<div class="post-on-social__step-indicator">1 / 3</div>` +
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

  function advanceTo(platform) {
    chosenPlatform = platform;
    topPickEssayId = null;
    activeVerdicts = {};
    renderStep2();
  }

  // ── Step 2: verdict list ───────────────────────────────────────────
  function renderStep2() {
    const platform = chosenPlatform;
    const essays = getPublishedEssays();
    if (!essays.length) {
      viewEl.innerHTML =
        `<div class="post-on-social__inner">` +
          `<div class="post-on-social__step-indicator">2 / 3</div>` +
          `<h1 class="post-on-social__title">${escapeHtml(`For ${platform}, this is what would land:`)}</h1>` +
          `<p class="post-on-social__empty">No published essays yet. Finish a draft first.</p>` +
        `</div>`;
      return;
    }

    viewEl.innerHTML =
      `<div class="post-on-social__inner">` +
        `<div class="post-on-social__step-indicator">2 / 3</div>` +
        `<h1 class="post-on-social__title" data-role="step2-title">` +
          escapeHtml(`Reading your essays for ${platform}…`) +
        `</h1>` +
        `<ul class="post-on-social__verdict" data-role="verdict-list"></ul>` +
        `<div class="post-on-social__continue-row" data-role="continue-row" hidden>` +
          `<button type="button" class="post-on-social__continue" data-role="continue">Continue with the top pick →</button>` +
        `</div>` +
      `</div>`;

    const title = viewEl.querySelector('[data-role="step2-title"]');
    const list = viewEl.querySelector('[data-role="verdict-list"]');
    const continueRow = viewEl.querySelector('[data-role="continue-row"]');
    const continueBtn = viewEl.querySelector('[data-role="continue"]');

    // Seed each row with the cached verdict if we have one. Otherwise
    // show loading dots inline and resolve as the model returns.
    const initialVerdicts = {};
    const toLoad = [];
    for (const essay of essays) {
      const v = getCached(essay.id, platform);
      if (v) initialVerdicts[essay.id] = v;
      else toLoad.push(essay);
    }
    activeVerdicts = { ...initialVerdicts };

    function rowHtml(essay, state) {
      const titleText = fitTitleFor(essay);
      if (state.kind === "loaded") {
        const v = state.verdict;
        return (
          `<li class="post-on-social__row" data-essay="${escapeHtml(essay.id)}">` +
            `<div class="post-on-social__row-main">` +
              `<div class="post-on-social__row-title">${escapeHtml(titleText)}</div>` +
              `<div class="post-on-social__row-reason">${escapeHtml(v.reason)}</div>` +
            `</div>` +
            `<div class="post-on-social__row-side">` +
              `<span class="post-on-social__score-chip" data-fit="${v.score >= FIT_THRESHOLD ? "yes" : "no"}">${v.score}/10</span>` +
              `<button type="button" class="post-on-social__read-link" data-role="read" data-essay="${escapeHtml(essay.id)}">Read →</button>` +
            `</div>` +
          `</li>`
        );
      }
      if (state.kind === "error") {
        return (
          `<li class="post-on-social__row post-on-social__row--err" data-essay="${escapeHtml(essay.id)}">` +
            `<div class="post-on-social__row-main">` +
              `<div class="post-on-social__row-title">${escapeHtml(titleText)}</div>` +
              `<div class="post-on-social__row-reason post-on-social__row-reason--err">Couldn't read this one.</div>` +
            `</div>` +
            `<div class="post-on-social__row-side">` +
              `<button type="button" class="post-on-social__retry" data-role="retry" data-essay="${escapeHtml(essay.id)}">Try again</button>` +
            `</div>` +
          `</li>`
        );
      }
      // loading
      return (
        `<li class="post-on-social__row post-on-social__row--loading" data-essay="${escapeHtml(essay.id)}">` +
          `<div class="post-on-social__row-main">` +
            `<div class="post-on-social__row-title">${escapeHtml(titleText)}</div>` +
            `<div class="post-on-social__row-reason">` +
              `<span class="thinking-dots" aria-hidden="true">` +
                `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>` +
              `</span>` +
            `</div>` +
          `</div>` +
          `<div class="post-on-social__row-side">` +
            `<button type="button" class="post-on-social__read-link" data-role="read" data-essay="${escapeHtml(essay.id)}">Read →</button>` +
          `</div>` +
        `</li>`
      );
    }

    function paintRows() {
      const sorted = essays.slice().sort((a, b) => {
        const va = activeVerdicts[a.id];
        const vb = activeVerdicts[b.id];
        const sa = va ? Number(va.score) || 0 : -1;
        const sb = vb ? Number(vb.score) || 0 : -1;
        if (sb !== sa) return sb - sa;
        return Number(b.createdAt || 0) - Number(a.createdAt || 0);
      });
      list.innerHTML = sorted.map((essay) => {
        if (activeVerdicts[essay.id]) {
          return rowHtml(essay, { kind: "loaded", verdict: activeVerdicts[essay.id] });
        }
        const errored = rowErrors.get(essay.id);
        if (errored) return rowHtml(essay, { kind: "error" });
        return rowHtml(essay, { kind: "loading" });
      }).join("");

      // Top pick = highest score. If nothing has scored yet, hide
      // the continue row.
      const topRow = sorted.find((essay) => activeVerdicts[essay.id]);
      if (topRow) {
        topPickEssayId = topRow.id;
        continueRow.hidden = false;
      } else {
        topPickEssayId = null;
        continueRow.hidden = true;
      }

      // Once every essay is either loaded or errored, swap the loading
      // title for the loaded title.
      const stillLoading = sorted.some((essay) =>
        !activeVerdicts[essay.id] && !rowErrors.get(essay.id)
      );
      if (!stillLoading) {
        title.textContent = `For ${platform}, this is what would land:`;
      }
    }

    const rowErrors = new Map();

    list.addEventListener("click", (e) => {
      const readBtn = e.target.closest('[data-role="read"]');
      if (readBtn) {
        const essayId = readBtn.getAttribute("data-essay");
        const essay = essays.find((x) => x.id === essayId);
        if (essay) {
          // Open the existing in-app read view through the renderer
          // global. The read view is a sibling section; clicking the
          // sidebar nav brings the founder back to Post on Social, but
          // step state will reset (intentional).
          if (typeof window.tinkerOpenEssay === "function") {
            window.tinkerOpenEssay(essayId);
          }
        }
        return;
      }
      const retryBtn = e.target.closest('[data-role="retry"]');
      if (retryBtn) {
        const essayId = retryBtn.getAttribute("data-essay");
        const essay = essays.find((x) => x.id === essayId);
        if (essay) {
          rowErrors.delete(essayId);
          paintRows();
          loadOne(essay).catch(() => { /* handled inside */ });
        }
      }
    });

    continueBtn.addEventListener("click", () => {
      if (!topPickEssayId) return;
      renderStep3();
    });

    paintRows();

    async function loadOne(essay) {
      try {
        const verdict = await scoreEssayOnce(platform, essay);
        activeVerdicts[essay.id] = verdict;
        setCached(essay.id, platform, verdict);
        rowErrors.delete(essay.id);
      } catch {
        rowErrors.set(essay.id, true);
      }
      paintRows();
    }

    if (toLoad.length) {
      runPool(toLoad, loadOne, CONCURRENCY).catch(() => { /* per-row handled */ });
    } else {
      // All cached — flip the title now.
      title.textContent = `For ${platform}, this is what would land:`;
    }
  }

  // ── Step 3: reader-POV prompt + composer launcher ─────────────────
  function renderStep3() {
    const platform = chosenPlatform;
    const essays = getPublishedEssays();
    const essay = essays.find((e) => e.id === topPickEssayId);
    const verdict = essay ? (activeVerdicts[essay.id] || getCached(essay.id, platform)) : null;
    if (!essay || !verdict) {
      // Shouldn't happen if step 2 enabled Continue, but stay graceful.
      renderStep1();
      return;
    }

    const composeUrl = COMPOSE_URLS[platform] || null;
    const titleText = fitTitleFor(essay);

    const composeRow = composeUrl
      ? `<button type="button" class="post-on-social__compose" data-role="compose">` +
          escapeHtml(`Open the ${platform} composer →`) +
        `</button>`
      : `<p class="post-on-social__other-note">` +
          escapeHtml(`Open ${platform} in another tab and post from there.`) +
        `</p>`;

    viewEl.innerHTML =
      `<div class="post-on-social__inner">` +
        `<div class="post-on-social__step-indicator">3 / 3</div>` +
        `<div class="post-on-social__prompt">` +
          `<div class="post-on-social__prompt-source">${escapeHtml(titleText)}</div>` +
          `<p class="post-on-social__prompt-question">${escapeHtml(verdict.reader_question)}</p>` +
          `<button type="button" class="post-on-social__read-again" data-role="read-again">Read the essay again</button>` +
        `</div>` +
        `<div class="post-on-social__compose-row">${composeRow}</div>` +
      `</div>`;

    const readAgain = viewEl.querySelector('[data-role="read-again"]');
    if (readAgain) {
      readAgain.addEventListener("click", () => {
        // Open the essay in the existing in-app read view. The Post on
        // Social tab stays composed in-app and the founder can come
        // back via the sidebar; the composer-tab pattern below is the
        // path that keeps both visible side-by-side.
        if (typeof window.tinkerOpenEssay === "function") {
          window.tinkerOpenEssay(essay.id);
        }
      });
    }

    const composeBtn = viewEl.querySelector('[data-role="compose"]');
    if (composeBtn) {
      composeBtn.addEventListener("click", () => {
        try { window.open(composeUrl, "_blank", "noopener,noreferrer"); }
        catch { /* popup blocked — leave the tab open */ }
      });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────
  function render() {
    if (!mount()) return;
    // Reset per-session state on every open. The page is composed by
    // impulse — each visit picks a platform from scratch.
    chosenPlatform = null;
    topPickEssayId = null;
    activeVerdicts = {};
    renderStep1();
  }

  // Re-read cache after a server hydrate (e.g. sign-in pulled remote
  // verdicts). The page itself doesn't auto-rerender — it's opened on
  // impulse — but the next open should see the freshest cache.
  window.addEventListener("tinker:hydrated", () => { cache = load(); });

  window.tinkerPostOnSocial = { render };
})();
