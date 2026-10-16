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
 *
 * Opus 5.5 always runs adaptive thinking; max_tokens covers thinking plus
 * the visible reply. Prefer a high max_tokens and output_config.effort
 * (e.g. "low") for long structured JSON such as That's everything.
 */

"use strict";

const models = require("../../src/renderer/lib/claude-models.js");

// Opus 5.5 max output is 128k; keep a generous but finite ceiling so a
// runaway client cannot burn the whole budget in one call.
const MAX_OUTPUT_TOKENS = 64000;

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
  let structured = toolUse ? toolUse.input : null;
  // json_schema structured outputs arrive as a text block. Surface them as
  // structured when the text is a JSON object so callers don't re-parse.
  if (!structured && text) {
    const trimmed = String(text).trim();
    if (trimmed.charAt(0) === "{") {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          structured = parsed;
        }
      } catch {
        /* leave structured null; extractStructuredPayload may still salvage */
      }
    }
  }
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

/** Safe shape log — never logs prompt/reply bodies or secrets. */
function logReplyShape(meta) {
  try {
    console.log(
      JSON.stringify({
        kind: "claude_reply_shape",
        model: meta.model || null,
        stop_reason: meta.stop_reason || null,
        block_types: meta.block_types || [],
        text_len: meta.text_len || 0,
        has_tool_use: !!meta.has_tool_use,
        has_structured: !!meta.has_structured,
        used_output_format: !!meta.used_output_format,
        used_tools: !!meta.used_tools,
        usage: meta.usage || null,
      })
    );
  } catch {
    /* never break the response on logging */
  }
}

const MCP_CLIENT_BETA = "mcp-client-2025-11-20";

async function callAnthropic({
  system,
  messages,
  model,
  maxTokens,
  tools,
  tool_choice,
  output_config,
  output_format,
  mcp_servers,
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
    max_tokens: Math.min(
      Math.max(Number(maxTokens) || 2048, 1),
      MAX_OUTPUT_TOKENS
    ),
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
  if (Array.isArray(mcp_servers) && mcp_servers.length) {
    body.mcp_servers = mcp_servers;
  }
  // Prefer GA output_config.format. Accept legacy output_format and map it.
  // Merge carefully so effort + format can coexist (Opus 5.5).
  if (output_config && typeof output_config === "object") {
    body.output_config = Object.assign({}, output_config);
    if (
      !body.output_config.format &&
      output_format &&
      typeof output_format === "object"
    ) {
      body.output_config.format = output_format;
    }
  } else if (output_format && typeof output_format === "object") {
    body.output_config = { format: output_format };
  }

  const headers = {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  if (Array.isArray(body.mcp_servers) && body.mcp_servers.length) {
    headers["anthropic-beta"] = MCP_CLIENT_BETA;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && (data.error?.message || data.error)) || `Anthropic ${res.status}`;
    // Preserve 4xx so callers can distinguish schema/tool_choice rejections
    // from upstream 5xx (mapped friendly retries otherwise hide the cause).
    const status =
      res.status >= 400 && res.status < 500 ? res.status : 502;
    throw Object.assign(new Error(typeof message === "string" ? message : "Upstream error"), {
      status: status,
      upstreamStatus: res.status,
    });
  }
  const extracted = extractContent(data);
  const blockTypes = (extracted.content || [])
    .map((b) => (b && b.type ? b.type : null))
    .filter(Boolean);
  logReplyShape({
    model: body.model,
    stop_reason: data && data.stop_reason,
    block_types: blockTypes,
    text_len: String(extracted.text || "").length,
    has_tool_use: !!extracted.toolUse,
    has_structured: !!extracted.structured,
    used_output_format: !!(body.output_config && body.output_config.format),
    used_tools: !!(Array.isArray(body.tools) && body.tools.length),
    usage: data && data.usage
      ? {
          input_tokens: data.usage.input_tokens,
          output_tokens: data.usage.output_tokens,
        }
      : null,
  });
  return {
    text: extracted.text,
    toolUse: extracted.toolUse,
    structured: extracted.structured,
    content: extracted.content,
    stop_reason: (data && data.stop_reason) || null,
    usage: data.usage,
  };
}

module.exports = {
  callAnthropic,
  extractContent,
  MAX_OUTPUT_TOKENS,
  MCP_CLIENT_BETA,
  logReplyShape,
};
