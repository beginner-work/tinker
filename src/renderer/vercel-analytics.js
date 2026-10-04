/* Vercel Web Analytics — page views only (Hobby free tier).
 *
 * Loads /_vercel/insights/script.js which is the same endpoint
 * @vercel/analytics's inject() uses. We deliberately do NOT call track()
 * / custom events (those require Pro). Keystrokes and product events go
 * only to Tinker's first-party /api/analytics.
 *
 * Skipped when DNT or Global Privacy Control is set. Harmless no-op on
 * non-Vercel hosts (script 404s silently).
 *
 * Dashboard: Project → Analytics → Enable Web Analytics (one-time toggle).
 */
(function () {
  "use strict";

  function prefersNoTracking() {
    try {
      if (navigator.globalPrivacyControl === true) return true;
      var dnt = navigator.doNotTrack || navigator.msDoNotTrack || window.doNotTrack;
      return dnt === "1" || dnt === "yes" || dnt === 1;
    } catch (e) {
      return false;
    }
  }

  if (prefersNoTracking()) return;

  // Avoid double-inject.
  if (document.querySelector('script[data-tinker-vercel-analytics]')) return;

  var s = document.createElement("script");
  s.defer = true;
  s.src = "/_vercel/insights/script.js";
  s.setAttribute("data-tinker-vercel-analytics", "1");
  s.onerror = function () { /* not on Vercel or analytics disabled — silent */ };
  try {
    document.head.appendChild(s);
  } catch (e) { /* ignore */ }
})();
