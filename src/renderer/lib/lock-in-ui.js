/* Lock-in overlay: fullscreen train-out moment before the exercise editor.
 *
 * Matches Tinker cream / Fraunces / Instrument Sans. One deliberate click
 * ("Not now") leaves early. Progress line starts moving as the editor opens.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerLockInUi = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STYLE_ID = "tinker-lock-in-style";
  var ROOT_ID = "tinker-lock-in";
  var PROGRESS_ID = "tinker-lock-in-progress";

  function ensureStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#" + ROOT_ID + "{",
      "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;",
      "background:radial-gradient(120% 80% at 50% 20%,#fff8e8 0%,#fffdf7 45%,#f3efe4 100%);",
      "color:var(--color-foreground,#2d2a26);font-family:var(--font-sans,\"Instrument Sans\",system-ui,sans-serif);",
      "animation:tinker-lock-in-arrive 700ms ease-out both;",
      "}",
      "#" + ROOT_ID + "[hidden]{display:none!important;}",
      "#" + ROOT_ID + " .lock-in__rail{",
      "position:absolute;left:0;right:0;top:0;height:3px;background:rgba(45,42,38,0.08);overflow:hidden;",
      "}",
      "#" + ROOT_ID + " .lock-in__rail-fill{",
      "height:100%;width:0;background:linear-gradient(90deg,#7bc47a,#7dd3fc,#c8b6e2);",
      "animation:tinker-lock-in-rail 3.2s linear forwards;",
      "}",
      "#" + ROOT_ID + " .lock-in__inner{text-align:center;padding:32px 28px;max-width:28rem;}",
      "#" + ROOT_ID + " .lock-in__eyebrow{",
      "margin:0 0 12px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-muted,#8a8478);",
      "}",
      "#" + ROOT_ID + " .lock-in__name{",
      "margin:0;font-family:var(--font-display,Fraunces,Georgia,serif);",
      "font-variation-settings:var(--font-display-settings,\"SOFT\" 100,\"WONK\" 0,\"opsz\" 144);",
      "font-size:clamp(28px,5vw,40px);font-weight:650;letter-spacing:-0.02em;line-height:1.15;",
      "animation:tinker-lock-in-drift 3.2s ease-in-out both;",
      "}",
      "#" + ROOT_ID + " .lock-in__resume{",
      "margin:14px 0 0;font-size:15px;line-height:1.45;color:var(--color-muted,#8a8478);",
      "}",
      "#" + ROOT_ID + " .lock-in__count{",
      "margin:28px 0 0;font-family:var(--font-display,Fraunces,Georgia,serif);",
      "font-size:56px;font-weight:650;letter-spacing:-0.03em;tabular-nums;",
      "}",
      "#" + ROOT_ID + " .lock-in__leave{",
      "margin-top:28px;appearance:none;border:1px solid var(--color-border,#e5e0d4);",
      "background:transparent;color:var(--color-muted,#8a8478);border-radius:10px;",
      "padding:10px 16px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;",
      "}",
      "#" + ROOT_ID + " .lock-in__leave:hover{color:var(--color-foreground,#2d2a26);}",
      "#" + PROGRESS_ID + "{",
      "position:fixed;left:0;right:0;top:0;z-index:9000;height:2px;pointer-events:none;",
      "background:transparent;",
      "}",
      "#" + PROGRESS_ID + "[hidden]{display:none!important;}",
      "#" + PROGRESS_ID + " .lock-in-progress__fill{",
      "height:100%;width:12%;",
      "background:linear-gradient(90deg,#7bc47a,#7dd3fc,#c8b6e2,#7bc47a);",
      "background-size:200% 100%;",
      "animation:tinker-lock-in-progress 8s linear infinite;",
      "}",
      "@keyframes tinker-lock-in-arrive{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
      "@keyframes tinker-lock-in-drift{from{transform:translateX(-8px)}to{transform:translateX(8px)}}",
      "@keyframes tinker-lock-in-rail{from{width:0}to{width:100%}}",
      "@keyframes tinker-lock-in-progress{",
      "0%{transform:translateX(-20%);background-position:0% 0}",
      "100%{transform:translateX(120%);background-position:100% 0}",
      "}",
    ].join("\n");
    document.head.appendChild(style);
  }

  function clearNode(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function showProgressLine() {
    if (typeof document === "undefined") return null;
    ensureStyles();
    var el = document.getElementById(PROGRESS_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = PROGRESS_ID;
      el.setAttribute("aria-hidden", "true");
      var fill = document.createElement("div");
      fill.className = "lock-in-progress__fill";
      el.appendChild(fill);
      document.body.appendChild(el);
    }
    el.hidden = false;
    return el;
  }

  function hideProgressLine() {
    if (typeof document === "undefined") return;
    var el = document.getElementById(PROGRESS_ID);
    if (el) el.hidden = true;
  }

  /**
   * @param {object} opts
   * @param {string} opts.name
   * @param {string} [opts.resumeLabel]
   * @param {number} [opts.seconds]
   * @param {function} [opts.onComplete]
   * @param {function} [opts.onLeave]
   * @param {function} [opts.onEnterFullscreen]
   * @param {function} [opts.onExitFullscreen]
   * @param {object} [opts.lockIn] - tinkerLockIn helpers
   */
  function startLockIn(opts) {
    var options = opts || {};
    if (typeof document === "undefined") {
      return { cancel: function () {}, root: null };
    }
    ensureStyles();
    var lockIn = options.lockIn || (typeof window !== "undefined" ? window.tinkerLockIn : null);
    var existing = document.getElementById(ROOT_ID);
    if (existing) existing.remove();

    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Starting your next exercise");

    var rail = document.createElement("div");
    rail.className = "lock-in__rail";
    rail.setAttribute("aria-hidden", "true");
    var railFill = document.createElement("div");
    railFill.className = "lock-in__rail-fill";
    rail.appendChild(railFill);
    root.appendChild(rail);

    var inner = document.createElement("div");
    inner.className = "lock-in__inner";

    var eyebrow = document.createElement("p");
    eyebrow.className = "lock-in__eyebrow";
    eyebrow.textContent = "Next exercise";
    inner.appendChild(eyebrow);

    var name = document.createElement("h1");
    name.className = "lock-in__name";
    name.textContent = String(options.name || "Exercise");
    inner.appendChild(name);

    var resume = document.createElement("p");
    resume.className = "lock-in__resume";
    resume.textContent = String(options.resumeLabel || "Pick up where you left off");
    inner.appendChild(resume);

    var count = document.createElement("p");
    count.className = "lock-in__count";
    count.setAttribute("aria-live", "polite");
    count.textContent = "";
    inner.appendChild(count);

    var leave = document.createElement("button");
    leave.type = "button";
    leave.className = "lock-in__leave";
    leave.textContent = "Not now";
    inner.appendChild(leave);

    root.appendChild(inner);
    document.body.appendChild(root);

    if (typeof options.onEnterFullscreen === "function") {
      try { options.onEnterFullscreen(); } catch (e) { /* ignore */ }
    }

    var finished = false;
    var runner = null;

    function cleanupOverlay() {
      if (root && root.parentNode) root.parentNode.removeChild(root);
    }

    function exitFullscreen() {
      if (typeof options.onExitFullscreen === "function") {
        try { options.onExitFullscreen(); } catch (e) { /* ignore */ }
      }
    }

    function complete() {
      if (finished) return;
      finished = true;
      if (runner) runner.cancel();
      cleanupOverlay();
      showProgressLine();
      exitFullscreen();
      if (typeof options.onComplete === "function") options.onComplete();
    }

    function leaveEarly() {
      if (finished) return;
      finished = true;
      if (runner) runner.cancel();
      cleanupOverlay();
      hideProgressLine();
      exitFullscreen();
      if (typeof options.onLeave === "function") options.onLeave();
    }

    leave.addEventListener("click", leaveEarly);

    if (lockIn && typeof lockIn.runCountdown === "function") {
      runner = lockIn.runCountdown({
        seconds: options.seconds,
        onTick: function (n) {
          count.textContent = String(n);
          if (lockIn.playSoftChime) lockIn.playSoftChime();
        },
        onDone: complete,
      });
    } else {
      count.textContent = "1";
      setTimeout(complete, 800);
    }

    return {
      cancel: leaveEarly,
      root: root,
      complete: complete,
    };
  }

  return {
    STYLE_ID: STYLE_ID,
    ROOT_ID: ROOT_ID,
    PROGRESS_ID: PROGRESS_ID,
    ensureStyles: ensureStyles,
    showProgressLine: showProgressLine,
    hideProgressLine: hideProgressLine,
    startLockIn: startLockIn,
  };
});
