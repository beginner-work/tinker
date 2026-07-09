/* POST /api/email/send — send an email from the founder's domain.
 *
 * The in-app email composer (src/renderer/email.js) posts here; this
 * function relays to the beginner mcp Worker's REST sender
 * (`POST <BEGINNER_MCP_URL>/email/send`), which owns the Cloudflare
 * Send Email binding on the beginner.work zone. tinker holds no mail
 * credential of its own — the backend-monolith pattern: the only
 * secrets here are the Worker's URL + bearer token, and the browser
 * never sees either.
 *
 * Auth: every request re-validates against Stytch (same pattern as
 * /api/user-data/*) — only a signed-in founder can send.
 *
 * Body: { to, subject, text, html?, fromName?, replyTo? }. The From
 * address itself is the Worker's configured beginner.work sender —
 * clients can pick a display name and Reply-To, never the address.
 *
 * Env: BEGINNER_MCP_TOKEN — the bearer the Worker accepts, which for
 * this route is either its MCP_BEARER_TOKEN or its CLOUDFLARE_API_TOKEN
 * (the Worker deliberately accepts the default Cloudflare token on
 * /email/send so no new secret needs minting); CLOUDFLARE_API_TOKEN is
 * read as a fallback env name so an existing var can be reused as-is.
 * BEGINNER_MCP_URL overrides the canonical Worker URL below. No token →
 * friendly 503, nothing breaks.
 *
 * Inherited constraint (Cloudflare Email Routing): delivery only works
 * to *verified destination addresses* on the account. The Worker
 * returns an actionable error for anything else; we pass it through so
 * the composer can show it.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");

// The deployed beginner mcp Worker — the one backend that can send mail.
const DEFAULT_MCP_URL = "https://beginner-mcp.tyler-lindow.workers.dev";

// A whole email (headers + text + optional HTML) comfortably fits; anything
// larger than 512 KB is almost certainly a bug or abuse.
const MAX_BYTES = 512 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function str(v, max) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s.length > max ? "" : s;
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const mcpUrl = (process.env.BEGINNER_MCP_URL || DEFAULT_MCP_URL).replace(/\/+$/, "");
  const mcpToken = process.env.BEGINNER_MCP_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";
  if (!mcpToken) {
    res.status(503).json({
      error: "Sending email isn't configured on this deployment.",
      detail: "Set BEGINNER_MCP_TOKEN (or CLOUDFLARE_API_TOKEN) to a bearer the beginner mcp Worker accepts.",
    });
    return;
  }

  // Auth — the server is the source of truth, same as /api/user-data/*.
  try {
    const token = extractBearer(req.headers && req.headers.authorization);
    const session = await authenticateSession(token);
    const userId =
      (session && session.session && session.session.user_id) ||
      (session && session.user && session.user.user_id) ||
      "";
    if (!userId) throw Object.assign(new Error("Session missing user id"), { status: 401 });
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Invalid request" });
    return;
  }

  const to = str(body.to, 254);
  const subject = str(body.subject, 998);
  const text = str(body.text, 100000);
  const html = str(body.html, 500000);
  const fromName = str(body.fromName, 128);
  const replyTo = str(body.replyTo, 254);

  if (!EMAIL_RE.test(to)) {
    res.status(400).json({ error: "Enter a valid recipient address." });
    return;
  }
  if (!subject) {
    res.status(400).json({ error: "A subject is required." });
    return;
  }
  if (!text) {
    res.status(400).json({ error: "A message is required." });
    return;
  }
  if (replyTo && !EMAIL_RE.test(replyTo)) {
    res.status(400).json({ error: "Enter a valid Reply-To address." });
    return;
  }

  // Relay to the Worker. Note: no `from` — the Worker's configured
  // beginner.work sender is the domain identity; only the display name
  // and Reply-To are the founder's to choose.
  const payload = { to, subject, text };
  if (html) payload.html = html;
  if (fromName) payload.fromName = fromName;
  if (replyTo) payload.replyTo = replyTo;

  let upstream;
  let result;
  try {
    upstream = await fetch(`${mcpUrl}/email/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${mcpToken}`,
      },
      body: JSON.stringify(payload),
    });
    result = await upstream.json().catch(() => null);
  } catch {
    res.status(502).json({ error: "Couldn't reach the mail service. Try again in a moment." });
    return;
  }

  if (!upstream.ok) {
    const message = (result && result.error) || `Send failed (${upstream.status}).`;
    // 401/403/5xx from the Worker are our misconfiguration, not the
    // founder's input — don't blame the request.
    const status = upstream.status === 400 || upstream.status === 413 ? 400 : 502;
    res.status(status).json({ error: message });
    return;
  }

  res.status(200).json({
    sent: true,
    from: (result && result.from) || "",
    to: (result && result.to) || to,
    subject: (result && result.subject) || subject,
  });
});
