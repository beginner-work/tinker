/* tinker — LinkedIn pitch-shaped draft
 *
 * Stitches verbatim fragments of the founder's published essays into a
 * single LinkedIn-ready post that follows the pitch arc: problem →
 * persona → why now → product. The founder's own words flow through
 * the tinker rainbow on screen and appear in colored ink on the
 * generated images; AI connective tissue is muted and labelled. The
 * boundary between "I said this" and "AI wrote this" is carried by
 * colour, not brackets, so what posts to LinkedIn reads cleanly.
 *
 * The page produces two things:
 *   1. One or more tinker-branded PNG images, sized for LinkedIn
 *      (1080×1080), saveable to camera roll via Web Share or
 *      download. The last image carries the "Created by tinker" footer
 *      and a legend explaining the colour code.
 *   2. A clipboard payload of the founder's verbatim words only —
 *      no AI connective tissue, no quotation marks, no brackets — so
 *      the founder can paste their own writing as the LinkedIn post
 *      caption alongside the images.
 *
 * Cached in localStorage["tinker.linkedinPitchDraft.v1"] as a single
 * { segments, essayIds, ts } object. Auto-regenerates when the set of
 * published essay ids drifts from what produced the cached draft.
 *
 * Entry point: window.tinkerLinkedinFit.render(). Wired in renderer.js.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.linkedinPitchDraft.v1";
  const COPY_LABEL_RESET_MS = 5000;

  // Tinker's rainbow — same palette as the brand logo. Used both for
  // the on-screen live shader and the per-word colour rotation in the
  // generated images.
  const TINKER_RAINBOW = [
    "#f9a8d4", // pink
    "#fdba74", // orange
    "#fde68a", // yellow
    "#7bc47a", // leaf
    "#7dd3fc", // sky
    "#6ee7b7", // mint
    "#c8b6e2", // purple
  ];

  // Image canvas constants. Square is LinkedIn-friendly and reads well
  // on mobile feeds.
  const IMG_W = 1080;
  const IMG_H = 1080;
  const IMG_MARGIN = 90;
  const IMG_HEADER_H = 110;
  const IMG_FOOTER_RESERVE = 220; // bottom reserve on every page
  const IMG_BODY_TOP = IMG_HEADER_H + 40;
  const IMG_BODY_BOTTOM = IMG_H - IMG_FOOTER_RESERVE;
  const IMG_BODY_LINE_HEIGHT = 62;
  const IMG_VERBATIM_FONT = "700 40px 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
  const IMG_AI_FONT = "italic 36px 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
  const IMG_BG = "#fffdf7";
  const IMG_AI_COLOR = "#9a948a";
  const IMG_BRAND_COLOR = "#2d5a3d";
  const IMG_SUB_COLOR = "#6f6a65";

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
  let saveBtn = null;
  let copyBtn = null;

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
      return true;
    }
    viewEl.innerHTML =
      `<div class="linkedin-fit__inner">` +
        `<header class="linkedin-fit__head">` +
          `<p class="linkedin-fit__crumb">Quiet stitch</p>` +
          `<h1 class="linkedin-fit__title">A pitch-shaped post, stitched from your essays</h1>` +
          `<p class="linkedin-fit__sub">Following the arc of your pitch — problem, persona, why now, product. Your words flow through the tinker rainbow; the connective tissue is muted so the boundary is honest, on screen and on the saved images.</p>` +
          `<div class="linkedin-fit__head-actions">` +
            `<button type="button" class="linkedin-fit__check-all" data-linkedin-action="stitch">Stitch a new draft</button>` +
            `<button type="button" class="linkedin-fit__check linkedin-fit__post" data-linkedin-action="save" hidden>Save image</button>` +
            `<button type="button" class="linkedin-fit__check linkedin-fit__post" data-linkedin-action="copy" hidden>Copy my words</button>` +
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

  function renderSegments(segments) {
    return segments.map((seg) => {
      if (seg.type === "verbatim") {
        return `<span class="linkedin-fit__seg linkedin-fit__seg--you">${escapeHtml(seg.text)}</span>`;
      }
      return `<span class="linkedin-fit__seg linkedin-fit__seg--ai">` +
        `<span class="linkedin-fit__seg-tag" aria-hidden="true">AI</span>` +
        escapeHtml(seg.text) +
        `</span>`;
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
    saveBtn.hidden = true;
    copyBtn.hidden = true;
    stitchBtn.disabled = true;
    stitchBtn.textContent = "Stitching…";
  }

  function showError(message) {
    draftEl.innerHTML =
      `<p class="linkedin-fit__verdict-label linkedin-fit__verdict-label--err">Couldn't stitch a draft.</p>` +
      `<p class="linkedin-fit__verdict-reason">${escapeHtml(message)}</p>`;
    metaEl.hidden = true;
    saveBtn.hidden = true;
    copyBtn.hidden = true;
    stitchBtn.disabled = false;
    stitchBtn.textContent = "Try again";
  }

  function showDraft(draft) {
    draftEl.innerHTML = renderSegments(draft.segments);
    metaEl.textContent = formatStitchedTimestamp(draft.ts);
    metaEl.hidden = false;
    saveBtn.hidden = false;
    copyBtn.hidden = false;
    stitchBtn.disabled = false;
    stitchBtn.textContent = "Stitch a new draft";
  }

  function showEmpty() {
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
      showDraft(draft);
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
    copyBtn.textContent = "Copied";
    clearTimeout(copyBtn._labelTimer);
    copyBtn._labelTimer = setTimeout(() => {
      copyBtn.textContent = "Copy my words";
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

  // ── Image generation ─────────────────────────────────────────────────
  //
  // Lay out the segments into "atoms" (word + colour + font), then walk
  // the atoms onto pages. Verbatim words cycle through the tinker
  // rainbow palette one word at a time — visually distinct from the
  // muted AI text, and the same visual cue the on-screen shader uses.
  // The last page gets a "Created by tinker" footer + colour legend.

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
    // Use a throwaway canvas for measuring word widths.
    const measure = document.createElement("canvas");
    measure.width = IMG_W; measure.height = IMG_H;
    const mctx = measure.getContext("2d");

    const pages = [];
    let page = [];
    let x = IMG_MARGIN;
    let y = IMG_BODY_TOP + Math.round(IMG_BODY_LINE_HEIGHT * 0.7); // baseline of first line
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
        // wrap to next line
        x = IMG_MARGIN;
        y += IMG_BODY_LINE_HEIGHT;
        if (y > IMG_BODY_BOTTOM) {
          flushPage();
        }
      }
      if (x > IMG_MARGIN) x += spaceW;
      page.push({ text: atom.text, color: atom.color, font: atom.font, x, y });
      x += wordW;
    }
    if (page.length) pages.push(page);
    return pages;
  }

  function drawHeader(ctx, pageNum, totalPages) {
    // Seed-mark glyph: a small green leaf to the left of the wordmark.
    const cx = IMG_MARGIN + 18;
    const cy = 70;
    ctx.fillStyle = IMG_BRAND_COLOR;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
    // Inner stroke (cream) — evokes the "b" in the brand badge.
    ctx.strokeStyle = IMG_BG;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 8);
    ctx.lineTo(cx - 4, cy + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 3, cy + 1, 7, -Math.PI / 2, Math.PI * 1.2);
    ctx.stroke();

    // Wordmark
    ctx.fillStyle = IMG_BRAND_COLOR;
    ctx.font = "700 28px 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("tinker", cx + 32, cy + 1);

    // Page indicator if multi
    if (totalPages > 1) {
      ctx.fillStyle = IMG_SUB_COLOR;
      ctx.font = "500 22px 'Inter', system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${pageNum} / ${totalPages}`, IMG_W - IMG_MARGIN, cy + 1);
      ctx.textAlign = "left";
    }
  }

  function drawFooter(ctx) {
    const y0 = IMG_H - IMG_FOOTER_RESERVE + 40;
    // Divider
    ctx.strokeStyle = "#ede8e0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(IMG_MARGIN, y0);
    ctx.lineTo(IMG_W - IMG_MARGIN, y0);
    ctx.stroke();

    // "Created by tinker"
    ctx.fillStyle = IMG_BRAND_COLOR;
    ctx.font = "700 24px 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText("Created by tinker", IMG_MARGIN, y0 + 40);

    // Legend: rainbow swatch + label, then gray swatch + label
    const legendY = y0 + 90;
    const swatchSize = 16;

    // Rainbow swatch — seven small chips
    let lx = IMG_MARGIN;
    for (let i = 0; i < TINKER_RAINBOW.length; i++) {
      ctx.fillStyle = TINKER_RAINBOW[i];
      ctx.fillRect(lx + i * (swatchSize + 2), legendY - swatchSize + 2, swatchSize, swatchSize);
    }
    lx += TINKER_RAINBOW.length * (swatchSize + 2) + 14;
    ctx.fillStyle = IMG_SUB_COLOR;
    ctx.font = "500 20px 'Inter', system-ui, sans-serif";
    ctx.fillText("the founder's own words", lx, legendY);

    // Gray swatch
    const legendY2 = legendY + 36;
    ctx.fillStyle = IMG_AI_COLOR;
    ctx.fillRect(IMG_MARGIN, legendY2 - swatchSize + 2, swatchSize, swatchSize);
    ctx.fillStyle = IMG_SUB_COLOR;
    ctx.font = "italic 20px 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
    ctx.fillText("connecting tissue, AI-written", IMG_MARGIN + swatchSize + 14, legendY2);
  }

  async function renderImages(segments) {
    const atoms = buildAtoms(segments);
    const pages = paginateAtoms(atoms);
    const blobs = [];
    for (let p = 0; p < pages.length; p++) {
      const canvas = document.createElement("canvas");
      canvas.width = IMG_W;
      canvas.height = IMG_H;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = IMG_BG;
      ctx.fillRect(0, 0, IMG_W, IMG_H);
      drawHeader(ctx, p + 1, pages.length);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      for (const a of pages[p]) {
        ctx.font = a.font;
        ctx.fillStyle = a.color;
        ctx.fillText(a.text, a.x, a.y);
      }
      if (p === pages.length - 1) drawFooter(ctx);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      if (blob) blobs.push(blob);
    }
    return blobs;
  }

  async function saveDraftImages() {
    if (!cache || !Array.isArray(cache.segments)) return;
    saveBtn.disabled = true;
    const originalLabel = saveBtn.textContent;
    saveBtn.textContent = "Rendering…";
    let blobs;
    try {
      blobs = await renderImages(cache.segments);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
      showError((err && err.message) || "Image render failed.");
      return;
    }
    if (!blobs.length) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
      return;
    }
    saveBtn.textContent = blobs.length > 1 ? "Save images" : "Save image";

    const files = blobs.map((blob, i) =>
      new File([blob], `tinker-pitch-${i + 1}.png`, { type: "image/png" })
    );

    // Mobile / PWA path: Web Share with files raises the share sheet
    // which includes "Save Image" / "Save to Photos".
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title: "tinker pitch" });
        saveBtn.disabled = false;
        saveBtn.textContent = "Saved";
        clearTimeout(saveBtn._labelTimer);
        saveBtn._labelTimer = setTimeout(() => {
          saveBtn.textContent = blobs.length > 1 ? "Save images" : "Save image";
        }, COPY_LABEL_RESET_MS);
        return;
      } catch (err) {
        if (err && err.name === "AbortError") {
          saveBtn.disabled = false;
          saveBtn.textContent = blobs.length > 1 ? "Save images" : "Save image";
          return;
        }
        // fall through to download
      }
    }

    // Desktop / fallback: download each blob.
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
      saveBtn.textContent = blobs.length > 1 ? "Save images" : "Save image";
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
      showDraft(cache);
    } else {
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
    maybeRerender();
  }
  window.addEventListener("tinker:writing-saved", maybeRerender);
  window.addEventListener("tinker:hydrated", onHydrated);

  // ── Public API ───────────────────────────────────────────────────────
  window.tinkerLinkedinFit = { render };
})();
