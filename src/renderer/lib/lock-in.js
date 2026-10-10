/* Lock-in moment: countdown timing + soft chime helpers (pure / DOM-light).
 *
 * The train-pulling-out overlay lives in lock-in-ui.js. This module owns
 * countdown ticks and a soft Web Audio tone so unit tests stay headless.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerLockIn = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_SECONDS = 3;
  var DEFAULT_TICK_MS = 1000;

  function normalizeSeconds(n) {
    var s = Number(n);
    if (!Number.isFinite(s) || s < 1) return DEFAULT_SECONDS;
    return Math.min(10, Math.floor(s));
  }

  /**
   * Build descending tick values, e.g. seconds=3 → [3, 2, 1].
   */
  function countdownTicks(seconds) {
    var total = normalizeSeconds(seconds);
    var out = [];
    for (var i = total; i >= 1; i -= 1) out.push(i);
    return out;
  }

  /**
   * Run a countdown. Calls onTick(n) for each second, then onDone().
   * Returns { cancel } — cancel skips onDone (early leave).
   */
  function runCountdown(opts) {
    var options = opts || {};
    var ticks = countdownTicks(options.seconds);
    var tickMs = Number(options.tickMs);
    if (!Number.isFinite(tickMs) || tickMs < 50) tickMs = DEFAULT_TICK_MS;
    var onTick = typeof options.onTick === "function" ? options.onTick : function () {};
    var onDone = typeof options.onDone === "function" ? options.onDone : function () {};
    var setTimer = typeof options.setTimeoutFn === "function"
      ? options.setTimeoutFn
      : setTimeout;
    var clearTimer = typeof options.clearTimeoutFn === "function"
      ? options.clearTimeoutFn
      : clearTimeout;

    var cancelled = false;
    var timer = null;
    var index = 0;

    function step() {
      if (cancelled) return;
      if (index >= ticks.length) {
        onDone();
        return;
      }
      onTick(ticks[index]);
      index += 1;
      timer = setTimer(step, tickMs);
    }

    step();

    return {
      cancel: function () {
        cancelled = true;
        if (timer != null) clearTimer(timer);
        timer = null;
      },
      ticks: ticks.slice(),
    };
  }

  /**
   * Soft short tone (train-departure vibe). No-ops when AudioContext missing.
   * @returns {boolean} whether a tone was scheduled
   */
  function playSoftChime(audioCtxOrFactory) {
    try {
      var ctx = null;
      if (audioCtxOrFactory && typeof audioCtxOrFactory.createOscillator === "function") {
        ctx = audioCtxOrFactory;
      } else if (typeof audioCtxOrFactory === "function") {
        ctx = audioCtxOrFactory();
      } else if (typeof window !== "undefined") {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
      }
      if (!ctx) return false;
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(392, now); // G4
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.35);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    DEFAULT_SECONDS: DEFAULT_SECONDS,
    DEFAULT_TICK_MS: DEFAULT_TICK_MS,
    normalizeSeconds: normalizeSeconds,
    countdownTicks: countdownTicks,
    runCountdown: runCountdown,
    playSoftChime: playSoftChime,
  };
});
