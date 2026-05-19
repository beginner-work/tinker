/* tinker — LinkedIn pitch-shaped draft
 *
 * Stitches verbatim fragments of the founder's published essays into a
 * single LinkedIn-ready post that follows the pitch arc: problem →
 * persona → why now → product. Connective tissue between the verbatim
 * fragments is written by Claude and labelled as such — both on screen
 * (visually) and in the copied text (with [AI: …] markers). The
 * founder's own words appear in quotation marks so the boundary
 * between "I said this" and "AI wrote this" is legible to whoever
 * reads the post.
 *
 * Cached in localStorage["tinker.linkedinPitchDraft.v1"] as a single
 * { segments, essayIds, ts } object so the page paints instantly on
 * return. Auto-regenerates when the set of published essay ids drifts
 * from what produced the cached draft.
 *
 * Entry point: window.tinkerLinkedinFit.render(). Wired in renderer.js.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.linkedinPitchDraft.v1";
  const COPY_LABEL_RESET_MS = 5000;

  const SYSTEM_PROMPT = [
    "You stitch together a single LinkedIn post from a founder's published essays, following the arc of a pitch deck: problem → persona → why now → product.",
    "",
    "The post is a sequence of segments. Each segment is either:",
    "- type 'verbatim': an exact substring of one of the essays (case-sensitive, punctuation included, no paraphrase). Pull the tightest, most concrete fragment — a single sentence or short clause. Always cite the source essay id.",
    "- type 'ai': a short connective sentence in your own voice that introduces, frames, or bridges the verbatim quotes.",
    "",
    "Rules:",
    "- Every 'verbatim' text MUST appear character-for-character inside the cited essay's body. If it doesn't, you must rewrite that segment as 'ai' (don't fake a verbatim).",
    "- The concatenated post should land around 800–1500 characters, total.",
    "- Move from the founder's problem → the persona they're for → why now → what they're building. Drop any beat the essays don't speak to; work with what's there.",
    "- The opening must hook in two lines. Use the strongest first-person line you can find verbatim, or set it up with one short ai segment.",
    "- Do not include essay titles, dates, or meta-commentary about the essays themselves.",
    "- Do not invent facts. AI segments are framing only — no claims, no statistics, no new specifics.",
    "- Prefer fewer, stronger verbatim quotes over many short ones. Aim for 3–6 verbatim segments total.",
    "",
    "Respond as a single JSON object with exactly this shape:",
    '{"segments": [{"type": "verbatim", "text": "...", "essayId": "..."}, {"type": "ai", "text": "..."}, ...]}',
    "",
    "Never wrap in code fences. Never add explanations outside the JSON.",
  ].join("\n");

  // ── Cache ────────────────────────────────────────────────────────────
  let cache = load();
  let inflight = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.segments)) return null;
      return parsed;
    } catch { return null; }
  }
  function save(draft) {
    cache = draft;
    try {
      if (draft === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch { /* ignore */ }
    if (window.tinkerSync && typeof window.tinkerSync.pushLinkedinPitchDraft === "function") {
      window.tinkerSync.pushLinkedinPitchDraft();
    }
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

  // Validate every "verbatim" segment is an exact substring of the
  // cited essay. The model is told this rule but doesn't always obey;
  // demote violators to "ai" so the on-screen attribution stays honest.
  function validateSegments(rawSegments, essaysById) {
    const out = [];
    for (const seg of rawSegments) {
      if (!seg || typeof seg !== "object") continue;
      const text = typeof seg.text === "string" ? seg.text.trim() : "";
      if (!text) continue;
      const type = seg.type === "verbatim" ? "verbatim" : "ai";
      if (type === "verbatim") {
        const essayId = typeof seg.essayId === "string" ? seg.essayId : "";
        const essay = essayId ? essaysById[essayId] : null;
        const body = essay ? String(essay.body || "") : "";
        if (body && body.includes(text)) {
          out.push({ type: "verbatim", text, essayId });
          continue;
        }
        // Model paraphrased or cited the wrong essay — keep the text
        // but relabel it so the reader knows it isn't a real quote.
        out.push({ type: "ai", text });
      } else {
        out.push({ type: "ai", text });
      }
    }
    return out;
  }

  function getEssays() {
    const store = window.tinkerStore;
    if (!store || !Array.isArray(store.essays)) return [];
    return store.essays.slice();
  }

  function essayIdSet(essays) {
    return essays.map((e) => e.id).sort();
  }
  function sameIds(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  async function generate() {
    if (inflight) return inflight;
    const essays = getEssays().filter((e) => String(e.body || "").trim());
    if (!essays.length) {
      save(null);
      return null;
    }
    if (!window.tinker || typeof window.tinker.callClaude !== "function") {
      throw new Error("Anthropic client unavailable. Reload the page.");
    }

    const userParts = ["Essays to stitch from. Each block starts with its id on its own line, then the essay body.\n"];
    for (const essay of essays) {
      userParts.push(`---\nid: ${essay.id}`);
      if (essay.title) userParts.push(`title: ${essay.title}`);
      userParts.push("");
      userParts.push(String(essay.body || ""));
      userParts.push("");
    }

    inflight = (async () => {
      const result = await window.tinker.callClaude({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userParts.join("\n") }],
        model: "claude-sonnet-4-6",
        maxTokens: 2000,
      });
      const parsed = parseJson(result.text);
      if (!parsed || !Array.isArray(parsed.segments)) {
        throw new Error("Couldn't parse the stitched draft.");
      }
      const essaysById = Object.create(null);
      for (const e of essays) essaysById[e.id] = e;
      const segments = validateSegments(parsed.segments, essaysById);
      if (!segments.length) throw new Error("The stitched draft came back empty.");
      const draft = {
        segments,
        essayIds: essayIdSet(essays),
        ts: Date.now(),
      };
      save(draft);
      return draft;
    })().finally(() => { inflight = null; });

    return inflight;
  }

  // ── View ─────────────────────────────────────────────────────────────
  let viewEl = null;
  let draftEl = null;
  let metaEl = null;
  let emptyEl = null;
  let stitchBtn = null;
  let copyBtn = null;

  function mount() {
    viewEl = document.getElementById("linkedin-fit");
    if (!viewEl) return false;
    if (viewEl.dataset.mounted === "true") {
      draftEl = viewEl.querySelector("[data-linkedin-draft]");
      metaEl = viewEl.querySelector("[data-linkedin-meta]");
      emptyEl = viewEl.querySelector("[data-linkedin-empty]");
      stitchBtn = viewEl.querySelector('[data-linkedin-action="stitch"]');
      copyBtn = viewEl.querySelector('[data-linkedin-action="copy"]');
      return true;
    }
    viewEl.innerHTML =
      `<div class="linkedin-fit__inner">` +
        `<header class="linkedin-fit__head">` +
          `<p class="linkedin-fit__crumb">Quiet stitch</p>` +
          `<h1 class="linkedin-fit__title">A pitch-shaped post, stitched from your essays</h1>` +
          `<p class="linkedin-fit__sub">Following the arc of your pitch — problem, persona, why now, product. Your own words sit in quotation marks. The connective tissue is marked [AI] so the boundary is honest, on screen and on LinkedIn.</p>` +
          `<div class="linkedin-fit__head-actions">` +
            `<button type="button" class="linkedin-fit__check-all" data-linkedin-action="stitch">Stitch a new draft</button>` +
            `<button type="button" class="linkedin-fit__check linkedin-fit__post" data-linkedin-action="copy" hidden>Copy to clipboard</button>` +
          `</div>` +
        `</header>` +
        `<div class="linkedin-fit__draft" data-linkedin-draft></div>` +
        `<p class="linkedin-fit__meta" data-linkedin-meta hidden></p>` +
        `<p class="linkedin-fit__empty" data-linkedin-empty hidden>No published essays yet. Finish a draft first.</p>` +
      `</div>`;
    draftEl = viewEl.querySelector("[data-linkedin-draft]");
    metaEl = viewEl.querySelector("[data-linkedin-meta]");
    emptyEl = viewEl.querySelector("[data-linkedin-empty]");
    stitchBtn = viewEl.querySelector('[data-linkedin-action="stitch"]');
    copyBtn = viewEl.querySelector('[data-linkedin-action="copy"]');
    stitchBtn.addEventListener("click", () => runGenerate());
    copyBtn.addEventListener("click", () => copyDraft());
    viewEl.dataset.mounted = "true";
    return true;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function renderSegments(segments) {
    const html = segments.map((seg) => {
      if (seg.type === "verbatim") {
        return `<span class="linkedin-fit__seg linkedin-fit__seg--you">${escapeHtml(seg.text)}</span>`;
      }
      return `<span class="linkedin-fit__seg linkedin-fit__seg--ai">` +
        `<span class="linkedin-fit__seg-tag" aria-hidden="true">AI</span>` +
        escapeHtml(seg.text) +
        `</span>`;
    }).join(" ");
    return html;
  }

  // Clipboard format: verbatim segments wrapped in straight quotes,
  // AI segments wrapped in [AI: …]. What you paste into LinkedIn shows
  // the boundary to whoever reads it.
  function segmentsToClipboardText(segments) {
    return segments.map((seg) => {
      const text = seg.text.trim();
      if (seg.type === "verbatim") return `"${text}"`;
      return `[AI: ${text}]`;
    }).join(" ");
  }

  function formatStitchedTimestamp(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    if (diff < 60_000) return "Stitched just now";
    if (diff < 3_600_000) return `Stitched ${Math.round(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `Stitched ${Math.round(diff / 3_600_000)} h ago`;
    return `Stitched ${Math.round(diff / 86_400_000)} d ago`;
  }

  function showLoading() {
    draftEl.innerHTML =
      `<div class="linkedin-fit__loading">` +
        `<div class="thinking-dots" aria-hidden="true">` +
          `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>` +
        `</div>` +
      `</div>`;
    metaEl.hidden = true;
    copyBtn.hidden = true;
    stitchBtn.disabled = true;
    stitchBtn.textContent = "Stitching…";
  }

  function showError(message) {
    draftEl.innerHTML =
      `<p class="linkedin-fit__verdict-label linkedin-fit__verdict-label--err">Couldn't stitch a draft.</p>` +
      `<p class="linkedin-fit__verdict-reason">${escapeHtml(message)}</p>`;
    metaEl.hidden = true;
    copyBtn.hidden = true;
    stitchBtn.disabled = false;
    stitchBtn.textContent = "Try again";
  }

  function showDraft(draft) {
    draftEl.innerHTML = renderSegments(draft.segments);
    metaEl.textContent = formatStitchedTimestamp(draft.ts);
    metaEl.hidden = false;
    copyBtn.hidden = false;
    stitchBtn.disabled = false;
    stitchBtn.textContent = "Stitch a new draft";
  }

  function showEmpty() {
    draftEl.innerHTML = "";
    metaEl.hidden = true;
    copyBtn.hidden = true;
    stitchBtn.hidden = true;
    emptyEl.hidden = false;
  }

  async function runGenerate() {
    showLoading();
    try {
      const draft = await generate();
      if (!draft) { showEmpty(); return; }
      showDraft(draft);
    } catch (err) {
      showError((err && err.message) || "Try again.");
    }
  }

  async function copyDraft() {
    if (!cache || !Array.isArray(cache.segments)) return;
    const text = segmentsToClipboardText(cache.segments);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); }
      catch { fallbackCopy(text); }
    } else {
      fallbackCopy(text);
    }
    copyBtn.textContent = "Copied";
    clearTimeout(copyBtn._labelTimer);
    copyBtn._labelTimer = setTimeout(() => {
      copyBtn.textContent = "Copy to clipboard";
    }, COPY_LABEL_RESET_MS);
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

  function render() {
    if (!mount()) return;
    const essays = getEssays().filter((e) => String(e.body || "").trim());
    if (!essays.length) {
      showEmpty();
      delete viewEl.dataset.autoStitched;
      return;
    }
    emptyEl.hidden = true;
    stitchBtn.hidden = false;

    const currentIds = essayIdSet(essays);
    const haveDraft = cache && Array.isArray(cache.segments) && cache.segments.length;
    const draftIsStale = !haveDraft || !sameIds(cache.essayIds || [], currentIds);

    if (haveDraft) {
      showDraft(cache);
    } else {
      draftEl.innerHTML = "";
      metaEl.hidden = true;
      copyBtn.hidden = true;
      stitchBtn.disabled = false;
      stitchBtn.textContent = "Stitch a new draft";
    }

    // Auto-stitch on first arrival and whenever the published essay
    // set has shifted out from under the cached draft. The flag
    // prevents re-renders during the call from kicking off a second
    // stitch; it clears when the call finishes.
    if (draftIsStale && viewEl.dataset.autoStitched !== "true") {
      viewEl.dataset.autoStitched = "true";
      runGenerate().finally(() => { delete viewEl.dataset.autoStitched; });
    }
  }

  function maybeRerender() {
    if (viewEl && !viewEl.hidden) render();
  }
  function onHydrated() {
    cache = load();
    maybeRerender();
  }
  window.addEventListener("tinker:writing-saved", maybeRerender);
  window.addEventListener("tinker:hydrated", onHydrated);

  // ── Public API ───────────────────────────────────────────────────────
  window.tinkerLinkedinFit = { render };
})();
