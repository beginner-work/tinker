/* pwa-offline.js — register the offline app-shell service worker (sw.js).
 *
 * Scoped to "/" so the worker can serve every navigation. Registration
 * waits for `load` so it never competes with first paint, and it's
 * best-effort: if it fails, the app simply behaves as it does today
 * (online-only).
 *
 * The worker URL is versioned (`sw.js?v=N`) so clients fetch a new script
 * even when a CDN still holds a long-cached `/sw.js`. Keep N in sync with
 * CACHE_VERSION in sw.js (tinker-shell-vN).
 *
 * Skipped where a service worker is the wrong tool or unavailable:
 *   - Electron — the desktop shell loads production in a BrowserWindow
 *     and skips the PWA service worker (supportsWebview / isDesktopApp).
 *   - Browsers without serviceWorker support, or non-secure contexts.
 *
 * When a new worker takes control (skipWaiting + clients.claim), reload
 * once so the installed PWA picks up fresh HTML/CSS/JS instead of
 * keeping a half-old document alive under the new controller.
 */

(function () {
  "use strict";

  // Keep in sync with CACHE_VERSION in sw.js (tinker-shell-v39 -> v=39).
  // Bump the query whenever bare /sw.js or a prior pin is stuck in a CDN HIT.
  var SW_URL = "/sw.js?v=39";

  function isWrappedRuntime() {
    if (window.tinker && window.tinker.supportsWebview === true) return true;
    if (window.tinker && window.tinker.isDesktopApp === true) return true;
    try {
      if (document.documentElement && document.documentElement.getAttribute("data-tinker-desktop") === "1") {
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  if (isWrappedRuntime()) return;
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return; // https / localhost only

  var refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register(SW_URL)
      .then(function (reg) {
        // If a new worker is already waiting (e.g. tab was open across a
        // deploy), ask it to activate. sw.js also calls skipWaiting on
        // install; this covers the waiting→active handoff for open clients.
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        if (!reg || typeof reg.addEventListener !== "function") return;
        reg.addEventListener("updatefound", function () {
          var worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", function () {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(function () { /* offline shell is a progressive enhancement */ });
  });
})();
