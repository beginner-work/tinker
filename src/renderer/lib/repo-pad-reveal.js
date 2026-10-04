/* Adaptive Keep crafting / This is everything reveal timing.
 *
 * Rolling median of recent keystroke gaps → pause delay ≈ 4× median,
 * clamped. Pure helpers so unit tests cover fast/slow/clamps/cold start
 * without booting the /repo page harness.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerRepoPadReveal = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Single place to tune reveal sensitivity. */
  var PAD_REVEAL = {
    GAP_WINDOW: 20,
    MAX_GAP_MS: 10000,
    MIN_SAMPLES: 5,
    MULTIPLIER: 4,
    MIN_DELAY_MS: 600,
    MAX_DELAY_MS: 4000,
    DEFAULT_DELAY_MS: 1500,
  };

  function clamp(n, lo, hi) {
    var x = Number(n);
    if (!Number.isFinite(x)) return lo;
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
  }

  function median(nums) {
    var list = Array.isArray(nums) ? nums.filter(function (n) {
      return Number.isFinite(n) && n >= 0;
    }) : [];
    if (!list.length) return null;
    var sorted = list.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Record a gap from the previous typing keystroke.
   * Gaps over MAX_GAP_MS are ignored (new burst). Returns next state.
   */
  function recordGap(gaps, lastAt, now, config) {
    var cfg = config || PAD_REVEAL;
    var nextGaps = Array.isArray(gaps) ? gaps.slice() : [];
    var t = Number(now);
    if (!Number.isFinite(t)) t = Date.now();
    var prev = Number(lastAt);
    if (Number.isFinite(prev) && prev > 0) {
      var gap = t - prev;
      if (gap > 0 && gap <= cfg.MAX_GAP_MS) {
        nextGaps.push(gap);
        if (nextGaps.length > cfg.GAP_WINDOW) {
          nextGaps = nextGaps.slice(nextGaps.length - cfg.GAP_WINDOW);
        }
      }
    }
    return { gaps: nextGaps, lastAt: t };
  }

  /**
   * Delay after the owner pauses before showing the action island.
   * Cold start (< MIN_SAMPLES gaps) → DEFAULT_DELAY_MS.
   */
  function computeRevealDelayMs(gaps, config) {
    var cfg = config || PAD_REVEAL;
    var list = Array.isArray(gaps) ? gaps : [];
    if (list.length < cfg.MIN_SAMPLES) return cfg.DEFAULT_DELAY_MS;
    var med = median(list);
    if (med == null) return cfg.DEFAULT_DELAY_MS;
    return Math.round(clamp(med * cfg.MULTIPLIER, cfg.MIN_DELAY_MS, cfg.MAX_DELAY_MS));
  }

  /** Printable / edit keys that feed the gap rolling window. */
  function isTypingKey(event) {
    if (!event) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    var key = event.key || "";
    if (key === "Backspace" || key === "Delete" || key === "Enter") return true;
    if (key.length === 1) return true;
    return false;
  }

  /** Any key that should hide the island and restart the pause timer. */
  function isRevealResetKey(event) {
    if (!event) return false;
    var key = event.key || "";
    if (!key || key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") {
      return false;
    }
    // Cmd/Ctrl+Enter is Keep crafting — hide path skipped by the caller.
    if ((event.metaKey || event.ctrlKey) && (key === "Enter" || key === "NumpadEnter")) {
      return false;
    }
    return true;
  }

  return {
    PAD_REVEAL: PAD_REVEAL,
    clamp: clamp,
    median: median,
    recordGap: recordGap,
    computeRevealDelayMs: computeRevealDelayMs,
    isTypingKey: isTypingKey,
    isRevealResetKey: isRevealResetKey,
  };
});
