/* tinker — LinkedIn pitch-shaped draft
 *
 * Stitches verbatim fragments of the founder's published essays into a
 * single LinkedIn-ready post that follows the pitch arc: problem →
 * persona → why now → product. The founder's own words flow through
 * the tinker rainbow; AI connective tissue is muted and labelled.
 * The boundary is carried by colour, not brackets.
 *
 * The page is image-first. The stitched draft is rendered straight to
 * tinker-branded PNG images (1080×1080, paginated) and the page
 * preview shows those images — not the text. A compact copy-pill
 * surfaces a snippet of the founder's verbatim words; click it to
 * copy the full verbatim string as the LinkedIn caption.
 *
 * Cached in localStorage["tinker.linkedinPitchDraft.v1"].
 *
 * Entry point: window.tinkerLinkedinFit.render(). Wired in renderer.js.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.linkedinPitchDraft.v1";
  const COPY_LABEL_RESET_MS = 5000;
  const COPY_PREVIEW_MAX_CHARS = 56;

  // Tinker's rainbow — same palette as src/renderer/icons/tinker-mark.svg.
  const TINKER_RAINBOW = [
    "#F9A8D4", // pink
    "#FDBA74", // orange
    "#FDE68A", // yellow
    "#7BC47A", // leaf
    "#7DD3FC", // sky
    "#6EE7B7", // mint
    "#C8B6E2", // purple
  ];

  // The actual tinker mark, inlined so we can draw it onto the canvas
  // image without a network fetch. Mirrors src/renderer/icons/tinker-mark.svg.
  const TINKER_MARK_SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">',
    '<circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/>',
    '<line x1="34.18" y1="62" x2="165.82" y2="62" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/>',
    '<line x1="24" y1="100" x2="176" y2="100" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/>',
    '<line x1="34.18" y1="138" x2="165.82" y2="138" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/>',
    '<ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/>',
    '<ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/>',
    '<line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/>',
    '</svg>',
  ].join("");

  // Image canvas constants. Square reads well on LinkedIn mobile feeds.
  // Type follows tinker's design system: Fraunces for the founder's
  // own words (display), Instrument Sans for the AI connecting tissue
  // and the chrome. SOFT/WONK/opsz are pushed through CSS on the
  // canvas element below — Fraunces falls back to Plus Jakarta Sans /
  // Georgia if Fraunces isn't loaded yet.
  const IMG_W = 1080;
  const IMG_H = 1080;
  const IMG_MARGIN = 90;
  const IMG_HEADER_H = 130;
  const IMG_FOOTER_RESERVE = 230;
  const IMG_BODY_TOP = IMG_HEADER_H + 30;
  const IMG_BODY_BOTTOM = IMG_H - IMG_FOOTER_RESERVE;
  const IMG_BODY_LINE_HEIGHT = 62;
  const IMG_VERBATIM_FONT = "700 40px 'Fraunces', 'Plus Jakarta Sans', Georgia, 'Times New Roman', serif";
  const IMG_AI_FONT = "500 36px 'Instrument Sans', 'Inter', system-ui, sans-serif";
  const IMG_WORDMARK_FONT = "700 30px 'Fraunces', 'Plus Jakarta Sans', Georgia, serif";
  const IMG_BRAND_FOOTER_FONT = "700 26px 'Fraunces', 'Plus Jakarta Sans', Georgia, serif";
  const IMG_META_FONT = "500 22px 'Instrument Sans', 'Inter', system-ui, sans-serif";
  const IMG_LEGEND_FONT = "500 22px 'Instrument Sans', 'Inter', system-ui, sans-serif";
  // Fraunces axes — "warm-paper, not brutalist" per design-tokens.css.
  const IMG_FONT_VARIATION_SETTINGS = '"SOFT" 100, "WONK" 0, "opsz" 144';
  const IMG_BG = "#fffdf7";
  const IMG_AI_COLOR = "#9a948a";
  const IMG_BRAND_COLOR = "#2d5a3d";
  const IMG_SUB_COLOR = "#6f6a65";
  const IMG_LINE_COLOR = "#ede8e0";

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
    "- AI segments must NEVER use first-person words. Banned: 'I' (capital, standalone), 'I'm', 'I've', 'I'll', 'I'd', 'my', 'mine', 'me', 'myself'. The first person belongs to the founder; AI segments speak about the founder or about the work in third person or impersonal voice. 'The founder…' is fine. 'Tinker…' is fine. 'My / me / I…' is not.",
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

  // The first person belongs to the founder. AI segments that reach
  // for it get dropped — both the capital-I family (I, I'm, I've,
  // I'll, I'd) and the my / me / mine / myself family, case-
  // insensitive on the latter. Whole-word matches only, so "it",
  // "in", "remember", "items" don't trip the filter.
  const AI_FIRST_PERSON_I = /\bI(?:'(?:m|ve|ll|d|s))?\b/;
  const AI_FIRST_PERSON_PRONOUNS = /\b(?:my|mine|me|myself)\b/i;
  function aiSegmentBannedFirstPerson(text) {
    return AI_FIRST_PERSON_I.test(text) || AI_FIRST_PERSON_PRONOUNS.test(text);
  }

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
        // Paraphrased — demoted to ai, but the first-person rule
        // still applies on the demoted segment.
        if (aiSegmentBannedFirstPerson(text)) continue;
        out.push({ type: "ai", text });
      } else {
        // The first person belongs to the founder. Any AI segment
        // that uses "I" or the my-family gets dropped.
        if (aiSegmentBannedFirstPerson(text)) continue;
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

  // ── Font + mark preload ──────────────────────────────────────────────
  // Canvas falls back to system fonts unless the web fonts have been
  // loaded explicitly. document.fonts.load() forces the load and
  // resolves once the font is in the registry. We trigger it once per
  // session and gate every render on it so the saved PNGs and the
  // page previews use the same typography the rest of tinker uses.
  let fontsReady = null;
  function ensureFonts() {
    if (fontsReady) return fontsReady;
    if (!document.fonts) { fontsReady = Promise.resolve(); return fontsReady; }
    fontsReady = (async () => {
      try {
        await Promise.all([
          document.fonts.load("700 40px 'Fraunces'"),
          document.fonts.load("700 30px 'Fraunces'"),
          document.fonts.load("700 26px 'Fraunces'"),
          document.fonts.load("500 36px 'Instrument Sans'"),
          document.fonts.load("500 22px 'Instrument Sans'"),
          // Fallback faces — preloaded so the canvas never blocks on
          // network if Fraunces / Instrument Sans haven't arrived.
          document.fonts.load("700 40px 'Plus Jakarta Sans'"),
          document.fonts.load("500 22px 'Inter'"),
        ]);
        if (document.fonts.ready) await document.fonts.ready;
      } catch { /* fall through to system fonts */ }
    })();
    return fontsReady;
  }

  let tinkerMarkPromise = null;
  function ensureTinkerMark() {
    if (tinkerMarkPromise) return tinkerMarkPromise;
    tinkerMarkPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(TINKER_MARK_SVG);
    });
    return tinkerMarkPromise;
  }

  // ── View ─────────────────────────────────────────────────────────────
  let viewEl = null;
  let draftEl = null;
  let metaEl = null;
  let emptyEl = null;
  let stitchBtn = null;
  let saveBtn = null;
  let copyBtn = null;
  let copyPreviewEl = null;

  // Rendered-image cache so we don't re-render every time the user
  // navigates back to the page. Keyed on draft.ts.
  let renderedBlobs = null;
  let renderedBlobsForTs = 0;
  let renderedUrls = [];
  function clearRenderedUrls() {
    for (const url of renderedUrls) URL.revokeObjectURL(url);
    renderedUrls = [];
  }

  const COPY_ICON_SVG =
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<rect x="8" y="3" width="11" height="4" rx="1"/>` +
    `<path d="M16 5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>` +
    `</svg>`;

  function mount() {
    viewEl = document.getElementById("linkedin-fit");
    if (!viewEl) return false;
    if (viewEl.dataset.mounted === "true") {
      draftEl = viewEl.querySelector("[data-linkedin-draft]");
      metaEl = viewEl.querySelector("[data-linkedin-meta]");
      emptyEl = viewEl.querySelector("[data-linkedin-empty]");
      stitchBtn = viewEl.querySelector('[data-linkedin-action="stitch"]');
      saveBtn = viewEl.querySelector('[data-linkedin-action="save"]');
      copyBtn = viewEl.querySelector('[data-linkedin-action="copy"]');
      copyPreviewEl = copyBtn && copyBtn.querySelector('[data-role="copy-preview"]');
      return true;
    }
    viewEl.innerHTML =
      `<div class="linkedin-fit__inner">` +
        `<header class="linkedin-fit__head">` +
          `<p class="linkedin-fit__crumb">Quiet stitch</p>` +
          `<h1 class="linkedin-fit__title">A pitch-shaped post, stitched from your essays</h1>` +
          `<p class="linkedin-fit__sub">Following the arc of your pitch — problem, persona, why now, product. Your words flow through the tinker rainbow on the saved images. Tap the copy pill to lift just your verbatim words as the LinkedIn caption.</p>` +
          `<div class="linkedin-fit__head-actions">` +
            `<button type="button" class="linkedin-fit__check-all" data-linkedin-action="stitch">Stitch a new draft</button>` +
            `<button type="button" class="linkedin-fit__check linkedin-fit__post" data-linkedin-action="save" hidden>Save image</button>` +
            `<button type="button" class="linkedin-fit__copy-pill" data-linkedin-action="copy" title="Copy my words" aria-label="Copy my words" hidden>` +
              COPY_ICON_SVG +
              `<span class="linkedin-fit__copy-preview" data-role="copy-preview"></span>` +
            `</button>` +
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
    saveBtn = viewEl.querySelector('[data-linkedin-action="save"]');
    copyBtn = viewEl.querySelector('[data-linkedin-action="copy"]');
    copyPreviewEl = copyBtn.querySelector('[data-role="copy-preview"]');
    stitchBtn.addEventListener("click", () => runGenerate());
    saveBtn.addEventListener("click", () => saveDraftImages());
    copyBtn.addEventListener("click", () => copyMyWords());
    viewEl.dataset.mounted = "true";
    return true;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function formatStitchedTimestamp(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    if (diff < 60_000) return "Stitched just now";
    if (diff < 3_600_000) return `Stitched ${Math.round(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `Stitched ${Math.round(diff / 3_600_000)} h ago`;
    return `Stitched ${Math.round(diff / 86_400_000)} d ago`;
  }

  function verbatimSnippet(segments) {
    const first = segments.find((s) => s.type === "verbatim");
    if (!first) return "Copy my words";
    const t = first.text.trim();
    if (t.length <= COPY_PREVIEW_MAX_CHARS) return `"${t}"`;
    return `"${t.slice(0, COPY_PREVIEW_MAX_CHARS).trim()}…"`;
  }

  function showLoading() {
    clearRenderedUrls();
    draftEl.innerHTML =
      `<div class="linkedin-fit__loading">` +
        `<div class="thinking-dots" aria-hidden="true">` +
          `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>` +
        `</div>` +
      `</div>`;
    metaEl.hidden = true;
    saveBtn.hidden = true;
    copyBtn.hidden = true;
    stitchBtn.disabled = true;
    stitchBtn.textContent = "Stitching…";
  }

  function showError(message) {
    clearRenderedUrls();
    draftEl.innerHTML =
      `<p class="linkedin-fit__verdict-label linkedin-fit__verdict-label--err">Couldn't stitch a draft.</p>` +
      `<p class="linkedin-fit__verdict-reason">${escapeHtml(message)}</p>`;
    metaEl.hidden = true;
    saveBtn.hidden = true;
    copyBtn.hidden = true;
    stitchBtn.disabled = false;
    stitchBtn.textContent = "Try again";
  }

  async function showDraft(draft) {
    metaEl.textContent = formatStitchedTimestamp(draft.ts);
    metaEl.hidden = false;
    stitchBtn.disabled = false;
    stitchBtn.textContent = "Stitch a new draft";
    if (copyPreviewEl) copyPreviewEl.textContent = verbatimSnippet(draft.segments);
    copyBtn.hidden = false;

    // Spinner while images render — first paint can take a beat.
    clearRenderedUrls();
    draftEl.innerHTML =
      `<div class="linkedin-fit__loading">` +
        `<div class="thinking-dots" aria-hidden="true">` +
          `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>` +
        `</div>` +
      `</div>`;

    let blobs;
    try {
      blobs = await ensureRendered(draft);
    } catch (err) {
      showError((err && err.message) || "Couldn't render the post.");
      return;
    }
    if (!blobs.length) {
      draftEl.innerHTML = "";
      return;
    }

    const urls = blobs.map((b) => URL.createObjectURL(b));
    renderedUrls = urls;
    const total = blobs.length;
    draftEl.innerHTML =
      `<div class="linkedin-fit__previews">` +
      urls.map((url, i) =>
        `<figure class="linkedin-fit__preview-frame">` +
          `<img class="linkedin-fit__preview" src="${url}" alt="tinker pitch page ${i + 1} of ${total}" />` +
          (total > 1
            ? `<figcaption class="linkedin-fit__preview-caption">${i + 1} / ${total}</figcaption>`
            : "") +
        `</figure>`
      ).join("") +
      `</div>`;

    saveBtn.hidden = false;
    saveBtn.textContent = total > 1 ? "Save images" : "Save image";
  }

  function showEmpty() {
    clearRenderedUrls();
    draftEl.innerHTML = "";
    metaEl.hidden = true;
    saveBtn.hidden = true;
    copyBtn.hidden = true;
    stitchBtn.hidden = true;
    emptyEl.hidden = false;
  }

  async function runGenerate() {
    showLoading();
    try {
      const draft = await generate();
      if (!draft) { showEmpty(); return; }
      await showDraft(draft);
    } catch (err) {
      showError((err && err.message) || "Try again.");
    }
  }

  // ── Clipboard: founder's verbatim words only ─────────────────────────
  async function copyMyWords() {
    if (!cache || !Array.isArray(cache.segments)) return;
    const text = cache.segments
      .filter((s) => s.type === "verbatim")
      .map((s) => s.text.trim())
      .join(" ");
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); }
      catch { fallbackCopy(text); }
    } else {
      fallbackCopy(text);
    }
    if (copyPreviewEl) {
      const original = copyPreviewEl.textContent;
      copyPreviewEl.textContent = "Copied";
      clearTimeout(copyBtn._labelTimer);
      copyBtn._labelTimer = setTimeout(() => {
        copyPreviewEl.textContent = original;
      }, COPY_LABEL_RESET_MS);
    }
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

  // ── Image generation ─────────────────────────────────────────────────
  function buildAtoms(segments) {
    const atoms = [];
    let rainbowIdx = 0;
    for (const seg of segments) {
      const words = seg.text.split(/\s+/).filter(Boolean);
      if (seg.type === "verbatim") {
        for (const w of words) {
          atoms.push({
            text: w,
            color: TINKER_RAINBOW[rainbowIdx % TINKER_RAINBOW.length],
            font: IMG_VERBATIM_FONT,
          });
          rainbowIdx++;
        }
      } else {
        for (const w of words) {
          atoms.push({ text: w, color: IMG_AI_COLOR, font: IMG_AI_FONT });
        }
      }
    }
    return atoms;
  }

  function paginateAtoms(atoms) {
    const measure = document.createElement("canvas");
    measure.width = IMG_W; measure.height = IMG_H;
    const mctx = measure.getContext("2d");

    const pages = [];
    let page = [];
    let x = IMG_MARGIN;
    let y = IMG_BODY_TOP + Math.round(IMG_BODY_LINE_HEIGHT * 0.7);
    const maxX = IMG_W - IMG_MARGIN;

    function flushPage() {
      pages.push(page);
      page = [];
      x = IMG_MARGIN;
      y = IMG_BODY_TOP + Math.round(IMG_BODY_LINE_HEIGHT * 0.7);
    }

    for (const atom of atoms) {
      mctx.font = atom.font;
      const wordW = mctx.measureText(atom.text).width;
      const atLineStart = x <= IMG_MARGIN + 0.5;
      const spaceW = atLineStart ? 0 : mctx.measureText(" ").width;
      if (x + spaceW + wordW > maxX) {
        x = IMG_MARGIN;
        y += IMG_BODY_LINE_HEIGHT;
        if (y > IMG_BODY_BOTTOM) flushPage();
      }
      if (x > IMG_MARGIN) x += spaceW;
      page.push({ text: atom.text, color: atom.color, font: atom.font, x, y });
      x += wordW;
    }
    if (page.length) pages.push(page);
    return pages;
  }

  function drawHeader(ctx, pageNum, totalPages, mark) {
    const markSize = 56;
    const markX = IMG_MARGIN;
    const markY = 40;
    if (mark) ctx.drawImage(mark, markX, markY, markSize, markSize);

    ctx.fillStyle = IMG_BRAND_COLOR;
    ctx.font = IMG_WORDMARK_FONT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("tinker", markX + markSize + 14, markY + markSize / 2 + 1);

    if (totalPages > 1) {
      ctx.fillStyle = IMG_SUB_COLOR;
      ctx.font = IMG_META_FONT;
      ctx.textAlign = "right";
      ctx.fillText(`${pageNum} / ${totalPages}`, IMG_W - IMG_MARGIN, markY + markSize / 2 + 1);
      ctx.textAlign = "left";
    }
  }

  function drawFooter(ctx) {
    const y0 = IMG_H - IMG_FOOTER_RESERVE + 30;
    ctx.strokeStyle = IMG_LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(IMG_MARGIN, y0);
    ctx.lineTo(IMG_W - IMG_MARGIN, y0);
    ctx.stroke();

    ctx.fillStyle = IMG_BRAND_COLOR;
    ctx.font = IMG_BRAND_FOOTER_FONT;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText("Created by tinker", IMG_MARGIN, y0 + 42);

    // Legend lines — same length on both rows so the eye lines them
    // up. The verbatim row is the tinker spectrum (same horizontal
    // stripe vocabulary as the home-page mark, laid out as one
    // continuous line). The AI row is a single muted stripe.
    const lineLen = 180;
    const lineThickness = 10;
    const labelGap = 18;
    const verbatimY = y0 + 96;
    const aiY = verbatimY + 38;

    const grad = ctx.createLinearGradient(IMG_MARGIN, 0, IMG_MARGIN + lineLen, 0);
    for (let i = 0; i < TINKER_RAINBOW.length; i++) {
      grad.addColorStop(i / (TINKER_RAINBOW.length - 1), TINKER_RAINBOW[i]);
    }
    ctx.strokeStyle = grad;
    ctx.lineWidth = lineThickness;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(IMG_MARGIN + lineThickness / 2, verbatimY);
    ctx.lineTo(IMG_MARGIN + lineLen - lineThickness / 2, verbatimY);
    ctx.stroke();

    ctx.strokeStyle = IMG_AI_COLOR;
    ctx.lineWidth = lineThickness;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(IMG_MARGIN + lineThickness / 2, aiY);
    ctx.lineTo(IMG_MARGIN + lineLen - lineThickness / 2, aiY);
    ctx.stroke();

    ctx.fillStyle = IMG_SUB_COLOR;
    ctx.font = IMG_LEGEND_FONT;
    ctx.textBaseline = "middle";
    ctx.fillText("the founder's own words, verbatim", IMG_MARGIN + lineLen + labelGap, verbatimY);
    ctx.fillText("connecting tissue, AI-written",     IMG_MARGIN + lineLen + labelGap, aiY);
    ctx.textBaseline = "alphabetic";
  }

  // Attach the canvas to the DOM (offscreen) and set
  // font-variation-settings on the element. Browsers that honour the
  // element's font CSS during canvas text drawing will pick up the
  // SOFT / WONK / opsz axes; others render Fraunces at its default
  // axes, which is still correct typeface, just not the warm-paper
  // tuning the design system specifies.
  function createPageCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = IMG_W;
    canvas.height = IMG_H;
    canvas.style.position = "absolute";
    canvas.style.left = "-99999px";
    canvas.style.top = "0";
    canvas.style.fontVariationSettings = IMG_FONT_VARIATION_SETTINGS;
    document.body.appendChild(canvas);
    return canvas;
  }

  async function renderImages(segments) {
    await ensureFonts();
    const mark = await ensureTinkerMark();
    const atoms = buildAtoms(segments);
    const pages = paginateAtoms(atoms);
    const blobs = [];
    for (let p = 0; p < pages.length; p++) {
      const canvas = createPageCanvas();
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = IMG_BG;
      ctx.fillRect(0, 0, IMG_W, IMG_H);
      drawHeader(ctx, p + 1, pages.length, mark);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      for (const a of pages[p]) {
        ctx.font = a.font;
        ctx.fillStyle = a.color;
        ctx.fillText(a.text, a.x, a.y);
      }
      if (p === pages.length - 1) drawFooter(ctx);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      canvas.parentNode && canvas.parentNode.removeChild(canvas);
      if (blob) blobs.push(blob);
    }
    return blobs;
  }

  async function ensureRendered(draft) {
    if (renderedBlobsForTs === draft.ts && renderedBlobs) return renderedBlobs;
    const blobs = await renderImages(draft.segments);
    renderedBlobs = blobs;
    renderedBlobsForTs = draft.ts;
    return blobs;
  }

  async function saveDraftImages() {
    if (!cache || !Array.isArray(cache.segments)) return;
    saveBtn.disabled = true;
    const fallbackLabel = (n) => (n > 1 ? "Save images" : "Save image");
    let blobs;
    try {
      blobs = await ensureRendered(cache);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = fallbackLabel(1);
      showError((err && err.message) || "Image render failed.");
      return;
    }
    if (!blobs.length) {
      saveBtn.disabled = false;
      saveBtn.textContent = fallbackLabel(1);
      return;
    }
    saveBtn.textContent = fallbackLabel(blobs.length);

    const files = blobs.map((blob, i) =>
      new File([blob], `tinker-pitch-${i + 1}.png`, { type: "image/png" })
    );

    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title: "tinker pitch" });
        saveBtn.disabled = false;
        saveBtn.textContent = "Saved";
        clearTimeout(saveBtn._labelTimer);
        saveBtn._labelTimer = setTimeout(() => {
          saveBtn.textContent = fallbackLabel(blobs.length);
        }, COPY_LABEL_RESET_MS);
        return;
      } catch (err) {
        if (err && err.name === "AbortError") {
          saveBtn.disabled = false;
          saveBtn.textContent = fallbackLabel(blobs.length);
          return;
        }
        // fall through to download
      }
    }

    for (const file of files) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    saveBtn.disabled = false;
    saveBtn.textContent = "Saved";
    clearTimeout(saveBtn._labelTimer);
    saveBtn._labelTimer = setTimeout(() => {
      saveBtn.textContent = fallbackLabel(blobs.length);
    }, COPY_LABEL_RESET_MS);
  }

  // ── Render ───────────────────────────────────────────────────────────
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
      // Fire and forget — showDraft awaits image rendering internally.
      showDraft(cache);
    } else {
      clearRenderedUrls();
      draftEl.innerHTML = "";
      metaEl.hidden = true;
      saveBtn.hidden = true;
      copyBtn.hidden = true;
      stitchBtn.disabled = false;
      stitchBtn.textContent = "Stitch a new draft";
    }

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
    // The server may have given us a fresh draft; drop the rendered
    // cache so the previews re-render from the new segments.
    renderedBlobs = null;
    renderedBlobsForTs = 0;
    maybeRerender();
  }
  window.addEventListener("tinker:writing-saved", maybeRerender);
  window.addEventListener("tinker:hydrated", onHydrated);

  // ── Public API ───────────────────────────────────────────────────────
  window.tinkerLinkedinFit = { render };
})();
