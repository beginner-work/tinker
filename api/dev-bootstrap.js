/* GET /api/dev-bootstrap
 *
 * One-URL bootstrap that lets an automated browser (Browserbase MCP from
 * Claude Code, in particular) enter the preview deployment past both
 * auth walls in a single navigation:
 *
 *   1. Vercel's "Authentication Required" page — bypassed at the edge by
 *      appending `?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`
 *      to this URL. Vercel consumes those query params before the request
 *      reaches the function, so this handler never sees them.
 *
 *   2. The Stytch SMS-OTP gate the app enforces — bypassed by returning a
 *      tiny HTML page that writes a pre-minted Stytch session token into
 *      `localStorage.tinker_jwt` and redirects to `next` (default `/`).
 *
 * The endpoint is gated on `TEST_AUTH_TOKEN` being present in env. That
 * var is only set in the Preview scope, so production silently 404s on
 * this path — no surface to leak. Inside the gate, the incoming
 * `test_auth` query param is compared constant-time against the env
 * value, then the pre-minted `TEST_SESSION_TOKEN` (also Preview-only env)
 * is inlined into the HTML response. The token never appears in URLs.
 *
 * Usage:
 *
 *   https://<preview>.vercel.app/api/dev-bootstrap
 *     ?test_auth=<TEST_AUTH_TOKEN>
 *     &x-vercel-protection-bypass=<VERCEL_AUTOMATION_BYPASS_SECRET>
 *     &x-vercel-set-bypass-cookie=true
 *     &next=/
 */

"use strict";

const crypto = require("crypto");
const { withResponseLogging } = require("./_lib/log.js");

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function safeNext(raw) {
  if (typeof raw !== "string" || raw === "") return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.includes(":")) return "/";
  if (raw.length > 200) return "/";
  return raw;
}

function jsLiteral(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function notFound(res) {
  res.status(404);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send("Not found");
}

module.exports = withResponseLogging(function handler(req, res) {
  const expected = process.env.TEST_AUTH_TOKEN;
  if (!expected) {
    notFound(res);
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send("Method not allowed");
    return;
  }

  const query = req.query || {};
  if (!constantTimeEqual(String(query.test_auth || ""), expected)) {
    notFound(res);
    return;
  }

  const sessionToken = process.env.TEST_SESSION_TOKEN;
  if (!sessionToken) {
    res.status(503);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send("TEST_SESSION_TOKEN is not configured.");
    return;
  }

  const next = safeNext(query.next);

  const html = `<!doctype html>
<meta charset="utf-8">
<title>tinker dev session</title>
<meta name="robots" content="noindex, nofollow">
<script>
  (function () {
    try {
      localStorage.setItem("tinker_jwt", ${jsLiteral(sessionToken)});
      location.replace(${jsLiteral(next)});
    } catch (err) {
      document.body.textContent = "Failed to seed session: " + (err && err.message || err);
    }
  })();
</script>
<noscript>JavaScript is required to seed the dev session.</noscript>
`;

  res.status(200);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.send(html);
});
