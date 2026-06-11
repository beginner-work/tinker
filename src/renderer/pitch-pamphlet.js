/* pitch-pamphlet.js — read the active pitch as a pamphlet.
 *
 * The sidebar shows the deck as eleven rows at once; this is the other
 * way of looking at it — one card at a time, flipped through like a
 * pamphlet of notes. Card one is the cover. Card two is "How Claude
 * reads this pitch": the model's reflection of what it perceives the
 * pitch to be, built from the founder's own slides (never a rewrite).
 * Every card after that is a flashcard for a covered slide — the slide
 * title and the essay's own title on the front, the verbatim phrase as
 * the quote, and the full essay on the back (tap to flip).
 *
 * Cost honesty: the interpretation is cached in localStorage keyed by a
 * hash of the pitch's resolved content. Opening the pamphlet again
 * reuses the cached read for free; Claude is only asked again when the
 * pitch itself has changed.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var CACHE_KEY = "tinker.interpret.v1";

  // Same 7-hue cycle the sidebar rows and the read view's subtitle use,
  // mirrored here so a slide keeps its colour across surfaces.
  var SLIDE_COLOR_CYCLE = [
    "var(--logo-pink)",
    "var(--logo-orange)",
    "var(--logo-yellow)",
    "var(--logo-leaf)",
    "var(--logo-sky)",
    "var(--logo-mint)",
    "var(--logo-purple)",
  ];

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function slideColorFor(heading) {
    var pm = window.tinkerPitches;
    var headings = (pm && pm.DECK_HEADINGS) || [];
    var i = headings.indexOf(heading);
    if (i < 0) return SLIDE_COLOR_CYCLE[0];
    return SLIDE_COLOR_CYCLE[i % SLIDE_COLOR_CYCLE.length];
  }

  function totalHeadings() {
    var pm = window.tinkerPitches;
    return (pm && pm.DECK_HEADINGS && pm.DECK_HEADINGS.length) || 11;
  }

  // ── Interpretation cache ────────────────────────────────────────────
  // djb2 over the resolved content. Same content → same hash → cached
  // read; any slide change (moved essay, new phrase, retitle) → new
  // hash → one fresh AI pass.
  function contentHash(pam) {
    var s = String(pam.title || "");
    for (var i = 0; i < pam.slides.length; i++) {
      var sl = pam.slides[i];
      s += "|" + sl.heading + "|" + (sl.title || "") + "|" + sl.phrase;
    }
    var h = 5381;
    for (var j = 0; j < s.length; j++) h = ((h << 5) + h + s.charCodeAt(j)) | 0;
    return "i" + (h >>> 0).toString(36) + "_" + pam.slides.length;
  }

  function readCache(pitchId) {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var all = JSON.parse(raw);
      return (all && typeof all === "object" && all[pitchId]) || null;
    } catch (e) { return null; }
  }

  function writeCache(pitchId, entry) {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      var all = {};
      if (raw) { try { all = JSON.parse(raw) || {}; } catch (e) { all = {}; } }
      all[pitchId] = entry;
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }

  function fetchInterpretation(pitchId) {
    return fetch("/api/pitches/interpret", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
      },
      body: JSON.stringify({ pitchId: pitchId }),
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!res.ok || !json || !json.ok || !json.interpretation) {
          return { ok: false, error: (json && json.error) || ("HTTP " + res.status) };
        }
        return { ok: true, interpretation: String(json.interpretation) };
      });
    }).catch(function (err) {
      return { ok: false, error: String((err && err.message) || err) };
    });
  }

  // One AI pass per (pitch, content-hash), even when the founder flips
  // away and back while it's still loading — revisiting the card joins
  // the in-flight request instead of firing a second one.
  var pendingInterpret = null; // { key, promise } | null

  function ensureInterpretation(pitchId, hash) {
    var key = pitchId + ":" + hash;
    if (pendingInterpret && pendingInterpret.key === key) {
      return pendingInterpret.promise;
    }
    var promise = fetchInterpretation(pitchId).then(function (result) {
      if (pendingInterpret && pendingInterpret.key === key) pendingInterpret = null;
      if (result.ok) {
        writeCache(pitchId, { hash: hash, text: result.interpretation, at: Date.now() });
      }
      return result;
    });
    pendingInterpret = { key: key, promise: promise };
    return promise;
  }

  // ── Overlay ─────────────────────────────────────────────────────────
  var overlay = null;
  var cards = [];        // { kind: "cover" | "ai" | "slide", slide? }
  var index = 0;
  var flipped = {};      // cardIndex → true while showing the essay side
  var pamphlet = null;   // the resolved pitch snapshot this open() is showing

  function close() {
    if (!overlay) return;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
    cards = [];
    flipped = {};
    pamphlet = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  }

  function go(delta) {
    if (!cards.length) return;
    var next = Math.max(0, Math.min(cards.length - 1, index + delta));
    if (next === index) return;
    index = next;
    renderStage();
  }

  function open(pitchId) {
    var pm = window.tinkerPitches;
    if (!pm || typeof pm.getPitchPamphlet !== "function") return;
    close();
    pamphlet = pm.getPitchPamphlet(pitchId || null);

    overlay = el("div", "pamphlet-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Read this pitch as a pamphlet");

    var backdrop = el("div", "pamphlet-overlay__backdrop");
    backdrop.addEventListener("click", close);
    overlay.appendChild(backdrop);

    var panel = el("div", "pamphlet");
    var closeBtn = el("button", "pamphlet__close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close the pamphlet");
    closeBtn.addEventListener("click", close);
    panel.appendChild(closeBtn);

    var stage = el("div", "pamphlet__stage");
    stage.setAttribute("data-pamphlet-stage", "");
    panel.appendChild(stage);

    var nav = el("div", "pamphlet__nav");
    var prev = el("button", "pamphlet__arrow pamphlet__arrow--prev", "←");
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous card");
    prev.addEventListener("click", function () { go(-1); });
    nav.appendChild(prev);
    var dots = el("div", "pamphlet__dots");
    dots.setAttribute("data-pamphlet-dots", "");
    nav.appendChild(dots);
    var next = el("button", "pamphlet__arrow pamphlet__arrow--next", "→");
    next.type = "button";
    next.setAttribute("aria-label", "Next card");
    next.addEventListener("click", function () { go(1); });
    nav.appendChild(next);
    panel.appendChild(nav);

    overlay.appendChild(panel);

    cards = [];
    index = 0;
    flipped = {};
    if (pamphlet && pamphlet.slides.length) {
      cards.push({ kind: "cover" });
      cards.push({ kind: "ai" });
      for (var i = 0; i < pamphlet.slides.length; i++) {
        cards.push({ kind: "slide", slide: pamphlet.slides[i] });
      }
    } else {
      cards.push({ kind: "empty" });
    }

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);
    renderStage();
  }

  // ── Cards ───────────────────────────────────────────────────────────

  function renderStage() {
    if (!overlay) return;
    var stage = overlay.querySelector("[data-pamphlet-stage]");
    if (!stage) return;
    stage.innerHTML = "";
    var card = cards[index];
    if (!card) return;
    if (card.kind === "cover") stage.appendChild(coverCard());
    else if (card.kind === "ai") stage.appendChild(aiCard());
    else if (card.kind === "slide") stage.appendChild(slideCard(card.slide, index));
    else stage.appendChild(emptyCard());
    renderDots();
  }

  function renderDots() {
    var dots = overlay && overlay.querySelector("[data-pamphlet-dots]");
    if (!dots) return;
    dots.innerHTML = "";
    for (var i = 0; i < cards.length; i++) {
      (function (i2) {
        var d = el("button", "pamphlet__dot");
        d.type = "button";
        d.setAttribute("aria-label", "Card " + (i2 + 1) + " of " + cards.length);
        if (i2 === index) d.setAttribute("data-active", "");
        d.addEventListener("click", function () { index = i2; renderStage(); });
        dots.appendChild(d);
      })(i);
    }
  }

  function coverCard() {
    var card = el("article", "pamphlet__card pamphlet__card--cover");
    card.appendChild(el("span", "pamphlet__kicker", "Pitch pamphlet"));
    var title = (pamphlet && pamphlet.title) || "Untitled";
    card.appendChild(el("h2", "pamphlet__cover-title", title));
    if (pamphlet && pamphlet.personalTitle && pamphlet.aiTitle && pamphlet.personalTitle !== pamphlet.aiTitle) {
      card.appendChild(el("p", "pamphlet__cover-sub", pamphlet.aiTitle));
    }
    var n = pamphlet ? pamphlet.slides.length : 0;
    card.appendChild(el(
      "p",
      "pamphlet__cover-count",
      n + " of " + totalHeadings() + " slides have an essay behind them."
    ));
    card.appendChild(el("p", "pamphlet__hint", "Flip through with the arrows — every card is one slide of your pitch."));
    return card;
  }

  function aiCard() {
    var card = el("article", "pamphlet__card pamphlet__card--ai");
    card.appendChild(el("span", "pamphlet__kicker", "How Claude reads this pitch"));
    var body = el("div", "pamphlet__ai-body");
    card.appendChild(body);
    var foot = el(
      "p",
      "pamphlet__ai-foot",
      "Claude's read of your own slides — nothing is rewritten. It re-reads only when your pitch changes; reopening this is free."
    );
    card.appendChild(foot);

    if (!token()) {
      body.appendChild(el("p", "pamphlet__ai-note", "Sign in to see Claude's read of your pitch."));
      return card;
    }

    var hash = contentHash(pamphlet);
    var cached = readCache(pamphlet.id);
    if (cached && cached.hash === hash && cached.text) {
      renderInterpretation(body, cached.text);
      return card;
    }

    body.appendChild(el("p", "pamphlet__ai-note pamphlet__ai-note--busy", "Claude is reading your pitch…"));
    var pitchId = pamphlet.id;
    ensureInterpretation(pitchId, hash).then(function (result) {
      // The pamphlet may have been closed or moved on — only paint if
      // this card is still the one on stage (the cache is written
      // either way, so a revisit shows the read for free).
      if (!overlay || !pamphlet || pamphlet.id !== pitchId) return;
      if (!body.isConnected) return;
      body.innerHTML = "";
      if (result.ok) {
        renderInterpretation(body, result.interpretation);
      } else {
        body.appendChild(el(
          "p",
          "pamphlet__ai-note",
          "Couldn't reach Claude just now — your slides are all here, keep flipping."
        ));
      }
    });
    return card;
  }

  function renderInterpretation(mount, text) {
    var parts = String(text || "").split(/\n{2,}/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p) mount.appendChild(el("p", "pamphlet__ai-paragraph", p));
    }
  }

  function slideCard(slide, cardIndex) {
    var isFlipped = !!flipped[cardIndex];
    var card = el("article", "pamphlet__card pamphlet__card--slide" + (isFlipped ? " is-flipped" : ""));
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.setAttribute(
      "aria-label",
      isFlipped ? "Show the front of this card" : "Flip to read the whole essay",
    );

    if (isFlipped) {
      var chipB = el("span", "pamphlet__slide-chip", slide.heading);
      chipB.style.color = slideColorFor(slide.heading);
      card.appendChild(chipB);
      if (slide.title) card.appendChild(el("h3", "pamphlet__essay-title pamphlet__essay-title--back", slide.title));
      var bodyWrap = el("div", "pamphlet__essay-body");
      var paras = String(slide.body || "").split(/\n{2,}/);
      for (var i = 0; i < paras.length; i++) {
        var p = paras[i].trim();
        if (p) bodyWrap.appendChild(el("p", null, p));
      }
      card.appendChild(bodyWrap);
      card.appendChild(el("p", "pamphlet__hint", "Tap to flip back"));
    } else {
      var chip = el("span", "pamphlet__slide-chip", slide.heading);
      chip.style.color = slideColorFor(slide.heading);
      card.appendChild(chip);
      card.appendChild(el("h3", "pamphlet__essay-title", slide.title || "Untitled essay"));
      card.appendChild(el("blockquote", "pamphlet__quote", "“" + slide.phrase + "”"));
      card.appendChild(el("p", "pamphlet__hint", "Tap to read the whole essay"));
    }

    var flip = function (e) {
      e.preventDefault();
      flipped[cardIndex] = !flipped[cardIndex];
      renderStage();
    };
    card.addEventListener("click", flip);
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") flip(e);
    });
    return card;
  }

  function emptyCard() {
    var card = el("article", "pamphlet__card pamphlet__card--cover");
    card.appendChild(el("span", "pamphlet__kicker", "Pitch pamphlet"));
    card.appendChild(el(
      "p",
      "pamphlet__cover-count",
      "No slides have an essay behind them yet. Write a few drafts and this pamphlet fills itself in."
    ));
    return card;
  }

  window.tinkerPamphlet = { open: open, close: close };
})();
