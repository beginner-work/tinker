/* Response-body logging for the Vercel functions.
 *
 * When the deployment is a preview (VERCEL_ENV === "preview"), every JSON
 * response written via `res.json(...)` is echoed to the function log
 * alongside the method, URL, and status code. Production stays silent —
 * we don't want real users' payloads sitting in logs — and so does local
 * `vercel dev` (VERCEL_ENV === "development") where the dev console is
 * already the source of truth.
 *
 * Wrap any handler at its module.exports boundary:
 *
 *   module.exports = withResponseLogging(async function handler(req, res) {
 *     ...
 *   });
 *
 * The wrapper proxies `res.json`; nothing else changes, and the handler
 * itself doesn't need to know about logging.
 */

"use strict";

// Cap each logged body so a 256 KB user-data PUT doesn't fill the log
// with a single line. 8 KB is more than enough to debug API shapes.
const MAX_BODY_CHARS = 8 * 1024;

function isPreview() {
  return process.env.VERCEL_ENV === "preview";
}

const CAREER_KEYS = new Set([
  "verified_facts",
  "unverified_facts",
  "proposed_facts",
  "rejected_facts",
  "facts",
  "claims",
  "excerpt",
  "baseline",
  "mechanism",
]);

function containsCareer(value, depth) {
  if (depth > 6) return false;
  if (typeof value === "string") {
    return value.includes("\"verified_facts\"")
      || value.includes("\"unverified_facts\"")
      || value.includes("\"proposed_facts\"")
      || value.includes("\"excerpt\"")
      || value.includes("\"verdict\"");
  }
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsCareer(item, depth + 1));
  for (const key of Object.keys(value)) {
    if (CAREER_KEYS.has(key)) return true;
    if (containsCareer(value[key], depth + 1)) return true;
  }
  return false;
}

function logBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (containsCareer(body, 0)) return { redacted: "career" };
  if (!Object.prototype.hasOwnProperty.call(body, "your_user_id")) return body;
  const copy = { ...body };
  delete copy.your_user_id;
  return copy;
}

function withResponseLogging(handler) {
  return async function wrappedHandler(req, res) {
    if (!isPreview()) return handler(req, res);

    const origJson = res.json.bind(res);
    res.json = function loggingJson(body) {
      try {
        const method = (req && req.method) || "?";
        const url = (req && req.url) || "?";
        const status = res.statusCode || 200;
        const serialized = JSON.stringify(logBody(body));
        const trimmed =
          serialized && serialized.length > MAX_BODY_CHARS
            ? serialized.slice(0, MAX_BODY_CHARS) + "…[truncated]"
            : serialized;
        console.log(`[preview] ${method} ${url} ${status} ${trimmed}`);
      } catch {
        // Never let logging break the response.
      }
      return origJson(body);
    };

    return handler(req, res);
  };
}

module.exports = { withResponseLogging, isPreview };
