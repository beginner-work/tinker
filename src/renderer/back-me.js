/* back-me.js — open the founder's "Back me" page (their profile QR).
 *
 * Pitching happens on beginner, a different origin: a founder signed into
 * tinker has no session there, so we carry the session token across in the
 * URL fragment (#share&ts=<token>) — the on-device-only channel
 * pwa-session.js uses, since a fragment is never sent to a server. beginner's
 * profile page reads `ts`, recognises the owner, shows the QR, then scrubs
 * the token from the URL.
 *
 * Where the page opens depends on the runtime:
 *   - Installed PWA (display-mode: standalone / navigator.standalone): open
 *     it in an in-app overlay iframe, so the founder never leaves the app to
 *     show their code — they pull it up, someone scans it, done.
 *   - Everywhere else (plain browser tab, Electron, Capacitor): hand off to
 *     the system browser via the platform openExternal shim (or window.open).
 *
 * Exposed as window.tinkerBackMe so the sidebar Pitch button and the profile
 * menu share one implementation (the "also works outside the Pitch button"
 * entry point).
 */
(function () {
  "use strict";

  // Canonical production Back me page, deep-linked to the QR (#share). Kept
  // host-agnostic on purpose: tinker production is itself on *.vercel.app, so
  // we must not gate on the hostname (see pitch-backme.test.js / sidebar-tree).
  var BASE = "https://beginner.work/tyler-lindow#share";

  function token() {
    try { return localStorage.getItem("tinker_jwt") || ""; }
    catch (e) { return ""; }
  }

  function backMeUrl() {
    var t = token();
    return t ? BASE + "&ts=" + encodeURIComponent(t) : BASE;
  }

  // Matches share.js: an installed PWA reports standalone display-mode (or
  // navigator.standalone on iOS). Wrapped runtimes (Capacitor/Electron) have
  // their own browser handoff, so they fall through to openExternal.
  function isStandalone() {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.navigator && window.navigator.standalone === true) return true;
    return false;
  }

  function openExternal(url) {
    if (window.tinker && typeof window.tinker.openExternal === "function") {
      window.tinker.openExternal(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  // ── In-app overlay (PWA) ──────────────────────────────────────────────
  var overlay = null;

  function closeOverlay() {
    if (!overlay) return;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") { e.stopPropagation(); closeOverlay(); }
  }

  function openOverlay(url) {
    closeOverlay();
    overlay = document.createElement("div");
    overlay.className = "backme-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Your Back me page");

    var backdrop = document.createElement("div");
    backdrop.className = "backme-overlay__backdrop";
    backdrop.addEventListener("click", closeOverlay);
    overlay.appendChild(backdrop);

    var panel = document.createElement("div");
    panel.className = "backme-overlay__panel";

    var close = document.createElement("button");
    close.type = "button";
    close.className = "backme-overlay__close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×"; // ×
    close.addEventListener("click", closeOverlay);
    panel.appendChild(close);

    var frame = document.createElement("iframe");
    frame.className = "backme-overlay__frame";
    frame.setAttribute("title", "Your Back me page");
    // The token rides in the fragment (never sent), but keep the Referer
    // clean regardless — beginner only needs the fragment, not who linked in.
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.src = url;
    panel.appendChild(frame);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);
    setTimeout(function () { try { close.focus(); } catch (e) { /* ignore */ } }, 0);
  }

  function open() {
    var url = backMeUrl();
    if (isStandalone()) openOverlay(url);
    else openExternal(url);
  }

  window.tinkerBackMe = { open: open, url: backMeUrl, close: closeOverlay };
})();
