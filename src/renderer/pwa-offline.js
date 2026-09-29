/* pwa-offline.js — register the offline app-shell service worker (sw.js).
 *
 * Scoped to "/" so the worker can serve every navigation. Registration
 * waits for `load` so it never competes with first paint, and it's
 * best-effort: if it fails, the app simply behaves as it does today
 * (online-only).
 *
 * Skipped where a service worker is the wrong tool or unavailable:
 *   - Electron — it ships its own shell and updater, and runs from
 *     file:// where SW isn't available anyway.
 *   - Browsers without serviceWorker support, or non-secure contexts.
 *
 * When a new worker takes control (skipWaiting + clients.claim), reload
 * once so the installed PWA picks up fresh HTML/CSS/JS instead of
 * keeping a half-old document alive under the new controller.
 */

(function () {
  "use strict";

  function isWrappedRuntime() {
    if (window.tinker && window.tinker.supportsWebview === true) return true;
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

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
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
      .catch(() => { /* offline shell is a progressive enhancement */ });
  });
})();
