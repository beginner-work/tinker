/* POST /api/claude/converse
 *
 * Authorization: Bearer <stytch session_token>
 * Body: { system, messages, model, maxTokens, tools?, tool_choice?,
 *         output_config?, output_format? }
 * Reply: { text, usage, toolUse?, structured?, stop_reason? }
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
 *
 * mode: "linkedin" is the exception. The browser sends notes (and an
 * optional current draft, change request, and kind) and the server
 * applies the fixed LinkedIn prompt in api/_lib/linkedin-draft.js.
 * A client system prompt is ignored. The MCP tool draft_linkedin_post
 * calls that same function. Neither path posts to LinkedIn.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { userIdFromSession } = require("../_lib/mcp-keys.js");
const { withResponseLogging } = require("../_lib/log.js");
const { callAnthropic } = require("../_lib/anthropic.js");
const { draftLinkedInPost } = require("../_lib/linkedin-draft.js");
const {
  buildAnthropicMcpAttachment,
} = require("../_lib/mcp-connection-store.js");

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
  let session;
  try {
    session = await authenticateSession(token);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }
  const userId = userIdFromSession(session);

  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  if (body.mode === "linkedin") {
    try {
      const shaped = await draftLinkedInPost({
        notes: body.notes,
        currentDraft: body.currentDraft,
        instruction: body.instruction,
        kind: body.kind,
      });
      res.status(200).json(shaped);
    } catch (err) {
      const status = err.status || (err.toolError ? 400 : 502);
      res.status(status).json({ error: err.message || "Upstream error" });
    }
    return;
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  try {
    // Client shim historically sent max_tokens; older docs said maxTokens.
    const maxTokens = body.maxTokens != null ? body.maxTokens : body.max_tokens;
    let tools = Array.isArray(body.tools) ? body.tools.slice() : [];
    let mcpServers = Array.isArray(body.mcp_servers) ? body.mcp_servers.slice() : [];

    // Attach outbound MCP connectors (e.g. Notion) when the user has
    // connected them. Read-only tools by default; write tools only after
    // an explicit Connections UI confirm. Skip when the client already
    // sent mcp_servers (tests / advanced callers), or when mcpAttach is
    // explicitly false.
    if (userId && body.mcpAttach !== false && mcpServers.length === 0) {
      try {
        const attached = await buildAnthropicMcpAttachment({ userId });
        if (attached.mcp_servers && attached.mcp_servers.length) {
          mcpServers = attached.mcp_servers;
          tools = tools.concat(attached.tools || []);
        }
      } catch {
        /* Connections are optional; never fail the writing turn. */
      }
    }

    const result = await callAnthropic({
      system: body.system,
      messages,
      model: body.model,
      maxTokens,
      tools: tools.length ? tools : body.tools,
      tool_choice: body.tool_choice,
      output_config: body.output_config,
      output_format: body.output_format,
      mcp_servers: mcpServers.length ? mcpServers : undefined,
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Upstream error" });
  }
});
