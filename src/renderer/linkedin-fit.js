/* tinker — LinkedIn fits
 *
 * Reads the founder's published essays one at a time, asks Claude
 * whether each could work as a LinkedIn post, and — for the ones
 * that fit — asks the founder a single question: "Do you have a
 * picture of X?" where X is something concrete from the essay
 * that a reader would benefit from seeing.
 *
 * Results are cached in localStorage["tinker.linkedinFits.v1"]
 * keyed by essay id so the view fills in instantly on return.
 * "Read each one" re-runs the check on every essay.
 *
 * Entry point: window.tinkerLinkedinFit.render(). Triggered by the
 * "LinkedIn fits" item in the sidebar Account list (wired in
 * renderer.js).
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.linkedinFits.v1";
  const CONCURRENCY = 3;

  // LinkedIn's composer URL accepts `text=` intermittently on desktop
  // web and not at all in mobile / in-app browsers. We send a best-effort
  // prefill alongside a guaranteed clipboard copy so the paste path is
  // always available either way.
  const COMPOSE_URL = "https://www.linkedin.com/feed/?shareActive=true";
  const POST_PREFILL_MAX_CHARS = 3000;
  const POST_URL_MAX_LENGTH = 8000;
  const POST_LABEL_RESET_MS = 5000;

  const SYSTEM_PROMPT = [
    "You read a founder's essay and assess how well it would perform as a LinkedIn post.",
    "",
    "A strong LinkedIn post:",
    "- Has one concrete moment, story, or insight that a stranger scrolling past lands in within the first two lines.",
    "- Has a 'what I learned' or 'what I noticed' beat that travels beyond the writer's private context.",
    "- Is not purely a journal entry — there is something for the reader to take with them.",
    "- Has visual potential — a real picture from the founder's life could help readers land in it.",
    "",
    "For the essay, decide:",
    "1. fit (boolean) — would this make a good LinkedIn post at all? Set false when the essay is too private, too abstract, or has no take-away for a reader.",
    "2. strength (integer 1–10) — how well this essay would perform compared to the average post in a founder's feed. Weigh hook, specificity, take-away, and visual potential. A 1 means don't post. A 10 means rare, strongly worth posting. Most worthwhile fits sit between 5 and 9; reserve 9–10 for essays you'd genuinely expect to outperform. When fit is false, set strength to 1, 2, or 3. Be honest — do not inflate. Vary your scores; not every fit is a 7.",
    "3. reason (string, one sentence, plain language) — why this score. No marketing words. Be concrete about what works or doesn't.",
    "4. picture_subject (string or null) — only when fit is true: a short concrete noun phrase naming the most visually salient thing in the essay that the founder might already have a picture of. Examples: 'the napkin sketch you mentioned', 'your kitchen counter from that morning', 'the dashboard on your laptop', 'the receipt you crumpled', 'the view from where you were sitting'. Always something the founder could plausibly have photographed in their normal life. Never a stock image. Never generic ('your computer'). Make it specific to this essay.",
    "5. picture_question (string or null) — only when fit is true: a single question to the founder, starting with 'Do you have a picture of', that names the subject and adds one short reason it would help the reader. 22 words or fewer. End with a question mark.",
    "",
    "Respond as a single JSON object with exactly these five keys. Never wrap in code fences. Never add explanations outside the JSON.",
  ].join("\n");

  // ── Cache ────────────────────────────────────────────────────────────
  let cache = load();
  const inflight = Object.create(null); // essayId → Promise

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Object.create(null);
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === "object") ? parsed : Object.create(null);
    } catch { return Object.create(null); }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); }
    catch { /* ignore */ }
    // Push to the server so a verdict scored on desktop shows up on
    // phone without re-running the model.
    if (window.tinkerSync && typeof window.tinkerSync.pushLinkedinFits === "function") {
      window.tinkerSync.pushLinkedinFits();
    }
  }

  // Strip stale cache entries whose essays no longer exist. Keeps the
  // localStorage row from growing forever as essays are deleted.
  function pruneCache(currentIds) {
    const live = new Set(currentIds);
    let changed = false;
    for (const id of Object.keys(cache)) {
      if (!live.has(id)) { delete cache[id]; changed = true; }
    }
    if (changed) save();
  }

  function parseJson(text) {
    const trimmed = (text || "").trim();
    const stripped = trimmed
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");
    try { return JSON.parse(stripped); }
    catch { return null; }
  }

  function normalize(parsed) {
    if (!parsed || typeof parsed !== "object") return null;
    const fit = !!parsed.fit;
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
    if (!reason) return null;
    const rawStrength = Number(parsed.strength);
    const strength = Number.isFinite(rawStrength)
      ? Math.min(10, Math.max(1, Math.round(rawStrength)))
      : null;
    const pictureSubject = fit && typeof parsed.picture_subject === "string"
      ? parsed.picture_subject.trim() || null
      : null;
    const pictureQuestion = fit && typeof parsed.picture_question === "string"
      ? parsed.picture_question.trim() || null
      : null;
    return {
      fit,
      strength,
      reason,
      pictureSubject,
      pictureQuestion,
      ts: Date.now(),
    };
  }

  // Highest strength among cached fits. Used to badge the top pick.
  // Returns -1 when no scored fits exist.
  function maxFitStrength() {
    let best = -1;
    for (const id of Object.keys(cache)) {
      const c = cache[id];
      if (c && c.fit && Number.isFinite(c.strength) && c.strength > best) {
        best = c.strength;
      }
    }
    return best;
  }

  async function checkEssay(essay) {
    if (!essay || !essay.id) return null;
    if (inflight[essay.id]) return inflight[essay.id];

    const body = String(essay.body || "").trim();
    if (!body) {
      const empty = {
        fit: false,
        strength: 1,
        reason: "Not enough text to read.",
        pictureSubject: null,
        pictureQuestion: null,
        ts: Date.now(),
      };
      cache[essay.id] = empty;
      save();
      return empty;
    }
    if (!window.tinker || typeof window.tinker.callClaude !== "function") {
      throw new Error("Anthropic client unavailable. Reload the page.");
    }

    const userParts = [];
    if (essay.title) userParts.push(`Title: ${essay.title}`);
    userParts.push("Essay:");
    userParts.push(body);

    const p = (async () => {
      const result = await window.tinker.callClaude({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userParts.join("\n\n") }],
        model: "claude-haiku-4-5-20251001",
        maxTokens: 400,
      });
      const parsed = parseJson(result.text);
      const norm = normalize(parsed);
      if (!norm) throw new Error("Couldn't parse the reader's reply.");
      cache[essay.id] = norm;
      save();
      return norm;
    })().finally(() => { delete inflight[essay.id]; });

    inflight[essay.id] = p;
    return p;
  }

  // ── View ─────────────────────────────────────────────────────────────
  let viewEl = null;
  let listEl = null;
  let emptyEl = null;
  let checkAllBtn = null;

  function mount() {
    viewEl = document.getElementById("linkedin-fit");
    if (!viewEl) return false;
    if (viewEl.dataset.mounted === "true") {
      listEl = viewEl.querySelector("[data-linkedin-list]");
      emptyEl = viewEl.querySelector("[data-linkedin-empty]");
      checkAllBtn = viewEl.querySelector('[data-linkedin-action="check-all"]');
      return true;
    }
    viewEl.innerHTML =
      `<div class="linkedin-fit__inner">` +
        `<header class="linkedin-fit__head">` +
          `<p class="linkedin-fit__crumb">Quiet review</p>` +
          `<h1 class="linkedin-fit__title">Which of these would do best as LinkedIn posts?</h1>` +
          `<p class="linkedin-fit__sub">A short read through each essay, scored 1–10 on how well it would perform. The strongest float to the top. For each fit, a small question about a picture that might help readers land in it.</p>` +
          `<div class="linkedin-fit__head-actions">` +
            `<button type="button" class="linkedin-fit__check-all" data-linkedin-action="check-all">Read each one</button>` +
          `</div>` +
        `</header>` +
        `<div class="linkedin-fit__list" data-linkedin-list></div>` +
        `<p class="linkedin-fit__empty" data-linkedin-empty hidden>No published essays yet. Finish a draft first.</p>` +
      `</div>`;
    listEl = viewEl.querySelector("[data-linkedin-list]");
    emptyEl = viewEl.querySelector("[data-linkedin-empty]");
    checkAllBtn = viewEl.querySelector('[data-linkedin-action="check-all"]');
    checkAllBtn.addEventListener("click", checkAll);
    viewEl.dataset.mounted = "true";
    return true;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // Async clipboard with a hidden-textarea fallback for older Capacitor
  // WebViews where the async API throws on insecure contexts.
  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return true; }
      catch { /* fall through */ }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  // Best-effort prefill. LinkedIn honours `text=` on desktop web
  // intermittently and not at all on mobile / in-app browsers. The
  // clipboard copy is the safety net either way.
  function openLinkedinComposer(body) {
    const trimmed = body.length > POST_PREFILL_MAX_CHARS
      ? body.slice(0, POST_PREFILL_MAX_CHARS) : body;
    const candidate = `${COMPOSE_URL}&text=${encodeURIComponent(trimmed)}`;
    const url = candidate.length <= POST_URL_MAX_LENGTH ? candidate : COMPOSE_URL;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function postToLinkedIn(essay, button) {
    const body = String(essay.body || "");
    if (!body) return;
    await copyToClipboard(body);
    openLinkedinComposer(body);
    button.textContent = "Copied — paste in LinkedIn";
    clearTimeout(button._labelTimer);
    button._labelTimer = setTimeout(() => {
      button.textContent = "Post to LinkedIn";
    }, POST_LABEL_RESET_MS);
  }

  function essaySnippet(essay) {
    if (essay.title) return essay.title;
    const body = String(essay.body || "").trim();
    if (!body) return "Untitled";
    const words = body.split(/\s+/);
    const head = words.slice(0, 8).join(" ");
    return words.length > 8 ? `${head}…` : head;
  }

  function getEssays() {
    const store = window.tinkerStore;
    if (!store || !Array.isArray(store.essays)) return [];
    return store.essays.slice();
  }

  // Sort order:
  //   1. cached fits, highest strength first (unscored fits sink to the
  //      bottom of the fit block)
  //   2. cached non-fits
  //   3. uncached essays, newest first
  function sortedEssays() {
    return getEssays().sort((a, b) => {
      const fa = cache[a.id], fb = cache[b.id];
      const tierA = (fa && fa.fit) ? 2 : fa ? 1 : 0;
      const tierB = (fb && fb.fit) ? 2 : fb ? 1 : 0;
      if (tierA !== tierB) return tierB - tierA;
      if (tierA === 2) {
        const stA = Number.isFinite(fa.strength) ? fa.strength : -1;
        const stB = Number.isFinite(fb.strength) ? fb.strength : -1;
        if (stA !== stB) return stB - stA;
      }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function renderRow(essay) {
    const row = document.createElement("article");
    row.className = "linkedin-fit__row";
    row.dataset.essayId = essay.id;

    const head = document.createElement("button");
    head.type = "button";
    head.className = "linkedin-fit__row-head";
    head.innerHTML =
      `<span class="linkedin-fit__row-title">${escapeHtml(essaySnippet(essay))}</span>` +
      `<span class="linkedin-fit__row-open" aria-hidden="true">Read →</span>`;
    head.addEventListener("click", () => {
      if (typeof window.tinkerOpenEssay === "function") window.tinkerOpenEssay(essay.id);
    });
    row.appendChild(head);

    const verdict = document.createElement("div");
    verdict.className = "linkedin-fit__verdict";
    verdict.dataset.role = "verdict";
    row.appendChild(verdict);

    const actions = document.createElement("div");
    actions.className = "linkedin-fit__row-actions";
    const post = document.createElement("button");
    post.type = "button";
    post.className = "linkedin-fit__check linkedin-fit__post";
    post.dataset.role = "post";
    post.textContent = "Post to LinkedIn";
    post.hidden = true;
    actions.appendChild(post);
    const check = document.createElement("button");
    check.type = "button";
    check.className = "linkedin-fit__check";
    check.dataset.role = "check";
    actions.appendChild(check);
    row.appendChild(actions);

    refreshRow(row, essay);
    check.addEventListener("click", () => runCheck(essay, row));
    post.addEventListener("click", () => postToLinkedIn(essay, post));
    return row;
  }

  function refreshRow(row, essay) {
    const verdict = row.querySelector('[data-role="verdict"]');
    const check = row.querySelector('[data-role="check"]');
    const post = row.querySelector('[data-role="post"]');
    const cached = cache[essay.id];
    if (!cached) {
      verdict.innerHTML = `<p class="linkedin-fit__verdict-meta">Not read yet.</p>`;
      check.textContent = "Read this one";
      check.disabled = false;
      if (post) post.hidden = true;
      row.dataset.state = "idle";
      row.removeAttribute("data-strongest");
      return;
    }
    if (cached.fit) {
      const score = Number.isFinite(cached.strength)
        ? `<span class="linkedin-fit__score" aria-label="Strength out of 10">${cached.strength}/10</span>`
        : "";
      const top = maxFitStrength();
      const isStrongest = Number.isFinite(cached.strength)
        && cached.strength === top
        && top > 0;
      const strongestBadge = isStrongest
        ? `<span class="linkedin-fit__strongest">Strongest pick</span>`
        : "";
      const picture = cached.pictureQuestion
        ? `<p class="linkedin-fit__picture">${escapeHtml(cached.pictureQuestion)}</p>`
        : "";
      verdict.innerHTML =
        `<div class="linkedin-fit__verdict-line">` +
          `<p class="linkedin-fit__verdict-label">Could be a LinkedIn post.</p>` +
          score +
          strongestBadge +
        `</div>` +
        `<p class="linkedin-fit__verdict-reason">${escapeHtml(cached.reason)}</p>` +
        picture;
      row.dataset.state = "fit";
      if (isStrongest) row.dataset.strongest = "true"; else row.removeAttribute("data-strongest");
      if (post) post.hidden = false;
    } else {
      verdict.innerHTML =
        `<p class="linkedin-fit__verdict-label linkedin-fit__verdict-label--miss">Better kept as an essay.</p>` +
        `<p class="linkedin-fit__verdict-reason">${escapeHtml(cached.reason)}</p>`;
      row.dataset.state = "miss";
      row.removeAttribute("data-strongest");
      if (post) post.hidden = true;
    }
    check.textContent = "Read again";
    check.disabled = false;
  }

  async function runCheck(essay, row) {
    const verdict = row.querySelector('[data-role="verdict"]');
    const check = row.querySelector('[data-role="check"]');
    const post = row.querySelector('[data-role="post"]');
    check.disabled = true;
    if (post) post.hidden = true;
    row.dataset.state = "loading";
    verdict.innerHTML =
      `<div class="thinking-dots" aria-hidden="true">` +
      `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>` +
      `</div>`;
    try {
      await checkEssay(essay);
    } catch (err) {
      verdict.innerHTML =
        `<p class="linkedin-fit__verdict-label linkedin-fit__verdict-label--err">Couldn't read this one.</p>` +
        `<p class="linkedin-fit__verdict-reason">${escapeHtml((err && err.message) || "Try again.")}</p>`;
      row.dataset.state = "err";
      check.textContent = "Try again";
      check.disabled = false;
      return;
    }
    // Refresh every rendered row, not just this one — a new top
    // strength can demote the previous "Strongest pick" badge.
    refreshAllRows();
  }

  function refreshAllRows() {
    if (!listEl) return;
    const store = window.tinkerStore;
    const essays = store && Array.isArray(store.essays) ? store.essays : [];
    listEl.querySelectorAll(".linkedin-fit__row").forEach((row) => {
      const id = row.dataset.essayId;
      const essay = essays.find((e) => e.id === id);
      if (essay) refreshRow(row, essay);
    });
  }

  function render() {
    if (!mount()) return;
    const list = sortedEssays();
    pruneCache(list.map((e) => e.id));
    listEl.innerHTML = "";
    if (list.length === 0) {
      emptyEl.hidden = false;
      checkAllBtn.disabled = true;
      delete viewEl.dataset.autoScored;
      return;
    }
    emptyEl.hidden = true;
    checkAllBtn.disabled = false;
    for (const essay of list) {
      listEl.appendChild(renderRow(essay));
    }
    // Auto-score so the user lands in a populated workshop on first
    // arrival — and so essays written since last visit appear scored
    // on return without a manual click. The flag prevents a re-render
    // during an in-flight scoring pass from kicking off a second one;
    // it clears when the pass finishes so the next batch of idle rows
    // (a newly published essay) can auto-score too.
    const hasIdle = list.some((e) => !cache[e.id]);
    if (hasIdle && viewEl.dataset.autoScored !== "true") {
      viewEl.dataset.autoScored = "true";
      checkAll().finally(() => { delete viewEl.dataset.autoScored; });
    }
  }

  async function checkAll() {
    if (!listEl) return;
    const rows = Array.from(listEl.querySelectorAll(".linkedin-fit__row"));
    if (!rows.length) return;
    checkAllBtn.disabled = true;
    const queue = rows.slice();
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const row = queue.shift();
        const id = row.dataset.essayId;
        const store = window.tinkerStore;
        const essay = store && Array.isArray(store.essays)
          ? store.essays.find((e) => e.id === id) : null;
        if (!essay) continue;
        await runCheck(essay, row);
      }
    });
    await Promise.all(workers);
    checkAllBtn.disabled = false;
    // Re-render so fits float to the top now that we have fresh verdicts.
    render();
  }

  // Re-render whenever the view is showing and essays change underneath
  // (publish, delete, hydration from the server).
  function maybeRerender() {
    if (viewEl && !viewEl.hidden) render();
  }
  function onHydrated() {
    // Server pulled a fresh verdict cache into localStorage — re-read
    // it so the view reflects any verdicts scored on another device.
    cache = load();
    maybeRerender();
  }
  window.addEventListener("tinker:writing-saved", maybeRerender);
  window.addEventListener("tinker:hydrated", onHydrated);

  // ── Public API ───────────────────────────────────────────────────────
  window.tinkerLinkedinFit = {
    render,
    /** Clear the cached verdict for an essay (used when the essay's
     *  body changes — currently essays are immutable, but this keeps
     *  the surface honest). */
    clearFor(essayId) {
      if (cache[essayId]) {
        delete cache[essayId];
        save();
      }
    },
  };
})();
