/* Writing-column scroll target math for /repo pad.
 *
 * When a follow-up question appears, the pad used to scroll the caret near
 * the top of the window. That left a sliced half-line of earlier writing
 * under the Electron titlebar / traffic lights. These helpers:
 *   1. Reserve a top safe area (titlebar + padding, phone notch).
 *   2. Place the question top at or below that offset.
 *   3. Leave prior text in the safe band to the fixed top fade (opaque at
 *      y=0) so nothing hard-slices under the titlebar. Never pull the
 *      question up into that band just to hide a previous line.
 *
 * After the bottom essays panel (#490), desktop writing scrolls inside
 * `.repo-panel__write .repo-surface`, not the window. Panel helpers keep the
 * question in normal document flow: latest typed text stays visible above it,
 * and the sticky Keep crafting bar gets a reserved bottom band.
 *
 * Pure helpers so unit tests cover offsets without booting Electron.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerRepoWriteScroll = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Single place to tune titlebar / fade clearance. */
  var WRITE_SCROLL = {
    // Electron hiddenInset traffic lights (~y:18) + drag strip.
    DESKTOP_TITLEBAR_PX: 52,
    DESKTOP_PAD_PX: 12,
    // Matches existing phone .repo-surface.writing top padding.
    PHONE_BASE_PX: 48,
    // Web desktop/browser without Electron chrome.
    WEB_BASE_PX: 16,
    FADE_PX: 48,
    PARTIAL_LINE_FACTOR: 1.5,
    DEFAULT_LINE_HEIGHT_PX: 24,
    // Bottom essays panel: keep question + prior text clear of sticky foot.
    PANEL_TOP_PAD_PX: 8,
    PANEL_FOOT_RESERVE_PX: 64,
    // Keep a readable slice of the previous turn above the question card.
    PANEL_PREV_CONTEXT_PX: 112,
  };

  function clampNonNeg(n) {
    var x = Number(n);
    if (!Number.isFinite(x) || x < 0) return 0;
    return x;
  }

  /**
   * Top safe-area offset in CSS pixels.
   * opts: { isDesktop, isPhone, safeAreaInsetTop }
   */
  function resolveWriteSafeTopPx(opts) {
    opts = opts || {};
    var inset = clampNonNeg(opts.safeAreaInsetTop);
    if (opts.isDesktop) {
      return WRITE_SCROLL.DESKTOP_TITLEBAR_PX + WRITE_SCROLL.DESKTOP_PAD_PX + inset;
    }
    if (opts.isPhone) {
      return WRITE_SCROLL.PHONE_BASE_PX + inset;
    }
    return WRITE_SCROLL.WEB_BASE_PX + inset;
  }

  /**
   * Window scrollY so the question lands at/below the safe area.
   *
   * Snap choice (calm): always park the question at safeTop. Previous
   * writing that would sit in the titlebar band is covered by the fixed
   * top fade (opaque near y=0, soft dissolve into the pad). Never bump
   * scroll to prevBottom when that would pull the question up under the
   * traffic lights / fade.
   *
   * opts:
   *   questionTop  — document Y of the question block top
   *   safeTop      — viewport offset from resolveWriteSafeTopPx
   *   prevBottom   — document Y of the previous paragraph/turn bottom (optional)
   *   lineHeight   — approx line height (reserved for callers/tests)
   *   fadePx       — fade band height (reserved for callers/tests)
   *   scrollY      — current scroll (unused; kept for callers/tests)
   */
  function computeQuestionScrollTop(opts) {
    opts = opts || {};
    var questionTop = clampNonNeg(opts.questionTop);
    var safeTop = clampNonNeg(opts.safeTop);
    return Math.max(0, Math.round(questionTop - safeTop));
  }

  /**
   * Scroll offset inside the bottom-panel writing surface so the latest typed
   * text and the follow-up question stay visible together. The question stays
   * in normal flow (never covers essay text); bottomReserved clears the sticky
   * Keep crafting / This is everything bar.
   *
   * opts:
   *   questionOffsetTop     — question top relative to scroll content
   *   questionHeight        — question block height
   *   prevOffsetBottom      — previous turn/paragraph bottom (optional)
   *   containerClientHeight — visible height of the scrollport
   *   topPadding            — inset from scrollport top (default PANEL_TOP_PAD_PX)
   *   bottomReserved        — sticky foot band (default PANEL_FOOT_RESERVE_PX)
   *   maxScroll             — scrollHeight - clientHeight
   */
  function computePanelQuestionScrollTop(opts) {
    opts = opts || {};
    var qTop = clampNonNeg(opts.questionOffsetTop);
    var qH = clampNonNeg(opts.questionHeight);
    var prevBottom = opts.prevOffsetBottom;
    if (prevBottom == null || !Number.isFinite(Number(prevBottom))) {
      prevBottom = qTop;
    } else {
      prevBottom = clampNonNeg(prevBottom);
    }
    var clientH = clampNonNeg(opts.containerClientHeight);
    var topPad = opts.topPadding != null
      ? clampNonNeg(opts.topPadding)
      : WRITE_SCROLL.PANEL_TOP_PAD_PX;
    var bottomReserved = opts.bottomReserved != null
      ? clampNonNeg(opts.bottomReserved)
      : WRITE_SCROLL.PANEL_FOOT_RESERVE_PX;
    var maxScroll = clampNonNeg(opts.maxScroll);

    // Prefer: keep a slice of the previous turn above the question so the
    // latest typed lines stay readable (not only the turn's bottom edge).
    var prevContext = opts.prevContextPx != null
      ? clampNonNeg(opts.prevContextPx)
      : WRITE_SCROLL.PANEL_PREV_CONTEXT_PX;
    var preferred = Math.max(0, prevBottom - Math.max(topPad, prevContext));

    var visibleBottom = Math.max(topPad + 1, clientH - bottomReserved);
    var qBottom = qTop + qH;
    // Question bottom must sit above the foot reserve.
    var minForQuestion = Math.max(0, qBottom - visibleBottom);
    // Question top must not clip under the scrollport top.
    var maxForQuestionTop = Math.max(0, qTop - topPad);

    var top = preferred;
    if (top < minForQuestion) top = minForQuestion;
    // When the panel is too short for prior text + question + foot, prefer
    // clearing the sticky foot over parking the question under the top edge.
    if (top > maxForQuestionTop) {
      if (maxForQuestionTop >= minForQuestion) top = maxForQuestionTop;
      else top = minForQuestion;
    }
    if (top > maxScroll) top = maxScroll;
    if (top < 0) top = 0;
    return Math.round(top);
  }

  /**
   * Nearest panel-hosted writing surface that actually scrolls, or null when
   * the page still uses window scrolling (mobile / legacy full-height pad).
   */
  function findWriteScrollContainer(el) {
    if (!el || typeof el.closest !== "function") return null;
    try {
      var panel = el.closest(".repo-panel__write");
      if (!panel) return null;
      var surface = panel.querySelector
        ? panel.querySelector(".repo-surface.writing")
        : null;
      if (!surface) return null;
      // Panel CSS sets overflow-y:auto on this surface; confirm it can scroll.
      try {
        var style = typeof window !== "undefined" && window.getComputedStyle
          ? window.getComputedStyle(surface)
          : null;
        var oy = style ? String(style.overflowY || "") : "auto";
        if (oy === "hidden" || oy === "visible" || oy === "clip") {
          // Still prefer the surface when it is the panel host; callers scroll it.
        }
      } catch (e) { /* ignore */ }
      return surface;
    } catch (e2) {
      return null;
    }
  }

  /**
   * Element top relative to a scroll container's content box.
   */
  function offsetTopWithin(el, container) {
    if (!el || !container) return 0;
    try {
      if (typeof el.getBoundingClientRect === "function"
        && typeof container.getBoundingClientRect === "function") {
        var er = el.getBoundingClientRect();
        var cr = container.getBoundingClientRect();
        return er.top - cr.top + (container.scrollTop || 0);
      }
    } catch (e) { /* fall through */ }
    return documentTop(el, 0);
  }

  /**
   * Document Y of an element top relative to the scrolling root.
   * Uses offsetTop chain when getBoundingClientRect + scrollY is unavailable.
   */
  function documentTop(el, scrollY) {
    if (!el) return 0;
    try {
      if (typeof el.getBoundingClientRect === "function") {
        var rect = el.getBoundingClientRect();
        var y = Number(scrollY);
        if (!Number.isFinite(y)) {
          y = (typeof window !== "undefined" && window.scrollY) || 0;
        }
        return rect.top + y;
      }
    } catch (e) { /* fall through */ }
    var top = 0;
    var node = el;
    while (node) {
      top += node.offsetTop || 0;
      node = node.offsetParent;
    }
    return top;
  }

  return {
    WRITE_SCROLL: WRITE_SCROLL,
    resolveWriteSafeTopPx: resolveWriteSafeTopPx,
    computeQuestionScrollTop: computeQuestionScrollTop,
    computePanelQuestionScrollTop: computePanelQuestionScrollTop,
    findWriteScrollContainer: findWriteScrollContainer,
    offsetTopWithin: offsetTopWithin,
    documentTop: documentTop,
  };
});
