/* Resume-metrics event contract.
 *
 * Single source of truth for Vercel Web Analytics custom event names and
 * property keys used by the reading agent / SDK embed. Every emit must go
 * through api/_lib/metrics/emit.js (server) or
 * src/renderer/lib/metrics/client-track.js (browser). Do not call
 * @vercel/analytics track() ad hoc with these names.
 *
 * Guardrail: RESUME_METRICS.md at the repo root. CI fails if that file and
 * this module drift apart (event rename/remove without updating the doc).
 *
 * UMD: Node (module.exports) + browser (window.tinkerMetricsEvents).
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerMetricsEvents = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** @type {const} */
  const EVENTS = {
    SESSION_START: "session_start",
    QUESTION_ASKED: "question_asked",
    SDK_LOADED: "sdk_loaded",
    ANSWER_LINK_CLICK: "answer_link_click",
  };

  const EVENT_NAMES = Object.freeze([
    EVENTS.SESSION_START,
    EVENTS.QUESTION_ASKED,
    EVENTS.SDK_LOADED,
    EVENTS.ANSWER_LINK_CLICK,
  ]);

  /** Shared property keys (string values only for Vercel custom events). */
  const PROPS = Object.freeze({
    ANONYMOUS_ID: "anonymousId",
    SESSION_ID: "sessionId",
    HOST: "host",
    SOURCE_HOST: "sourceHost",
    /** Hostname only of the article being read (never a full URL). */
    SITE_DOMAIN: "site_domain",
    /** Client surface: web | ios | android | embed */
    PLATFORM: "platform",
    TARGET: "target",
    INPUT: "input",
    IS_OWNER: "isOwner",
  });

  const PLATFORMS = Object.freeze(["web", "ios", "android", "embed"]);

  function normalizePlatform(raw) {
    const v = String(raw || "")
      .trim()
      .toLowerCase();
    if (PLATFORMS.includes(v)) return v;
    return "";
  }

  const EXCLUDED_EMBED_HOSTS = Object.freeze([
    "lindowlabs.dev",
    "www.lindowlabs.dev",
    "localhost",
    "127.0.0.1",
    // First-party Tinker hosts (widget origin, not an embed customer).
    "tinker.beginner.work",
    "beginner.work",
    "www.beginner.work",
  ]);

  function isExcludedEmbedHost(host) {
    const h = String(host || "")
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");
    if (!h) return true;
    if (EXCLUDED_EMBED_HOSTS.includes(h) || EXCLUDED_EMBED_HOSTS.includes(`www.${h}`)) {
      return true;
    }
    if (h === "beginner.work" || h.endsWith(".beginner.work")) return true;
    if (h === "lindowlabs.dev" || h.endsWith(".lindowlabs.dev")) return true;
    // Vercel preview / branch hosts.
    if (h.endsWith(".vercel.app")) return true;
    if (h.includes("---") && h.endsWith(".vercel.app")) return true;
    if (/^.*-git-.*\.vercel\.app$/.test(h)) return true;
    return false;
  }

  /**
   * Owner traffic is only when explicitly tagged (?owner=1). Untagged is
   * never the owner.
   */
  function isOwnerTraffic(searchOrFlag) {
    if (searchOrFlag === true || searchOrFlag === 1 || searchOrFlag === "1") {
      return true;
    }
    if (searchOrFlag && typeof searchOrFlag === "object") {
      if (searchOrFlag.owner === true || searchOrFlag.owner === 1 || searchOrFlag.owner === "1") {
        return true;
      }
      if (searchOrFlag.isOwner === true) return true;
    }
    const raw = String(searchOrFlag == null ? "" : searchOrFlag);
    try {
      const q = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
      return q.get("owner") === "1";
    } catch {
      return /(?:^|[?&])owner=1(?:&|$)/.test(raw);
    }
  }

  function assertKnownEvent(name) {
    const n = String(name || "");
    if (!EVENT_NAMES.includes(n)) {
      throw new Error(`Unknown resume metric event: ${n}`);
    }
    return n;
  }

  function sanitizeProps(props) {
    const out = {};
    if (!props || typeof props !== "object" || Array.isArray(props)) return out;
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v == null) continue;
      const t = typeof v;
      if (t === "string" || t === "number" || t === "boolean") {
        out[key] = t === "string" ? String(v).slice(0, 256) : v;
      }
    }
    return out;
  }

  return {
    EVENTS,
    EVENT_NAMES,
    PROPS,
    PLATFORMS,
    EXCLUDED_EMBED_HOSTS,
    isExcludedEmbedHost,
    isOwnerTraffic,
    assertKnownEvent,
    sanitizeProps,
    normalizePlatform,
  };
});
