/* tinker-gram — the holistic founder-discovery surface.
 *
 * One main screen. Three borrowed shapes, woven into one view:
 *   - Top: a stories rail of the cohort (Instagram).
 *   - Centre: a vertical reel hero, autoplaying one founder at a time
 *     (TikTok). Up/Down arrows or scroll-snap swap reels.
 *   - Right rail: the active founder's pitch — bio, offerings, ask,
 *     principles — and a working-relationship match card (NOT
 *     co-founder match: this surface only ever proposes ways
 *     existing founders could work with each other).
 *   - Bottom: the active founder's Instagram-style post grid.
 *
 * The whole screen tunes to whichever founder is on the reel hero,
 * so switching founders updates everything at once.
 *
 * No bundler, no framework — plain DOM mutations from a single
 * `state` object, mirroring the rest of the renderer. */

(function () {
  "use strict";

  const data = window.tinkerData;
  if (!data) {
    console.warn("[tinker-gram] window.tinkerData not loaded");
    return;
  }

  const { FOUNDERS, POSTS, REELS, MATCHES, MATCH_KINDS } = data;
  const founderByHandle = new Map(FOUNDERS.map((f) => [f.handle, f]));

  /** @type {{
   *   activeHandle: string,
   *   reelIdx: number,
   *   liked: Set<string>,
   *   saved: Set<string>,
   *   matchIdx: number,
   *   matchAcks: Map<string, string>,
   * }} */
  const state = {
    activeHandle: FOUNDERS[0].handle,
    reelIdx: 0,
    liked: new Set(),
    saved: new Set(),
    matchIdx: 0,
    matchAcks: new Map(),
  };

  // ── Mood paint ──────────────────────────────────────────────────────
  //
  // Posts and reels carry a `mood` (tincture, grid, wave, …) instead
  // of an image URL. Each mood compiles to a layered CSS background
  // that keys off the founder's palette. Means the surface paints the
  // moment data is loaded — no network, no flicker, no broken images.

  const MOODS = {
    tincture: (p) =>
      `radial-gradient(ellipse at 30% 20%, ${p[0]} 0%, transparent 55%),` +
      `radial-gradient(ellipse at 75% 80%, ${p[1]} 0%, transparent 60%),` +
      `linear-gradient(160deg, ${p[2]} 0%, ${p[0]} 100%)`,
    grid: (p) =>
      `linear-gradient(${p[0]} 1px, transparent 1px) 0 0/24px 24px,` +
      `linear-gradient(90deg, ${p[1]} 1px, transparent 1px) 0 0/24px 24px,` +
      `linear-gradient(150deg, ${p[2]}, ${p[0]})`,
    wave: (p) =>
      `radial-gradient(circle at 50% 120%, ${p[0]} 0%, transparent 50%),` +
      `radial-gradient(circle at 50% 0%, ${p[1]} 0%, transparent 60%),` +
      `linear-gradient(180deg, ${p[2]}, ${p[0]})`,
    circle: (p) =>
      `radial-gradient(circle at 50% 50%, ${p[0]} 0%, ${p[1]} 38%, ${p[2]} 100%)`,
    ledger: (p) =>
      `repeating-linear-gradient(0deg, transparent 0 22px, ${p[0]}33 22px 23px),` +
      `linear-gradient(140deg, ${p[1]}, ${p[2]})`,
    leaf: (p) =>
      `radial-gradient(ellipse at 20% 100%, ${p[0]} 0%, transparent 55%),` +
      `radial-gradient(ellipse at 80% 0%, ${p[1]} 0%, transparent 50%),` +
      `linear-gradient(125deg, ${p[2]}, ${p[0]})`,
    weave: (p) =>
      `repeating-linear-gradient(45deg, ${p[0]}55 0 6px, ${p[1]}55 6px 12px),` +
      `repeating-linear-gradient(-45deg, ${p[2]}55 0 6px, ${p[0]}55 6px 12px),` +
      `linear-gradient(135deg, ${p[2]}, ${p[1]})`,
  };

  function paintBackground(el, mood, palette) {
    const fn = MOODS[mood] || MOODS.circle;
    el.style.backgroundImage = fn(palette);
    el.style.backgroundSize = mood === "grid" ? "24px 24px, 24px 24px, cover" : "cover";
    el.style.backgroundBlendMode = "normal";
  }

  // Avatar mark — a small SVG circle with two crossed bars, tinted by
  // the founder's hue. Cheap, brand-coherent, no images.
  function avatarSvg(founder, size = 36) {
    const [a, b, c] = founder.palette;
    return (
      `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">` +
      `<defs><linearGradient id="grad-${founder.handle}" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/>` +
      `</linearGradient></defs>` +
      `<circle cx="20" cy="20" r="19" fill="url(#grad-${founder.handle})"/>` +
      `<line x1="6" y1="20" x2="34" y2="20" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<line x1="20" y1="6" x2="20" y2="34" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>` +
      `</svg>`
    );
  }

  function fmtMoney(n) {
    if (n >= 1000) return "$" + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k";
    return "$" + n;
  }

  function fmtCount(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
    return String(n);
  }

  // ── Element factory ─────────────────────────────────────────────────

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "dataset") {
        for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
      } else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  // ── Mount ───────────────────────────────────────────────────────────

  let root = null;
  let storiesEl = null;
  let reelStackEl = null;
  let railEl = null;
  let gridEl = null;

  function mount(container) {
    root = el("section", { class: "gram", id: "gram" });

    storiesEl = el("nav", { class: "gram__stories", "aria-label": "Founders" });
    const reelCol = el("div", { class: "gram__reel-col" });
    reelStackEl = el("div", { class: "gram__reel-stack", role: "feed", "aria-label": "Reels" });
    const reelControls = buildReelControls();
    reelCol.append(reelStackEl, reelControls);

    railEl = el("aside", { class: "gram__rail", "aria-label": "Founder pitch and match" });
    gridEl = el("section", { class: "gram__grid", "aria-label": "Recent posts" });

    const center = el("div", { class: "gram__center" }, [reelCol, railEl]);
    root.append(storiesEl, center, gridEl);

    container.appendChild(root);

    bindKeys();
    renderAll();
  }

  function bindKeys() {
    document.addEventListener("keydown", (e) => {
      if (!root || !root.isConnected) return;
      // Only handle reel/match keys when the gram (welcome) is the
      // active stage — otherwise we'd hijack arrows on a webview.
      const welcome = document.getElementById("welcome");
      if (!welcome || !welcome.hasAttribute("data-active")) return;
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        advanceReel(1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        advanceReel(-1);
      } else if (e.key === "ArrowRight" || e.key === "l") {
        cycleMatch(1);
      } else if (e.key === "ArrowLeft" || e.key === "h") {
        cycleMatch(-1);
      }
    });
  }

  // ── Stories rail (Instagram-style cohort switcher) ──────────────────

  function renderStories() {
    storiesEl.innerHTML = "";
    for (const f of FOUNDERS) {
      const isActive = f.handle === state.activeHandle;
      const ring = el("button", {
        class: "story" + (isActive ? " is-active" : ""),
        type: "button",
        "aria-label": `Open ${f.name}`,
        "aria-pressed": String(isActive),
        onClick: () => {
          state.activeHandle = f.handle;
          state.reelIdx = REELS.findIndex((r) => r.handle === f.handle);
          if (state.reelIdx < 0) state.reelIdx = 0;
          state.matchIdx = MATCHES.findIndex(
            (m) => m.seekerHandle === f.handle || m.otherHandle === f.handle
          );
          if (state.matchIdx < 0) state.matchIdx = 0;
          renderAll();
        },
      });
      const ringInner = el("span", {
        class: "story__ring",
        html: avatarSvg(f, 48),
      });
      ringInner.style.setProperty("--ring-a", f.palette[0]);
      ringInner.style.setProperty("--ring-b", f.palette[1]);
      ringInner.style.setProperty("--ring-c", f.palette[2]);

      const label = el("span", { class: "story__handle", text: f.handle });
      ring.append(ringInner, label);
      storiesEl.appendChild(ring);
    }
  }

  // ── Reel hero (TikTok-style vertical) ───────────────────────────────

  function buildReelControls() {
    const wrap = el("div", { class: "gram__reel-controls" });
    const prev = el("button", {
      class: "reel-ctl",
      type: "button",
      "aria-label": "Previous reel",
      html:
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
        '<path d="M6 14l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
      onClick: () => advanceReel(-1),
    });
    const counter = el("span", { class: "reel-ctl__count", id: "reel-count" });
    const next = el("button", {
      class: "reel-ctl",
      type: "button",
      "aria-label": "Next reel",
      html:
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
        '<path d="M6 10l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
      onClick: () => advanceReel(1),
    });
    wrap.append(prev, counter, next);
    return wrap;
  }

  function advanceReel(delta) {
    state.reelIdx = (state.reelIdx + delta + REELS.length) % REELS.length;
    state.activeHandle = REELS[state.reelIdx].handle;
    state.matchIdx = MATCHES.findIndex(
      (m) =>
        m.seekerHandle === state.activeHandle || m.otherHandle === state.activeHandle
    );
    if (state.matchIdx < 0) state.matchIdx = 0;
    renderAll();
  }

  function renderReel() {
    const reel = REELS[state.reelIdx];
    const founder = founderByHandle.get(reel.handle);
    reelStackEl.innerHTML = "";

    const card = el("article", {
      class: "reel",
      "data-mood": reel.bgMood,
      "aria-label": `${founder.name} reel`,
    });
    paintBackground(card, reel.bgMood, founder.palette);

    const veil = el("div", { class: "reel__veil" });
    const top = el("header", { class: "reel__top" }, [
      el("span", { class: "reel__avatar", html: avatarSvg(founder, 36) }),
      el("div", { class: "reel__who" }, [
        el("span", { class: "reel__handle", text: "@" + founder.handle }),
        el("span", { class: "reel__city", text: founder.city }),
      ]),
      el("span", { class: "reel__duration", text: reel.duration }),
    ]);

    const body = el("div", { class: "reel__body" }, [
      el("h2", { class: "reel__title", text: reel.title }),
      el("p", { class: "reel__hook", text: reel.hook }),
    ]);

    const isLiked = state.liked.has(reel.id);
    const isSaved = state.saved.has(reel.id);
    const actions = el("div", { class: "reel__actions" }, [
      reelAction({
        label: "Like",
        active: isLiked,
        count: reel.likes + (isLiked ? 1 : 0),
        glyph: heartGlyph(isLiked),
        onClick: () => {
          toggleSet(state.liked, reel.id);
          renderReel();
        },
      }),
      reelAction({
        label: "Comment",
        count: reel.comments,
        glyph:
          '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 5h16v11H8l-4 4V5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/></svg>',
      }),
      reelAction({
        label: "Share",
        count: reel.shares,
        glyph:
          '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 12l16-8-6 18-3-7-7-3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/></svg>',
      }),
      reelAction({
        label: "Save",
        active: isSaved,
        count: reel.saves + (isSaved ? 1 : 0),
        glyph:
          isSaved
            ? '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 3h12v18l-6-4-6 4z" fill="currentColor"/></svg>'
            : '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 3h12v18l-6-4-6 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/></svg>',
        onClick: () => {
          toggleSet(state.saved, reel.id);
          renderReel();
        },
      }),
    ]);

    const sound = el("div", { class: "reel__sound" }, [
      el("span", { class: "reel__sound-icon", text: "♪" }),
      el("span", { class: "reel__sound-label", text: reel.sound }),
    ]);

    card.append(veil, top, body, actions, sound);
    reelStackEl.appendChild(card);

    const counter = document.getElementById("reel-count");
    if (counter) counter.textContent = `${state.reelIdx + 1} / ${REELS.length}`;
  }

  function reelAction({ label, count, glyph, active, onClick }) {
    const btn = el("button", {
      class: "reel-action" + (active ? " is-active" : ""),
      type: "button",
      "aria-label": label,
      onClick: onClick || null,
    });
    btn.innerHTML = glyph + `<span class="reel-action__count">${fmtCount(count)}</span>`;
    return btn;
  }

  function heartGlyph(filled) {
    return filled
      ? '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>';
  }

  function toggleSet(set, id) {
    if (set.has(id)) set.delete(id);
    else set.add(id);
  }

  // ── Right rail: pitch + match ───────────────────────────────────────

  function renderRail() {
    const founder = founderByHandle.get(state.activeHandle);
    railEl.innerHTML = "";

    const pitch = el("section", { class: "pitch" });
    const head = el("header", { class: "pitch__head" }, [
      el("span", { class: "pitch__avatar", html: avatarSvg(founder, 56) }),
      el("div", { class: "pitch__who" }, [
        el("h3", { class: "pitch__name", text: founder.name }),
        el("span", { class: "pitch__handle", text: "@" + founder.handle }),
        el("span", { class: "pitch__tag", text: founder.tagline }),
      ]),
    ]);

    const stats = el("div", { class: "pitch__stats" }, [
      pitchStat(fmtCount(founder.followers), "followers"),
      pitchStat(fmtCount(founder.following), "following"),
      pitchStat(fmtMoney(founder.funded), "funded"),
    ]);

    const bio = el("p", { class: "pitch__bio", text: founder.bio });

    const offerings = el("div", { class: "pitch__offerings" }, [
      el("h4", { class: "pitch__h4", text: "Offerings" }),
      el(
        "ul",
        { class: "pitch__list" },
        founder.offerings.map((o) =>
          el("li", { class: "pitch__offer" }, [
            el("span", { class: "pitch__offer-title", text: o.title }),
            el("span", {
              class: "pitch__offer-price",
              text: o.price === 0 ? "free" : "$" + o.price,
            }),
          ])
        )
      ),
    ]);

    const ask = el("div", { class: "pitch__ask" }, [
      el("h4", { class: "pitch__h4", text: "The ask" }),
      el("div", { class: "pitch__ask-amt", text: fmtMoney(founder.ask.amount) }),
      el("p", { class: "pitch__ask-terms", text: founder.ask.terms }),
      el("button", {
        class: "pitch__fund",
        type: "button",
        text: "Fund on these terms",
        onClick: () => {
          // Funding flow is non-binding here — the deck calls this
          // a disclosure surface. We just acknowledge the gesture.
          alert(
            `On the live platform this opens the disclosure flow for ${founder.name}'s ${fmtMoney(
              founder.ask.amount
            )} ask. You read the terms first; you choose; the founder doesn't negotiate.`
          );
        },
      }),
    ]);

    const principles = el("div", { class: "pitch__principles" }, [
      el("h4", { class: "pitch__h4", text: "Principles" }),
      el(
        "ul",
        { class: "pitch__list pitch__list--principles" },
        founder.principles.map((p) => el("li", { text: p }))
      ),
    ]);

    pitch.append(head, stats, bio, offerings, ask, principles);

    railEl.append(pitch, renderMatch());
  }

  function pitchStat(value, label) {
    return el("div", { class: "pitch__stat" }, [
      el("span", { class: "pitch__stat-v", text: value }),
      el("span", { class: "pitch__stat-l", text: label }),
    ]);
  }

  // ── Match card (the explicit anti-co-founder matcher) ───────────────

  function renderMatch() {
    if (!MATCHES.length) return el("div");
    const match = MATCHES[state.matchIdx % MATCHES.length];
    const seeker = founderByHandle.get(match.seekerHandle);
    const other = founderByHandle.get(match.otherHandle);

    const card = el("section", { class: "match" });
    const head = el("header", { class: "match__head" }, [
      el("span", { class: "match__crumb", text: "Founder Match · working relationship" }),
      el("span", {
        class: "match__count",
        text: `${(state.matchIdx % MATCHES.length) + 1} / ${MATCHES.length}`,
      }),
    ]);

    const note = el("p", {
      class: "match__note",
      text:
        "Not a co-founder match. You already run your work. This is for the relationship two existing founders could have — refer, swap, build for, share numbers.",
    });

    const pair = el("div", { class: "match__pair" }, [
      el("div", { class: "match__face" }, [
        el("span", { class: "match__avatar", html: avatarSvg(seeker, 44) }),
        el("span", { class: "match__name", text: seeker.name }),
        el("span", { class: "match__handle", text: "@" + seeker.handle }),
      ]),
      el("span", { class: "match__bridge" }, [
        el("span", { class: "match__readiness", text: match.readiness + "% fit" }),
        el("span", {
          class: "match__overlap",
          text: match.overlap,
        }),
      ]),
      el("div", { class: "match__face match__face--right" }, [
        el("span", { class: "match__avatar", html: avatarSvg(other, 44) }),
        el("span", { class: "match__name", text: other.name }),
        el("span", { class: "match__handle", text: "@" + other.handle }),
      ]),
    ]);

    const why = el("p", { class: "match__why", text: match.why });

    const acked = state.matchAcks.get(match.id);
    const kinds = el(
      "div",
      { class: "match__kinds" },
      match.kinds.map((kind) => {
        const meta = MATCH_KINDS[kind];
        return el("button", {
          class: "match__kind" + (acked === kind ? " is-acked" : ""),
          type: "button",
          onClick: () => {
            state.matchAcks.set(match.id, kind);
            renderRail();
          },
          html: `<span class="match__kind-glyph">${meta.glyph}</span><span>${meta.label}</span>`,
        });
      })
    );

    const status = acked
      ? el("p", {
          class: "match__status",
          text:
            "Sent — both founders see this as a " +
            MATCH_KINDS[acked].label.toLowerCase() +
            " offer. Either side can decline. Nothing on the cap table moves.",
        })
      : el("p", {
          class: "match__status match__status--pending",
          text: "Pick the shape of the working relationship. The other founder sees the same four buttons on their side.",
        });

    const nav = el("div", { class: "match__nav" }, [
      el("button", {
        class: "match__nav-btn",
        type: "button",
        text: "← skip",
        onClick: () => cycleMatch(-1),
      }),
      el("button", {
        class: "match__nav-btn match__nav-btn--primary",
        type: "button",
        text: "next →",
        onClick: () => cycleMatch(1),
      }),
    ]);

    card.append(head, note, pair, why, kinds, status, nav);
    return card;
  }

  function cycleMatch(delta) {
    state.matchIdx = (state.matchIdx + delta + MATCHES.length) % MATCHES.length;
    renderRail();
  }

  // ── Posts grid (Instagram-style) ────────────────────────────────────

  function renderGrid() {
    gridEl.innerHTML = "";
    const founder = founderByHandle.get(state.activeHandle);
    const posts = POSTS.filter((p) => p.handle === state.activeHandle);
    const fillers = POSTS.filter((p) => p.handle !== state.activeHandle).slice(
      0,
      Math.max(0, 9 - posts.length)
    );
    const tiles = posts.concat(fillers);

    const head = el("header", { class: "gram__grid-head" }, [
      el("h3", { class: "gram__grid-title", text: "From the cohort, tuned to @" + founder.handle }),
      el("span", { class: "gram__grid-sub", text: "Recent posts · most recent first" }),
    ]);
    gridEl.appendChild(head);

    const grid = el("div", { class: "gram__tiles" });
    for (const post of tiles) {
      const author = founderByHandle.get(post.handle);
      const tile = el("article", {
        class: "tile",
        "data-mood": post.imageMood,
        "aria-label": `${author.name} — ${post.tag}`,
      });
      paintBackground(tile, post.imageMood, author.palette);

      const overlay = el("div", { class: "tile__overlay" }, [
        el("span", { class: "tile__tag", text: post.tag }),
        el("p", { class: "tile__caption", text: post.caption }),
        el("div", { class: "tile__meta" }, [
          el("span", { class: "tile__handle", text: "@" + author.handle }),
          el("span", { class: "tile__hours", text: post.hours + "h" }),
        ]),
      ]);

      const isLiked = state.liked.has(post.id);
      const reactBar = el("div", { class: "tile__react" }, [
        el("button", {
          class: "tile__like" + (isLiked ? " is-active" : ""),
          type: "button",
          "aria-label": "Like",
          html:
            heartGlyph(isLiked) +
            `<span class="tile__count">${fmtCount(post.likes + (isLiked ? 1 : 0))}</span>`,
          onClick: (e) => {
            e.stopPropagation();
            toggleSet(state.liked, post.id);
            renderGrid();
          },
        }),
        el("span", {
          class: "tile__comments",
          text: "💬 " + fmtCount(post.comments),
        }),
      ]);

      tile.append(overlay, reactBar);
      tile.addEventListener("click", () => {
        // Click a tile to retune the whole screen to that founder.
        if (state.activeHandle === post.handle) return;
        state.activeHandle = post.handle;
        const ridx = REELS.findIndex((r) => r.handle === post.handle);
        if (ridx >= 0) state.reelIdx = ridx;
        const midx = MATCHES.findIndex(
          (m) => m.seekerHandle === post.handle || m.otherHandle === post.handle
        );
        if (midx >= 0) state.matchIdx = midx;
        renderAll();
      });
      grid.appendChild(tile);
    }
    gridEl.appendChild(grid);
  }

  // ── Top-level render ────────────────────────────────────────────────

  function renderAll() {
    if (!root) return;
    renderStories();
    renderReel();
    renderRail();
    renderGrid();
  }

  // ── Public API for the renderer to call ─────────────────────────────

  window.tinkerGram = {
    mount,
    isMounted: () => root && root.isConnected,
    show: () => {
      if (root) root.setAttribute("data-active", "");
    },
    hide: () => {
      if (root) root.removeAttribute("data-active");
    },
  };
})();
