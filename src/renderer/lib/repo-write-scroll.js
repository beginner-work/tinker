/* Writing-column scroll target math for /repo pad.
 *
 * When a follow-up question appears, the pad used to scroll the caret near
 * the top of the window. That left a sliced half-line of earlier writing
 * under the Electron titlebar / traffic lights. These helpers:
 *   1. Reserve a top safe area (titlebar + padding, phone notch).
 *   2. Place the question top at or below that offset.
 *   3. Snap so a previous paragraph is either fully above the fold or
 *      fully visible — never a mid-line peek. Choice: fully away when the
 *      peek would be less than ~1.5 lines (calm; the soft CSS fade covers
 *      the boundary).
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
   * opts:
   *   questionTop  — document Y of the question block top
   *   safeTop      — viewport offset from resolveWriteSafeTopPx
   *   prevBottom   — document Y of the previous paragraph/turn bottom (optional)
   *   lineHeight   — approx line height for partial-line detection
   *   fadePx       — fade band height (informational; snap uses lineHeight)
   *   scrollY      — current scroll (unused; kept for callers/tests)
   */
  function computeQuestionScrollTop(opts) {
    opts = opts || {};
    var questionTop = clampNonNeg(opts.questionTop);
    var safeTop = clampNonNeg(opts.safeTop);
    var lineHeight = Number(opts.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      lineHeight = WRITE_SCROLL.DEFAULT_LINE_HEIGHT_PX;
    }
    var target = Math.max(0, questionTop - safeTop);

    var prevBottom = opts.prevBottom;
    if (prevBottom != null && Number.isFinite(Number(prevBottom))) {
      prevBottom = Number(prevBottom);
      // How much of the previous block would stick into the viewport above
      // the question once we align the question to safeTop.
      var visiblePrev = prevBottom - target;
      if (visiblePrev > 0 && visiblePrev < lineHeight * WRITE_SCROLL.PARTIAL_LINE_FACTOR) {
        // Partial line peek — scroll it fully away (previous bottom at or
        // above the viewport top). Question stays below safeTop because
        // questionTop >= prevBottom and safeTop is positive; if the gap is
        // tiny, prefer no sliced text over exact safeTop alignment.
        target = Math.max(target, prevBottom);
      }
    }

    return Math.max(0, Math.round(target));
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
    documentTop: documentTop,
  };
});
