/* POST /api/mcp
 *
 * Streamable HTTP MCP (stateless JSON responses) on the tinker deploy.
 * Authorization: Bearer <stytch session_token | session_jwt>
 *   — the same check as POST /api/claude/converse.
 *
 * Tools are fixed-prompt follow-ups (ask_followups). There is no raw
 * converse proxy. GET/DELETE return 405: this server does not keep an
 * SSE session. The writing UI is not involved.
 *
 * No new environment variables. Uses STYTCH_PROJECT_ID, STYTCH_SECRET,
 * and ANTHROPIC_API_KEY.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { withResponseLogging } = require("./_lib/log.js");
const { askFollowups } = require("./_lib/followups.js");
const pkg = require("../package.json");

const SUPPORTED_PROTOCOLS = ["2025-03-26", "2025-06-18"];
const DEFAULT_PROTOCOL = "2025-03-26";

const INSTRUCTIONS = [
  "tinker follow-ups for founder writing. The writing UI is separate and unchanged.",
  "Call ask_followups with a transcript of {q, a} turns to run the founder interview",
  "(one next question, or a stitch when the draft is ready), or with a draft string",
  "for freeform follow-up questions. Optional priorTurns avoids repeats.",
  "This server does not accept a custom system prompt.",
  "Authenticate with the same Stytch bearer the writing app uses (session_token or session_jwt).",
  "Sessions expire; a 401 means sign in again.",
].join(" ");

const ASK_FOLLOWUPS_TOOL = {
  name: "ask_followups",
  title: "Ask follow-up questions",
  description: [
    "Return follow-up questions for founder writing.",
    "Pass transcript (array of {q, a}) to run tinker's interview contract:",
    "the result is JSON with next_question, optional stitched essay fields, and done.",
    "Pass draft (string) instead for 3–5 freeform questions about what the writer is learning.",
    "Optional priorTurns (strings or {q, a}) are questions already asked.",
    "Optional seed, facing, lastPurchased, voice, transactions, and uncoveredSlides",
    "shape the interview the same way the writing UI does.",
    "Do not send a system prompt; the server owns it.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      draft: {
        type: "string",
        description: "Freeform writing. Used when transcript is omitted. Returns { questions }.",
      },
      transcript: {
        type: "array",
        description: "Founder interview turns so far. An empty array starts the interview.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string" },
            a: { type: "string" },
          },
          required: ["q", "a"],
        },
      },
      priorTurns: {
        type: "array",
        description: "Questions already asked, as strings or { q, a } objects.",
        items: {
          anyOf: [
            { type: "string" },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                q: { type: "string" },
                a: { type: "string" },
              },
              required: ["q", "a"],
            },
          ],
        },
      },
      seed: { type: "string", description: "Where the founder is right now." },
      facing: { type: "string", description: "What the founder is facing." },
      lastPurchased: { type: "string", description: "What the founder last purchased." },
      voice: {
        type: "string",
        description: "Optional writing-voice block. Shapes how questions are phrased.",
      },
      transactions: {
        type: "array",
        description: "Recent transactions, as preformatted strings or { date, merchant, amount, category }.",
        items: {},
      },
      uncoveredSlides: {
        type: "array",
        items: { type: "string" },
        description: "Starter-pitch territories the founder has not written into yet.",
      },
      forceStitch: {
        type: "boolean",
        description: "Interview mode only. Skip further questions and stitch the essay.",
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
};

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function protocolFrom(req) {
  const header = req.headers && (req.headers["mcp-protocol-version"] || req.headers["MCP-Protocol-Version"]);
  return SUPPORTED_PROTOCOLS.includes(header) ? header : DEFAULT_PROTOCOL;
}

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "MCP-Protocol-Version, WWW-Authenticate",
  );
}

function sendJson(res, status, body, protocol, extra) {
  applyCors(res);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("MCP-Protocol-Version", protocol || DEFAULT_PROTOCOL);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  }
  res.status(status).json(body);
}

function sendEmpty(res, status, protocol, extra) {
  applyCors(res);
  res.setHeader("MCP-Protocol-Version", protocol || DEFAULT_PROTOCOL);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  }
  res.status(status).end();
}

function rpcOk(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcErr(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

function toolError(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function readMessage(req) {
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (!body.trim()) return { error: "parse" };
    try {
      body = JSON.parse(body);
    } catch {
      return { error: "parse" };
    }
  }
  if (body == null) return { error: "parse" };
  if (Array.isArray(body)) return { error: "batch" };
  if (typeof body !== "object") return { error: "parse" };
  return { message: body };
}

async function handleRpc(msg) {
  if (!msg || typeof msg.method !== "string" || msg.jsonrpc !== "2.0") {
    return { status: 400, body: rpcErr(msg && msg.id, -32600, "Invalid Request") };
  }
  const method = msg.method;
  const isNotification = !Object.prototype.hasOwnProperty.call(msg, "id");
  if (isNotification || method.startsWith("notifications/")) {
    return { status: 202, empty: true };
  }

  if (method === "initialize") {
    const params = msg.params || {};
    const clientVersion = params.protocolVersion;
    const negotiated = SUPPORTED_PROTOCOLS.includes(clientVersion)
      ? clientVersion
      : DEFAULT_PROTOCOL;
    return {
      status: 200,
      protocol: negotiated,
      body: rpcOk(msg.id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tinker", version: pkg.version || "0.0.0" },
        instructions: INSTRUCTIONS,
      }),
    };
  }
  if (method === "ping") {
    return { status: 200, body: rpcOk(msg.id, {}) };
  }
  if (method === "tools/list") {
    return { status: 200, body: rpcOk(msg.id, { tools: [ASK_FOLLOWUPS_TOOL] }) };
  }
  if (method === "prompts/list") {
    return { status: 200, body: rpcOk(msg.id, { prompts: [] }) };
  }
  if (method === "resources/list") {
    return { status: 200, body: rpcOk(msg.id, { resources: [] }) };
  }
  if (method === "tools/call") {
    const params = msg.params && typeof msg.params === "object" ? msg.params : {};
    const name = params.name;
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
    if (name !== "ask_followups") {
      return {
        status: 200,
        body: rpcOk(msg.id, toolError(`Unknown tool: ${name || "(missing)"}`)),
      };
    }
    try {
      const shaped = await askFollowups(args);
      return {
        status: 200,
        body: rpcOk(msg.id, {
          content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
          structuredContent: shaped,
        }),
      };
    } catch (err) {
      if (err && (err.toolError || err.status === 502 || err.status === 503)) {
        return { status: 200, body: rpcOk(msg.id, toolError(err.message || "Tool failed")) };
      }
      return { status: 500, body: rpcErr(msg.id, -32603, "Internal error") };
    }
  }
  return { status: 200, body: rpcErr(msg.id, -32601, `Method not found: ${method}`) };
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method === "OPTIONS") {
    applyCors(res);
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return;
  }

  const token = extractBearer(req.headers && req.headers.authorization);
  try {
    await authenticateSession(token);
  } catch (err) {
    sendJson(res, err.status || 401, { error: err.message || "Unauthorized" }, protocolFrom(req), {
      "WWW-Authenticate": "Bearer",
    });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" }, protocolFrom(req), { Allow: "POST" });
    return;
  }

  const parsed = readMessage(req);
  if (parsed.error === "parse") {
    sendJson(res, 400, rpcErr(null, -32700, "Parse error"), protocolFrom(req));
    return;
  }
  if (parsed.error === "batch") {
    sendJson(
      res,
      400,
      rpcErr(null, -32600, "JSON-RPC batches are not supported"),
      protocolFrom(req),
    );
    return;
  }

  const outcome = await handleRpc(parsed.message);
  const protocol = outcome.protocol || protocolFrom(req);
  if (outcome.empty) {
    sendEmpty(res, outcome.status, protocol);
    return;
  }
  sendJson(res, outcome.status, outcome.body, protocol);
});
