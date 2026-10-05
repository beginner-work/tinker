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
