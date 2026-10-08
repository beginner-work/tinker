/* made-by-lindow-labs.js — quiet credit + labs drawer.
 *
 * [data-made-by-lindow-labs] — Mac app uses window.tinker.openExternal;
 *   on the web, normal target=_blank is left alone.
 *
 * [data-learning-lab] — opens https://lindowlabs.dev/learning in a left
 *   sidebar drawer iframe (PWA, browser tab, and desktop). Href stays the
 *   plain https URL for long-press/copy. If framing is blocked, falls back
 *   to a new tab (or the desktop openExternal bridge).
 */
(function () {
  "use strict";

  /** Stytch login for the Lindow Labs learning dashboard. Hostname is easy to swap. */
  var LEARNING_LAB_URL = "https://lindowlabs.dev/learning";

  var MADE_BY_URL =
    "https://lindowlabs.dev/?utm_source=tinker&utm_campaign=made-by";

  var FRAME_FAIL_MS = 4000;
  var drawer = null;
  var frameTimer = null;
  var frameSettled = false;

  function openExternal(u) {
    if (window.tinker && typeof window.tinker.openExternal === "function") {
      window.tinker.openExternal(u);
      return true;
    }
    return false;
  }

  function openInNewTab(url) {
    if (openExternal(url)) return;
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) { /* ignore */ }
  }

  /**
   * After iframe load: SecurityError reading location ⇒ cross-origin doc
   * loaded (framing worked). Readable about:blank / empty ⇒ likely blocked.
   */
  function framingLooksBlocked(frame) {
    if (!frame || !frame.contentWindow) return true;
    try {
      var href = String(frame.contentWindow.location.href || "");
      if (!href || href === "about:blank") return true;
      // Same-origin error page or blank — treat as blocked.
      return false;
    } catch (err) {
      // Cross-origin: framing succeeded.
      return false;
    }
  }

  function clearFrameTimer() {
    if (frameTimer) {
      clearTimeout(frameTimer);
      frameTimer = null;
    }
  }

  function closeDrawer() {
    clearFrameTimer();
    frameSettled = false;
    document.removeEventListener("keydown", onKeydown, true);
    if (drawer) {
      drawer.remove();
      drawer = null;
    }
    document.documentElement.classList.remove("labs-drawer-open");
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      closeDrawer();
    }
  }

  function fallbackOut(url) {
    if (frameSettled) return;
    frameSettled = true;
    clearFrameTimer();
    closeDrawer();
    openInNewTab(url);
  }

  function openDrawer(url) {
    closeDrawer();
    frameSettled = false;

    drawer = document.createElement("div");
    drawer.className = "labs-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "Lab");

    var scrim = document.createElement("div");
    scrim.className = "labs-drawer__scrim";
    scrim.addEventListener("click", closeDrawer);
    drawer.appendChild(scrim);

    var panel = document.createElement("div");
    panel.className = "labs-drawer__panel";

    var head = document.createElement("div");
    head.className = "labs-drawer__head";

    var close = document.createElement("button");
    close.type = "button";
    close.className = "labs-drawer__close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "\u00d7";
    close.addEventListener("click", closeDrawer);
    head.appendChild(close);
    panel.appendChild(head);

    var frame = document.createElement("iframe");
    frame.className = "labs-drawer__frame";
    frame.setAttribute("title", "Lab");
    frame.setAttribute("referrerpolicy", "no-referrer");
    // Clipboard for copy-code UX; no sandbox — Stytch SMS login + in-frame
    // navigation need scripts, forms, and same-origin storage.
    frame.setAttribute("allow", "clipboard-write");
    frame.addEventListener("error", function () {
      fallbackOut(url);
    });
    frame.addEventListener("load", function () {
      if (frameSettled) return;
      if (framingLooksBlocked(frame)) {
        fallbackOut(url);
        return;
      }
      frameSettled = true;
      clearFrameTimer();
    });
    frame.src = url;
    panel.appendChild(frame);

    drawer.appendChild(panel);
    document.body.appendChild(drawer);
    document.documentElement.classList.add("labs-drawer-open");
    document.addEventListener("keydown", onKeydown, true);

    frameTimer = setTimeout(function () {
      if (!frameSettled) fallbackOut(url);
    }, FRAME_FAIL_MS);

    setTimeout(function () {
      try { close.focus(); } catch (e) { /* ignore */ }
    }, 0);
  }

  function urlFor(anchor) {
    if (!anchor) return MADE_BY_URL;
    if (anchor.hasAttribute("data-learning-lab")) return LEARNING_LAB_URL;
    return MADE_BY_URL;
  }

  function onClick(event) {
    var a = event.target && event.target.closest
      ? event.target.closest("[data-learning-lab], [data-made-by-lindow-labs]")
      : null;
    if (!a) return;

    if (a.hasAttribute("data-learning-lab")) {
      event.preventDefault();
      openDrawer(LEARNING_LAB_URL);
      return;
    }

    if (openExternal(urlFor(a))) {
      event.preventDefault();
    }
  }

  function bind() {
    document.addEventListener("click", onClick, false);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bind);
    } else {
      bind();
    }
  }

  window.tinkerMadeByLindowLabs = {
    url: MADE_BY_URL,
    learningLabUrl: LEARNING_LAB_URL,
    openExternal: openExternal,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    framingLooksBlocked: framingLooksBlocked,
    FRAME_FAIL_MS: FRAME_FAIL_MS,
  };
})();
