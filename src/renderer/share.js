/* share.js — sidebar "Share tinker" button.
 *
 * The button lives in the sidebar account list and is `hidden` by
 * default. We only reveal it when the app is running as an installed
 * PWA (display-mode: standalone, or navigator.standalone on iOS). In a
 * plain browser tab the URL bar already exposes Share / Copy Link, so a
 * second control would be noise; on Electron desktop the OS menu covers
 * it.
 *
 * On click we call navigator.share() — which raises the native iOS /
 * Android share sheet, or the Web Share polyfill where present.
 * When the Web Share API isn't available (older Chromium on Linux),
 * we fall back to writing the URL to the clipboard and flashing
 * "Copied" beside the label so the tap still produces something useful.
 */

(function () {
  function isStandalone() {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.navigator && window.navigator.standalone === true) return true;
    return false;
  }

  function isWrappedRuntime() {
    // Electron desktop — OS menus cover Share; skip the in-app control.
    if (window.tinker && window.tinker.supportsWebview === true) return true;
    return false;
  }

  function shareUrl() {
    // Prefer the manifest's start_url so a shared link opens the
    // app's landing screen rather than whatever deep view the
    // current user happens to be on.
    const origin = window.location.origin;
    if (origin && /^https?:/.test(origin)) return origin + "/";
    return window.location.href;
  }

  function flash(node, text) {
    if (!node) return;
    node.textContent = text;
    node.classList.add("is-visible");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => {
      node.classList.remove("is-visible");
      node.textContent = "";
    }, 1800);
  }

  async function doShare(btn) {
    const flashEl = btn.querySelector("[data-share-flash]");
    const url = shareUrl();
    const payload = {
      title: "tinker",
      text: "A quiet place to be on the web.",
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (err) {
        // AbortError = user dismissed the share sheet; stay quiet.
        if (err && err.name === "AbortError") return;
        // Fall through to clipboard on any other failure.
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        flash(flashEl, "Copied");
        return;
      }
    } catch { /* ignore */ }
    flash(flashEl, "Couldn't share");
  }

  function init() {
    const btn = document.getElementById("nav-share");
    if (!btn) return;
    if (!isStandalone() && !isWrappedRuntime()) return;
    btn.hidden = false;
    btn.addEventListener("click", () => { doShare(btn); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
