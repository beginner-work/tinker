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

  const SYSTEM_PROMPT = [
    "You read a founder's essay and decide whether it could work as a LinkedIn post.",
    "",
    "A good LinkedIn post:",
    "- Has one concrete moment, story, or insight that a stranger scrolling past could land in within the first two lines.",
    "- Has a 'what I learned' or 'what I noticed' beat that travels beyond the writer's private context.",
    "- Is not purely a journal entry — there is something for the reader to take with them.",
    "",
    "For the essay, decide:",
    "1. fit (boolean) — would this make a good LinkedIn post?",
    "2. reason (string, one sentence, plain language) — why it does or doesn't fit. No marketing words.",
    "3. picture_subject (string or null) — only when fit is true: a short concrete noun phrase naming the most visually salient thing in the essay that the founder might already have a picture of. Examples: 'the napkin sketch you mentioned', 'your kitchen counter from that morning', 'the dashboard on your laptop', 'the receipt you crumpled', 'the view from where you were sitting'. Always something the founder could plausibly have photographed in their normal life. Never a stock image. Never generic ('your computer'). Make it specific to this essay.",
    "4. picture_question (string or null) — only when fit is true: a single question to the founder, starting with 'Do you have a picture of', that names the subject and adds one short reason it would help the reader. 22 words or fewer. End with a question mark.",
    "",
    "Respond as a single JSON object with exactly these four keys. Never wrap in code fences. Never add explanations outside the JSON.",
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
    const pictureSubject = fit && typeof parsed.picture_subject === "string"
      ? parsed.picture_subject.trim() || null
      : null;
    const pictureQuestion = fit && typeof parsed.picture_question === "string"
      ? parsed.picture_question.trim() || null
      : null;
    return {
      fit,
      reason,
      pictureSubject,
      pictureQuestion,
      ts: Date.now(),
    };
  }

  async function checkEssay(essay) {
    if (!essay || !essay.id) return null;
    if (inflight[essay.id]) return inflight[essay.id];

    const body = String(essay.body || "").trim();
    if (!body) {
      const empty = {
        fit: false,
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
          `<h1 class="linkedin-fit__title">Could any of these be LinkedIn posts?</h1>` +
          `<p class="linkedin-fit__sub">A short read through each essay. The fits float to the top. For each fit, a small question about a picture that might help readers land in it.</p>` +
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

  function sortedEssays() {
    return getEssays().sort((a, b) => {
      const fa = cache[a.id], fb = cache[b.id];
      const sa = (fa && fa.fit) ? 2 : fa ? 1 : 0;
      const sb = (fb && fb.fit) ? 2 : fb ? 1 : 0;
      if (sa !== sb) return sb - sa;
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
    const check = document.createElement("button");
    check.type = "button";
    check.className = "linkedin-fit__check";
    check.dataset.role = "check";
    actions.appendChild(check);
    row.appendChild(actions);

    refreshRow(row, essay);
    check.addEventListener("click", () => runCheck(essay, row));
    return row;
  }

  function refreshRow(row, essay) {
    const verdict = row.querySelector('[data-role="verdict"]');
    const check = row.querySelector('[data-role="check"]');
    const cached = cache[essay.id];
    if (!cached) {
      verdict.innerHTML = `<p class="linkedin-fit__verdict-meta">Not read yet.</p>`;
      check.textContent = "Read this one";
      check.disabled = false;
      row.dataset.state = "idle";
      return;
    }
    if (cached.fit) {
      const picture = cached.pictureQuestion
        ? `<p class="linkedin-fit__picture">${escapeHtml(cached.pictureQuestion)}</p>`
        : "";
      verdict.innerHTML =
        `<p class="linkedin-fit__verdict-label">Could be a LinkedIn post.</p>` +
        `<p class="linkedin-fit__verdict-reason">${escapeHtml(cached.reason)}</p>` +
        picture;
      row.dataset.state = "fit";
    } else {
      verdict.innerHTML =
        `<p class="linkedin-fit__verdict-label linkedin-fit__verdict-label--miss">Better kept as an essay.</p>` +
        `<p class="linkedin-fit__verdict-reason">${escapeHtml(cached.reason)}</p>`;
      row.dataset.state = "miss";
    }
    check.textContent = "Read again";
    check.disabled = false;
  }

  async function runCheck(essay, row) {
    const verdict = row.querySelector('[data-role="verdict"]');
    const check = row.querySelector('[data-role="check"]');
    check.disabled = true;
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
    refreshRow(row, essay);
  }

  function render() {
    if (!mount()) return;
    const list = sortedEssays();
    pruneCache(list.map((e) => e.id));
    listEl.innerHTML = "";
    if (list.length === 0) {
      emptyEl.hidden = false;
      checkAllBtn.disabled = true;
      return;
    }
    emptyEl.hidden = true;
    checkAllBtn.disabled = false;
    for (const essay of list) {
      listEl.appendChild(renderRow(essay));
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
  window.addEventListener("tinker:writing-saved", maybeRerender);
  window.addEventListener("tinker:hydrated", maybeRerender);

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
