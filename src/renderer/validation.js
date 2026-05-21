/* tinker — validation flow + review screen
 *
 * The validation flow is the existing writing.js engine re-entered with
 * three changes: the sidebar deck is hidden, the opening question is a
 * validation-flavored variant, and the stitch destination routes to the
 * review screen instead of the writing-fit view.
 *
 * The review screen renders one visualization: a horizontal tinker-
 * rainbow spectrum bar with eleven markers (one per DECK_HEADINGS),
 * placed by /api/validation/coherence (claude-sonnet-4-6). Two footer
 * buttons: `Sharpen for $8` (primary) and `Keep` (secondary).
 *
 * Anti-patterns from the build prompt: no scores, no percentages, no
 * judgment language, no motion, no shadows on cards/panels/spectrum.
 * Markers that cluster differently from the rest are NOT framed as
 * wrong — they just landed in a different color band.
 */

(() => {
  "use strict";

  // [NEEDS INPUT] — validation opening question. Placeholder until the
  // founder picks one. Must not use the words "pitch" or "deck".
  const VALIDATION_SEED_QUESTION = "What is this, without looking?";

  // [NEEDS INPUT] — welcome-grid tile label. Allow-listed in the build
  // prompt. Candidates: "Validate.", "Source.", "Today's pitch.",
  // "Without looking.", "Write it again."
  const TILE_LABEL = "Validate.";

  // [NEEDS INPUT] — review-screen heading. Candidates listed in the
  // build prompt. Placeholder until confirmed.
  const REVIEW_HEADING = "Your pitch, in colors.";

  // [NEEDS INPUT] — `Keep` button label. Founder may prefer
  // "This is everything" for continuity with the writing flow.
  const KEEP_LABEL = "Keep";

  const SHARPEN_LABEL = "Sharpen for $8";

  // Map color-name strings (returned by the coherence endpoint) to the
  // CSS tokens defined in design-tokens.css. The endpoint returns one
  // of seven brand-palette names (pink/peach/amber/mint/sky/indigo/
  // violet); the renderer maps each to its `--color-*` brand token.
  // The bar gradient itself uses the LOGO palette (which shares most
  // colors but diverges at leaf/purple); marker colors can fall
  // between gradient bands, which is the point — coherence is about
  // where a slide's voice lives, not pinning to a single stripe.
  const COLOR_TO_TOKEN = {
    pink:   "var(--color-rose)",
    peach:  "var(--color-peach)",
    amber:  "var(--color-amber)",
    mint:   "var(--color-mint)",
    sky:    "var(--color-sky)",
    indigo: "var(--color-indigo)",
    violet: "var(--color-violet)",
  };

  const ALLOWED_COLORS = new Set(Object.keys(COLOR_TO_TOKEN));

  // ── DOM refs (resolved lazily; the section is appended at boot) ─────
  let reviewSection = null;
  let stage = null;

  // The full-progress signal lives on tinkerDecks (multi-deck aware).
  // We also keep a fallback for the cold-boot order when sidebar-tree
  // and decks haven't loaded yet.
  function fullProgressReached() {
    if (window.tinkerDecks && typeof window.tinkerDecks.fullProgressReached === "function") {
      try { return !!window.tinkerDecks.fullProgressReached(); }
      catch { return false; }
    }
    if (window.tinkerTree && typeof window.tinkerTree.coveredHeadings === "function") {
      try {
        const covered = window.tinkerTree.coveredHeadings();
        const headings = (window.tinkerTree.DECK_HEADINGS || []).length || 11;
        return Array.isArray(covered) && covered.length === headings;
      } catch { return false; }
    }
    return false;
  }

  // ── Welcome-grid tile ───────────────────────────────────────────────
  // Renders the validation tile inside #welcome-grid when the active
  // deck has crossed full progress. Hidden otherwise. Re-evaluated on
  // every render (the welcome page surfaces this in renderer.js's
  // showFeed()).
  function refreshTile() {
    const grid = document.getElementById("welcome-grid");
    if (!grid) return;
    let tile = grid.querySelector('[data-tile="validate"]');
    const show = fullProgressReached();
    if (show && !tile) {
      tile = document.createElement("button");
      tile.type = "button";
      tile.className = "welcome__tile welcome__tile--validate";
      tile.setAttribute("data-tile", "validate");
      const label = document.createElement("span");
      label.className = "welcome__tile-label";
      label.textContent = TILE_LABEL;
      tile.appendChild(label);
      tile.addEventListener("click", openValidation);
      grid.appendChild(tile);
    } else if (!show && tile) {
      tile.remove();
    }
  }

  // ── Open the validation flow ────────────────────────────────────────
  // Reuses the writing.js engine — same textarea, same `Next →`, same
  // `This is everything →`. Three deltas:
  //   1. body.validation-flow hides the sidebar deck rows via CSS.
  //   2. The seed question is the validation-flavored variant.
  //   3. On stitch, route to the review screen (step 5) instead of the
  //      writing-fit view.
  function openValidation() {
    if (!window.tinkerWriting || typeof window.tinkerWriting.openValidation !== "function") {
      // writing.js hasn't booted yet, or doesn't expose the validation
      // entry point. Bail silently — the founder can try again.
      return;
    }
    document.body.classList.add("validation-flow");
    window.tinkerWriting.openValidation({
      seedQuestion: VALIDATION_SEED_QUESTION,
      onStitch: (stitched) => {
        // writing.js hands us the verified stitched essay; we own the
        // review screen render from here.
        renderReview(stitched);
      },
      onClose: () => returnToBase(),
    });
  }

  // ── Coherence call ──────────────────────────────────────────────────
  async function fetchCoherence(stitchedBody) {
    const tree = (window.tinkerDecks && window.tinkerDecks.activeTree())
      || (window.tinkerTree && window.tinkerTree.snapshot && window.tinkerTree.snapshot())
      || {};
    const activeDeck = window.tinkerDecks && window.tinkerDecks.active && window.tinkerDecks.active();
    const deckSourceContext = activeDeck && activeDeck.sourceContext ? activeDeck.sourceContext : null;
    let token = "";
    try { token = localStorage.getItem("tinker_jwt") || ""; }
    catch { /* ignore */ }
    if (!token) throw new Error("Not signed in.");
    const res = await fetch("/api/validation/coherence", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ stitchedBody, deckTree: tree, deckSourceContext }),
    });
    if (!res.ok) {
      let msg = `Coherence request failed (${res.status})`;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const json = await res.json();
    if (!json || !Array.isArray(json.headings)) {
      throw new Error("Malformed coherence response.");
    }
    return json.headings;
  }

  // ── Review screen ───────────────────────────────────────────────────
  function ensureSection() {
    if (reviewSection) return reviewSection;
    const main = document.getElementById("stage") || document.querySelector("main.stage");
    if (!main) return null;
    reviewSection = document.createElement("section");
    reviewSection.id = "validation-review";
    reviewSection.className = "validation-review";
    reviewSection.hidden = true;
    const inner = document.createElement("div");
    inner.className = "validation-review__inner";
    reviewSection.appendChild(inner);
    main.appendChild(reviewSection);
    stage = inner;
    return reviewSection;
  }

  function closeReview() {
    if (!reviewSection) return;
    reviewSection.hidden = true;
    if (stage) stage.innerHTML = "";
  }

  function showOnlyReview() {
    // Hide all sibling sections inside <main.stage>; restore the welcome
    // section's data-active flag so when the founder returns via Keep
    // it lands on the welcome page.
    const main = document.getElementById("stage") || document.querySelector("main.stage");
    if (!main) return;
    const sections = main.querySelectorAll(":scope > section");
    sections.forEach((s) => {
      if (s === reviewSection) {
        s.hidden = false;
      } else {
        s.hidden = true;
        s.removeAttribute("data-active");
      }
    });
  }

  function renderLoading() {
    if (!stage) return;
    stage.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "validation-review__loading";
    const dots = document.createElement("div");
    dots.className = "thinking-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.innerHTML =
      `<span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>`;
    wrap.appendChild(dots);
    stage.appendChild(wrap);
  }

  function renderReviewError(err) {
    if (!stage) return;
    stage.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "validation-review__error";
    const msg = document.createElement("p");
    msg.textContent = (err && err.message) || "Couldn't read this one.";
    wrap.appendChild(msg);
    const actions = document.createElement("div");
    actions.className = "validation-review__actions";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "validation-button validation-button--secondary";
    back.textContent = KEEP_LABEL;
    back.addEventListener("click", returnToBase);
    actions.appendChild(back);
    wrap.appendChild(actions);
    stage.appendChild(wrap);
  }

  function renderReview(stitched) {
    ensureSection();
    if (!stage) return;
    showOnlyReview();
    renderLoading();

    const body = (stitched && stitched.body) || "";
    if (!body.trim()) {
      renderReviewError(new Error("Nothing to read yet."));
      return;
    }

    fetchCoherence(body)
      .then((headings) => renderSpectrum(headings))
      .catch((err) => renderReviewError(err));
  }

  function renderSpectrum(headings) {
    if (!stage) return;
    const deckHeadings = (window.tinkerDecks && window.tinkerDecks.DECK_HEADINGS)
      || (window.tinkerTree && window.tinkerTree.DECK_HEADINGS)
      || [];

    stage.innerHTML = "";

    const heading = document.createElement("h1");
    heading.className = "validation-review__heading";
    heading.textContent = REVIEW_HEADING;
    stage.appendChild(heading);

    // The single rainbow spectrum bar. Static — no animation, no
    // draw-in. The CSS gradient pulls from the seven --logo-* tokens.
    const bar = document.createElement("div");
    bar.className = "validation-spectrum";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", "Pitch spectrum");

    // Eleven markers (one per deck heading). Per the build prompt:
    //   12px filled circle, --color-card fill, 1.5px solid border in the
    //   heading's color token. Below each marker, the heading label
    //   rotated -60deg in --text-micro Instrument Sans.
    // The classifier may return fewer than 11 if the model dropped one;
    // we render a marker for every DECK_HEADINGS entry, falling back to
    // a neutral position so the founder still sees their pitch shape.
    const byHeading = new Map();
    for (const entry of headings || []) {
      if (entry && deckHeadings.includes(entry.heading)) {
        byHeading.set(entry.heading, entry);
      }
    }

    for (let i = 0; i < deckHeadings.length; i++) {
      const headingName = deckHeadings[i];
      const entry = byHeading.get(headingName);
      const position = entry && Number.isFinite(entry.position)
        ? Math.max(0, Math.min(1, entry.position))
        : (i / Math.max(1, deckHeadings.length - 1));
      const colorName = entry && ALLOWED_COLORS.has(entry.color) ? entry.color : "indigo";
      const colorToken = COLOR_TO_TOKEN[colorName];

      const marker = document.createElement("span");
      marker.className = "validation-spectrum__marker";
      marker.style.left = `${(position * 100).toFixed(3)}%`;
      marker.style.borderColor = colorToken;
      marker.setAttribute("data-heading", headingName);
      marker.setAttribute("tabindex", "0");
      marker.setAttribute("role", "button");
      marker.setAttribute("aria-label", headingName);

      // Floating chip on hover/focus — text-only, no shadow. The label
      // is the heading name; everything on this surface is in the
      // allowlist.
      const chip = document.createElement("span");
      chip.className = "validation-spectrum__chip";
      chip.setAttribute("aria-hidden", "true");
      chip.textContent = headingName;
      marker.appendChild(chip);

      // Below-marker label, rotated -60deg so eleven labels fit without
      // overlapping. Carries the heading name verbatim.
      const lab = document.createElement("span");
      lab.className = "validation-spectrum__label";
      lab.setAttribute("aria-hidden", "true");
      lab.textContent = headingName;
      marker.appendChild(lab);

      bar.appendChild(marker);
    }

    const barWrap = document.createElement("div");
    barWrap.className = "validation-spectrum-wrap";
    barWrap.appendChild(bar);
    stage.appendChild(barWrap);

    // Footer: Sharpen ($8) primary, Keep secondary. Same two-button
    // shape as the writing footer's Next/End pair.
    const footer = document.createElement("div");
    footer.className = "validation-review__foot";
    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "validation-button validation-button--secondary";
    keep.textContent = KEEP_LABEL;
    keep.addEventListener("click", returnToBase);
    footer.appendChild(keep);

    const sharpen = document.createElement("button");
    sharpen.type = "button";
    sharpen.className = "validation-button validation-button--primary";
    sharpen.textContent = SHARPEN_LABEL;
    sharpen.addEventListener("click", onSharpen);
    footer.appendChild(sharpen);

    stage.appendChild(footer);
  }

  function returnToBase() {
    document.body.classList.remove("validation-flow");
    closeReview();
    // Route the founder back to the welcome / base feed.
    const main = document.getElementById("stage") || document.querySelector("main.stage");
    if (main) {
      const welcome = main.querySelector("#welcome");
      if (welcome) {
        welcome.hidden = false;
        welcome.setAttribute("data-active", "");
      }
    }
    // Re-evaluate the tile (still present if the active deck is full).
    refreshTile();
  }

  function onSharpen() {
    const subscribed = !!(window.tinkerAuth && typeof window.tinkerAuth.isSubscribed === "function"
      && window.tinkerAuth.isSubscribed());
    document.body.classList.remove("validation-flow");
    closeReview();
    if (subscribed) {
      // Already paid: route to the deck switcher / Add-a-deck flow.
      if (window.tinkerDeckSwitcher && typeof window.tinkerDeckSwitcher.openAddDeck === "function") {
        window.tinkerDeckSwitcher.openAddDeck();
        return;
      }
    }
    // Unpaid: open the payment screen.
    if (window.tinkerPayment && typeof window.tinkerPayment.open === "function") {
      window.tinkerPayment.open({ returnToReview: true });
      return;
    }
    // Fall back to base flow if neither helper is loaded.
    returnToBase();
  }

  // ── Boot ────────────────────────────────────────────────────────────

  function boot() {
    ensureSection();
    refreshTile();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // Re-evaluate the welcome-grid tile when the tree / decks change.
  window.addEventListener("tinker:writing-saved", () => refreshTile());
  window.addEventListener("tinker:hydrated", () => refreshTile());
  window.addEventListener("tinker:decks-changed", () => refreshTile());

  // Expose a refresh hook so renderer.js can call it from showFeed()
  // (since the tile is a child of #welcome-grid and showFeed re-paints
  // the welcome surface).
  window.tinkerValidation = {
    refreshTile,
    open: openValidation,
    closeReview,
  };
})();
