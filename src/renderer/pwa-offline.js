/* pwa-offline.js — register the offline app-shell service worker (sw.js).
 *
 * Scoped to "/" so the worker can serve every navigation. Registration
 * waits for `load` so it never competes with first paint, and it's
 * best-effort: if it fails, the app simply behaves as it does today
 * (online-only).
 *
 * Skipped where a service worker is the wrong tool or unavailable:
 *   - Electron / Capacitor — they ship their own shells and updaters,
 *     and run from file:// where SW isn't available anyway.
 *   - Browsers without serviceWorker support, or non-secure contexts.
 */

(function () {
  "use strict";

  function isWrappedRuntime() {
    if (window.Capacitor) return true;
    if (window.tinker && window.tinker.supportsWebview === true) return true;
    return false;
  }

  if (isWrappedRuntime()) return;
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return; // https / localhost only

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => { /* offline shell is a progressive enhancement */ });
  });
})();
