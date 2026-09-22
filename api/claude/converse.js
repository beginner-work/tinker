/* POST /api/claude/converse
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { system, messages, model, maxTokens }
 * Reply: { text, usage }
 *
 * Stytch-gated proxy for the writing-flow turns in src/renderer/writing.js
 * and the seed-vector classifier in src/renderer/heatmap.js. Mirrors
 * api/search.js — both call Stytch's /sessions/authenticate on every
 * request, so a reload (or the Update banner click) doesn't burn the
 * caller down to the 5-minute JWT clock. Anthropic Messages call shape
 * matches the search proxy; the system prompt + messages + model +
 * maxTokens arrive from the renderer instead of being hard-coded.
 *
 * Caching: whatever system prompt the renderer sends is wrapped in
 * cache_control ephemeral, so repeat turns within the same draft (or
 * back-to-back classifications) hit the prompt cache. The Messages
 * call itself lives in api/_lib/anthropic.js so /api/mcp can reuse it.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");
const { callAnthropic } = require("../_lib/anthropic.js");

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(typeof req.body === "string" ? req.body : "{}");
  } catch {
    return null;
  }
}

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = extractBearer(req.headers && req.headers.authorization);
  try {
    await authenticateSession(token);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  try {
    const result = await callAnthropic({
      system: body.system,
      messages,
      model: body.model,
      maxTokens: body.maxTokens,
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Upstream error" });
  }
});
