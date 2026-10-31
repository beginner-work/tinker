/* Server-side resume-metric emit.
 *
 * Routes every Vercel Web Analytics custom event through the typed
 * contract in src/renderer/lib/metrics/events.js. Owner traffic is
 * dropped. Prisma remains the source of truth; Vercel is the dashboard.
 */

"use strict";

const events = require("../../../src/renderer/lib/metrics/events.js");

let trackFnCache = null;

function loadVercelTrack() {
  if (trackFnCache) return trackFnCache;
  try {
    // Optional: missing or failing import must never break the API.
    // eslint-disable-next-line global-require
    const mod = require("@vercel/analytics/server");
    trackFnCache = typeof mod.track === "function" ? mod.track.bind(mod) : null;
  } catch {
    trackFnCache = null;
  }
  return trackFnCache;
}

/**
 * @param {string} name
 * @param {Record<string, string|number|boolean>} props
 * @param {{ isOwner?: boolean, trackFn?: Function, headers?: object }} [opts]
 */
async function emitResumeEvent(name, props, opts) {
  const eventName = events.assertKnownEvent(name);
  if (opts && opts.isOwner) {
    return { ok: true, skipped: "owner" };
  }
  // Defense in depth: never emit when props claim owner.
  if (props && (props.isOwner === true || props.isOwner === "true" || props.isOwner === 1)) {
    return { ok: true, skipped: "owner" };
  }

  const clean = events.sanitizeProps(props || {});
  // Never send owner flag as a true custom-event property into Vercel.
  delete clean.isOwner;

  const doTrack = (opts && opts.trackFn) || loadVercelTrack();
  if (!doTrack) {
    return { ok: true, skipped: "no_vercel_track" };
  }

  try {
    const options = {};
    if (opts && opts.headers) options.headers = opts.headers;
    if (opts && opts.request) options.request = opts.request;
    await doTrack(eventName, clean, Object.keys(options).length ? options : undefined);
    return { ok: true, emitted: eventName };
  } catch (err) {
    console.error("[metrics] vercel track failed", err && err.message);
    return { ok: false, error: String(err && err.message) };
  }
}

async function emitSessionStart(props, opts) {
  return emitResumeEvent(events.EVENTS.SESSION_START, props, opts);
}

async function emitQuestionAsked(props, opts) {
  return emitResumeEvent(events.EVENTS.QUESTION_ASKED, props, opts);
}

async function emitSdkLoaded(props, opts) {
  return emitResumeEvent(events.EVENTS.SDK_LOADED, props, opts);
}

async function emitAnswerLinkClick(props, opts) {
  return emitResumeEvent(events.EVENTS.ANSWER_LINK_CLICK, props, opts);
}

module.exports = {
  emitResumeEvent,
  emitSessionStart,
  emitQuestionAsked,
  emitSdkLoaded,
  emitAnswerLinkClick,
  events,
  EVENTS: events.EVENTS,
  EVENT_NAMES: events.EVENT_NAMES,
  isOwnerTraffic: events.isOwnerTraffic,
  isExcludedEmbedHost: events.isExcludedEmbedHost,
};
