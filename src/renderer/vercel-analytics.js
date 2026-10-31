/* Vercel Web Analytics — page views for the main app shell.
 *
 * Loads /_vercel/insights/script.js which is the same endpoint
 * @vercel/analytics's inject() uses. Product funnel + keystrokes still go
 * only to Tinker's first-party /api/analytics.
 *
 * Resume / reading-agent custom events (session_start, question_asked,
 * sdk_loaded, answer_link_click) are emitted only through
 * src/renderer/lib/metrics/client-track.js and api/_lib/metrics/emit.js.
 * See RESUME_METRICS.md. Custom events need Web Analytics enabled on
 * Production (and a plan tier that supports custom events).
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
