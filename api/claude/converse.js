/* POST /api/claude/converse
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { system, messages, model, maxTokens }
 * Reply: { text, usage }
 *
 * Stytch-gated proxy for the writing-flow turns in src/renderer/writing.js
 * and the location-vector classifier in src/renderer/heatmap.js. Mirrors
 * api/search.js — both call Stytch's /sessions/authenticate on every
 * request, so a reload (or the Update banner click) doesn't burn the
 * caller down to the 5-minute JWT clock. Anthropic Messages call shape
 * matches the search proxy; the system prompt + messages + model +
 * maxTokens arrive from the renderer instead of being hard-coded.
 *
 * Caching: whatever system prompt the renderer sends is wrapped in
 * cache_control ephemeral, so repeat turns within the same draft (or
 * back-to-back classifications) hit the prompt cache.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");

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

async function callAnthropic({ system, messages, model, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), {
      status: 503,
    });
  }
  const body = {
    model: model || "claude-sonnet-4-6",
    max_tokens: Math.min(Math.max(Number(maxTokens) || 2048, 1), 8192),
    messages,
  };
  if (system) {
    body.system = [
      { type: "text", text: String(system), cache_control: { type: "ephemeral" } },
    ];
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && (data.error?.message || data.error)) || `Anthropic ${res.status}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return { text: textBlock ? textBlock.text : "", usage: data.usage };
}

module.exports = async function handler(req, res) {
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
};
