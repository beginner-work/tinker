/* Shared sanitizers for first-party analytics ingest.
 *
 * Never persist draft text, titles, or keystroke contents. Counts,
 * lengths, buckets, and error kinds are allowed. First-touch utm_* /
 * ref / referrerHost travel with the anonymous id and copy onto the
 * user id at link time.
 */

"use strict";

const FORBIDDEN_PROP_KEYS = new Set([
  "text",
  "body",
  "title",
  "content",
  "draft",
  "answer",
  "question",
  "notes",
  "message",
  "markdown",
  "value",
  "input",
  "key",
  "keystroke",
  "keystrokes",
  "transcript",
  "stitched",
  "essay",
]);

const ALLOWED_PROP_KEYS = new Set([
  "duration_ms",
  "word_count_bucket",
  "error_kind",
  "is_new",
  "button",
  "target",
  "from_path",
  "to_path",
]);

const DEVICE_TYPES = new Set(["phone", "tablet", "desktop"]);

function trimStr(value, max) {
  if (typeof value !== "string") return "";
  const t = value.trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max) : t;
}

function isForbiddenKey(key) {
  const k = String(key || "").toLowerCase();
  if (FORBIDDEN_PROP_KEYS.has(k)) return true;
  if (k.includes("text") || k.includes("title") || k.includes("content")) return true;
  if (k.includes("draft") || k.includes("answer") || k.includes("keystroke")) return true;
  return false;
}

function sanitizeProps(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const key of Object.keys(raw)) {
    if (isForbiddenKey(key)) continue;
    if (!ALLOWED_PROP_KEYS.has(key)) continue;
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = Math.round(value);
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      // Still refuse long strings that look like writing.
      const t = value.trim();
      if (!t || t.length > 64) continue;
      if (/\s{2,}/.test(t) && t.length > 24) continue;
      out[key] = t;
    }
  }
  return out;
}

function parseTs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function sanitizeEvent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const name = trimStr(raw.name, 64).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) return null;
  const anonymousId = trimStr(raw.anonymousId || raw.anonymous_id, 80);
  if (!anonymousId || anonymousId.length < 8) return null;
  const sessionId = trimStr(raw.sessionId || raw.session_id, 80) || "unknown";
  let deviceType = trimStr(raw.deviceType || raw.device_type, 16).toLowerCase() || "desktop";
  if (!DEVICE_TYPES.has(deviceType)) deviceType = "desktop";
  const viewportW = Math.max(0, Math.min(10000, Number(raw.viewportW || raw.viewport_w) || 0)) | 0;
  const viewportH = Math.max(0, Math.min(10000, Number(raw.viewportH || raw.viewport_h) || 0)) | 0;
  const path = trimStr(raw.path, 256) || "/";
  if (path.includes("://") || path.includes("\\")) return null;
  const appVersion = trimStr(raw.appVersion || raw.app_version, 32);
  const utmSource = trimStr(raw.utmSource || raw.utm_source, 128);
  const utmMedium = trimStr(raw.utmMedium || raw.utm_medium, 128);
  const utmCampaign = trimStr(raw.utmCampaign || raw.utm_campaign, 128);
  const utmContent = trimStr(raw.utmContent || raw.utm_content, 128);
  const ref = trimStr(raw.ref, 128);
  const referrerHost = trimStr(raw.referrerHost || raw.referrer_host, 128).toLowerCase();
  const userId = trimStr(raw.userId || raw.user_id, 128);
  return {
    name,
    ts: parseTs(raw.ts || raw.timestamp),
    anonymousId,
    userId,
    sessionId,
    deviceType,
    viewportW,
    viewportH,
    path,
    appVersion,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    ref,
    referrerHost,
    props: sanitizeProps(raw.props),
  };
}

function attributionFromEvent(ev) {
  return {
    utmSource: ev.utmSource || "",
    utmMedium: ev.utmMedium || "",
    utmCampaign: ev.utmCampaign || "",
    utmContent: ev.utmContent || "",
    ref: ev.ref || "",
    referrerHost: ev.referrerHost || "",
  };
}

function attributionHasValue(attr) {
  return !!(attr.utmSource || attr.utmMedium || attr.utmCampaign || attr.utmContent || attr.ref || attr.referrerHost);
}

module.exports = {
  FORBIDDEN_PROP_KEYS,
  ALLOWED_PROP_KEYS,
  sanitizeProps,
  sanitizeEvent,
  attributionFromEvent,
  attributionHasValue,
  isForbiddenKey,
};
