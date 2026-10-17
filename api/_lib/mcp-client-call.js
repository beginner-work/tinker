/* Minimal outbound MCP tools/call over Streamable HTTP.
 *
 * Used by Connections context (Notion search/fetch) with the owner's
 * encrypted OAuth token. Tests inject fetchImpl.
 */

"use strict";

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * @param {object} args
 * @param {string} args.url MCP endpoint
 * @param {string} args.accessToken
 * @param {string} args.toolName
 * @param {object} [args.arguments]
 * @param {function} [args.fetchImpl]
 * @param {string} [args.id]
 */
async function callMcpTool(args) {
  const url = String((args && args.url) || "").trim();
  const accessToken = String((args && args.accessToken) || "").trim();
  const toolName = String((args && args.toolName) || "").trim();
  if (!url || !accessToken || !toolName) {
    throw fail(400, "url, accessToken, and toolName are required.");
  }
  const fetchFn = (args && args.fetchImpl) || fetch;
  const id = (args && args.id) || "tinker-" + Date.now().toString(36);
  const body = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: toolName,
      arguments:
        args && args.arguments && typeof args.arguments === "object"
          ? args.arguments
          : {},
    },
  };
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Authorization: "Bearer " + accessToken,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Some gateways return SSE; pull the first data: JSON object.
    const match = String(text || "").match(/data:\s*(\{[\s\S]*?\})\s*(?:\n|$)/);
    if (match) {
      try {
        payload = JSON.parse(match[1]);
      } catch {
        payload = null;
      }
    }
  }
  if (!res.ok) {
    const msg =
      (payload && (payload.error && payload.error.message)) ||
      "MCP tool call failed (" + res.status + ").";
    throw fail(res.status >= 400 && res.status < 500 ? res.status : 502, String(msg), "mcp_http");
  }
  if (payload && payload.error) {
    throw fail(
      502,
      String(payload.error.message || payload.error) || "MCP tool error.",
      "mcp_tool_error"
    );
  }
  return {
    result: payload && payload.result != null ? payload.result : payload,
    raw: payload,
  };
}

/** Flatten MCP tool content blocks into plain text. */
function toolResultText(result) {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result
      .map((block) => {
        if (!block) return "";
        if (typeof block === "string") return block;
        if (block.type === "text" && block.text) return String(block.text);
        if (block.text) return String(block.text);
        try {
          return JSON.stringify(block);
        } catch {
          return "";
        }
      })
      .filter(Boolean)
      .join("\n");
  }
  if (result.content != null) return toolResultText(result.content);
  if (result.text) return String(result.text);
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

module.exports = {
  callMcpTool,
  toolResultText,
};
