/* Browser emit for resume metrics via @vercel/analytics track().
 *
 * Loads the Vercel insights script (if needed), installs beforeSend to
 * drop owner traffic (?owner=1), and exposes trackResumeEvent(name, props)
 * that only accepts names from events.js.
 *
 * UMD: Node tests (module.exports) + browser (window.tinkerMetricsClient).
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function" ? require("./events.js") : null,
    );
  } else {
    root.tinkerMetricsClient = factory(root.tinkerMetricsEvents || null);
  }
})(typeof self !== "undefined" ? self : this, function (eventsMod) {
  "use strict";

  if (!eventsMod) {
    throw new Error("metrics/events is required");
  }

  var AID_KEY = "tinker.reading.aid";
  var OWNER_FLAG_KEY = "tinker.reading.owner";

  function storageGet(key) {
    try {
      if (typeof localStorage === "undefined") return "";
      return localStorage.getItem(key) || "";
    } catch (e) {
      return "";
    }
  }

  function storageSet(key, value) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(key, value);
    } catch (e) { /* ignore */ }
  }

  function randomId() {
    var bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var hex = "";
    for (var j = 0; j < bytes.length; j++) {
      hex += (bytes[j] + 0x100).toString(16).slice(1);
    }
    return "ra_" + hex;
  }

  function getAnonymousId() {
    var existing = storageGet(AID_KEY);
    if (existing && existing.indexOf("ra_") === 0) return existing;
    var id = randomId();
    storageSet(AID_KEY, id);
    // Mirror into a first-party cookie when possible (same-site).
    try {
      document.cookie =
        "tinker_reading_aid=" +
        encodeURIComponent(id) +
        "; path=/; max-age=31536000; SameSite=Lax";
    } catch (e) { /* ignore */ }
    return id;
  }

  function readOwnerFromLocation() {
    try {
      return eventsMod.isOwnerTraffic(window.location.search || "");
    } catch (e) {
      return false;
    }
  }

  function markOwnerFromQuery() {
    if (readOwnerFromLocation()) {
      storageSet(OWNER_FLAG_KEY, "1");
      return true;
    }
    // Untagged traffic is never the owner — clear any stale session flag
    // only when explicitly navigating without owner=1 on a new page load
    // of the widget. We keep the query-param as the source of truth per
    // request: isOwnerTraffic() reads the URL, not this flag, for emit.
    return false;
  }

  function currentIsOwner() {
    // Contract: only ?owner=1. Untagged = not owner.
    return readOwnerFromLocation();
  }

  function ensureInsightsScript() {
    if (typeof document === "undefined") return;
    if (document.querySelector('script[data-tinker-vercel-analytics]')) return;
    var s = document.createElement("script");
    s.defer = true;
    s.src = "/_vercel/insights/script.js";
    s.setAttribute("data-tinker-vercel-analytics", "1");
    s.onerror = function () { /* not on Vercel — silent */ };
    try {
      document.head.appendChild(s);
    } catch (e) { /* ignore */ }
  }

  function installBeforeSend() {
    if (typeof window === "undefined") return;
    // Queue beforeSend before the script boots so owner events are dropped.
    window.va =
      window.va ||
      function () {
        (window.vaq = window.vaq || []).push(arguments);
      };
    window.va("beforeSend", function (event) {
      if (currentIsOwner()) return null;
      return event;
    });
  }

  var vaTrack = null;

  function resolveVaTrack() {
    if (vaTrack) return vaTrack;
    try {
      // Prefer the package when a bundler exposes it; otherwise use window.va.
      if (typeof require === "function") {
        try {
          var mod = require("@vercel/analytics");
          if (mod && typeof mod.track === "function") {
            vaTrack = mod.track.bind(mod);
            return vaTrack;
          }
        } catch (e) { /* browser path */ }
      }
    } catch (e2) { /* ignore */ }
    vaTrack = function (name, props) {
      if (typeof window === "undefined" || typeof window.va !== "function") {
        return;
      }
      window.va("event", { name: name, data: props || {} });
    };
    return vaTrack;
  }

  /**
   * Emit a resume metric. Drops owner traffic. Never throws.
   * @returns {{ ok: boolean, skipped?: string, emitted?: string }}
   */
  function trackResumeEvent(name, props) {
    try {
      var eventName = eventsMod.assertKnownEvent(name);
      if (currentIsOwner()) return { ok: true, skipped: "owner" };
      var clean = eventsMod.sanitizeProps(props || {});
      delete clean.isOwner;
      ensureInsightsScript();
      installBeforeSend();
      var track = resolveVaTrack();
      track(eventName, clean);
      return { ok: true, emitted: eventName };
    } catch (err) {
      return { ok: false, error: String(err && err.message) };
    }
  }

  function trackSessionStart(props) {
    return trackResumeEvent(eventsMod.EVENTS.SESSION_START, props);
  }

  function trackQuestionAsked(props) {
    return trackResumeEvent(eventsMod.EVENTS.QUESTION_ASKED, props);
  }

  function trackSdkLoaded(props) {
    return trackResumeEvent(eventsMod.EVENTS.SDK_LOADED, props);
  }

  function trackAnswerLinkClick(props) {
    return trackResumeEvent(eventsMod.EVENTS.ANSWER_LINK_CLICK, props);
  }

  function embedHostFromLocation() {
    try {
      return String(window.location.hostname || "").toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function embedHostFromQuery() {
    try {
      var q = new URLSearchParams(window.location.search || "");
      return String(q.get("embedHost") || q.get("host") || "")
        .trim()
        .toLowerCase();
    } catch (e) {
      return "";
    }
  }

  /**
   * Prefer parent host passed by embed.js (?embedHost=). Fall back to
   * this frame's hostname only when it is not an excluded first-party host.
   */
  function resolveEmbedHost() {
    var fromQuery = embedHostFromQuery();
    if (fromQuery) return fromQuery;
    return embedHostFromLocation();
  }

  function initReadingMetrics(opts) {
    markOwnerFromQuery();
    ensureInsightsScript();
    installBeforeSend();
    var host =
      (opts && opts.embedHost) || resolveEmbedHost();
    if (!eventsMod.isExcludedEmbedHost(host) && !currentIsOwner()) {
      trackSdkLoaded({
        host: host,
        anonymousId: getAnonymousId(),
      });
    }
    return {
      anonymousId: getAnonymousId(),
      isOwner: currentIsOwner(),
      host: host,
    };
  }

  return {
    AID_KEY: AID_KEY,
    getAnonymousId: getAnonymousId,
    currentIsOwner: currentIsOwner,
    isOwnerTraffic: eventsMod.isOwnerTraffic,
    trackResumeEvent: trackResumeEvent,
    trackSessionStart: trackSessionStart,
    trackQuestionAsked: trackQuestionAsked,
    trackSdkLoaded: trackSdkLoaded,
    trackAnswerLinkClick: trackAnswerLinkClick,
    initReadingMetrics: initReadingMetrics,
    embedHostFromLocation: embedHostFromLocation,
    embedHostFromQuery: embedHostFromQuery,
    resolveEmbedHost: resolveEmbedHost,
    EVENTS: eventsMod.EVENTS,
    EVENT_NAMES: eventsMod.EVENT_NAMES,
  };
});
