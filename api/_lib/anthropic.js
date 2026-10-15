/* Shared Anthropic Messages call for the tinker deploy.
 *
 * Used by POST /api/claude/converse (the writing UI and the seed-vector
 * classifier) and by the MCP follow-up tools. The key stays server-side.
 * Whatever system prompt the caller passes is wrapped in cache_control
 * ephemeral, matching the converse proxy.
 *
 * Structured JSON: pass output_config / output_format (json_schema) or
 * tools + tool_choice. tool_use.input is surfaced as toolUse + structured
 * and also JSON.stringified into text for older parsers.
 */

"use strict";

const models = require("../../src/renderer/lib/claude-models.js");

function extractContent(data) {
  const blocks = Array.isArray(data && data.content) ? data.content : [];
  const text = blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  const toolBlock = blocks.find(
    (b) => b && b.type === "tool_use" && b.input && typeof b.input === "object"
  );
  const toolUse = toolBlock
    ? {
        id: toolBlock.id || null,
        name: toolBlock.name || null,
        input: toolBlock.input,
      }
    : null;
  const structured = toolUse ? toolUse.input : null;
  // When the model answered via tool_use, older callers still read .text.
  const outText =
    text ||
    (structured ? JSON.stringify(structured) : "");
  return {
    text: outText,
    toolUse: toolUse,
    structured: structured,
    content: blocks,
  };
}

async function callAnthropic({
  system,
  messages,
  model,
  maxTokens,
  tools,
  tool_choice,
  output_config,
  output_format,
} = {}) {
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
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
  }
  if (tool_choice && typeof tool_choice === "object") {
    body.tool_choice = tool_choice;
  }
  // Prefer GA output_config.format. Accept legacy output_format and map it.
  if (output_config && typeof output_config === "object") {
    body.output_config = output_config;
  } else if (output_format && typeof output_format === "object") {
    body.output_config = { format: output_format };
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
  const extracted = extractContent(data);
  return {
    text: extracted.text,
    toolUse: extracted.toolUse,
    structured: extracted.structured,
    content: extracted.content,
    usage: data.usage,
  };
}

module.exports = { callAnthropic, extractContent };
