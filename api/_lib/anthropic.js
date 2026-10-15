/* Shared Anthropic Messages call for the tinker deploy.
 *
 * Used by POST /api/claude/converse (the writing UI and the seed-vector
 * classifier) and by the MCP follow-up tools. The key stays server-side.
 * Whatever system prompt the caller passes is wrapped in cache_control
 * ephemeral, matching the converse proxy.
 */

"use strict";

const models = require("../../src/renderer/lib/claude-models.js");

async function callAnthropic({ system, messages, model, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), {
      status: 503,
    });
  }
  const body = {
    model: model || models.DEFAULT || "claude-opus-4-7",
    // Opus 5.5 adaptive thinking shares the output budget; allow headroom.
    max_tokens: Math.min(Math.max(Number(maxTokens) || 2048, 1), 16000),
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
  const text = (data.content || [])
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  return { text: text, usage: data.usage };
}

module.exports = { callAnthropic };
