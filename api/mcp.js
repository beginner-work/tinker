/* POST /api/mcp
 *
 * Streamable HTTP MCP (stateless JSON responses) on the tinker deploy.
 * Authorization: Bearer <stytch session_token | session_jwt | mcp_ credential>
 *   Session bearers use authenticateSession, the same check as
 *   POST /api/claude/converse. A bearer that starts with mcp_ is checked
 *   against the hashed McpApiKey row and is never sent to Stytch.
 *   Revoked credentials fail on the next request.
 *   A missing or rejected bearer is 401 with resource_metadata so an
 *   MCP client can send the user to /mcp/authorize.
 *
 * Tools are fixed-prompt follow-ups (ask_followups), LinkedIn drafts
 * (draft_linkedin_post), a read-only look at this user's autonomy
 * settings (get_autonomy_settings), and the career record
 * (get_career_record, check_text). There is no raw converse proxy and
 * no write tool for autonomy settings or the career record. GET/DELETE
 * return 405: this server does not keep an SSE session. The writing UI
 * is not involved. draft_linkedin_post shares api/_lib/linkedin-draft.js
 * with POST /api/claude/converse mode "linkedin". It does not post.
 *
 * Session auth uses STYTCH_PROJECT_ID and STYTCH_SECRET. Tool calls use
 * ANTHROPIC_API_KEY. Credentials use the existing DATABASE_URL.
 * Approve and revoke live on /mcp/authorize and /mcp/access.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { isMcpApiKey, authenticateMcpKey, userIdFromSession } = require("./_lib/mcp-keys.js");
const { wwwAuthenticate } = require("./_lib/mcp-origin.js");
const { withResponseLogging } = require("./_lib/log.js");
const { askFollowups } = require("./_lib/followups.js");
const { draftLinkedInPost } = require("./_lib/linkedin-draft.js");
const { toolSettings } = require("./_lib/autonomy.js");
const { UNAVAILABLE, readAll } = require("./_lib/autonomy-redis.js");
const { UNAVAILABLE: CAREER_UNAVAILABLE, readForTool, shapeForTool } = require("./_lib/career.js");
const { checkText } = require("./_lib/career-check.js");
const pkg = require("../package.json");

const SUPPORTED_PROTOCOLS = ["2025-03-26", "2025-06-18"];
const DEFAULT_PROTOCOL = "2025-03-26";

const INSTRUCTIONS = [
  "tinker tools for founder writing and Tyler's LinkedIn drafts. The writing UI is separate and unchanged.",
  "Call ask_followups with a transcript of {q, a} turns to run the founder interview",
  "(one next question, or a stitch when the draft is ready), or with a draft string",
  "for freeform follow-up questions. Optional priorTurns avoids repeats.",
  "Call draft_linkedin_post with notes (a topic or bullets) to draft a LinkedIn post or direct message in Tyler's voice.",
  "Pass kind \"dm\" for a direct message, or start the notes with \"DM:\". Pass currentDraft and an optional instruction to revise.",
  "This drafts copy only. It does not post to LinkedIn.",
  "Call get_autonomy_settings with no arguments to read this user's autonomy settings.",
  "It returns each setting's key, label, description, on (true or false), and updated_at.",
  "It does not change a setting. If it says settings are unavailable, treat every setting as off.",
  "Call get_career_record with no arguments to read this user's career record.",
  "Verified facts and answer rules include ids. Unverified facts are marked and are not facts. Do not use them.",
  "Rejected facts are omitted. If the record is unavailable, do not invent an empty record.",
  "Call check_text with text, and optional company and field_label, to check a draft.",
  "Each claim is pass, mismatch, unsupported, or needs_claire. ready is true only when every claim passes. An empty draft, or a draft with no claims, is not ready.",
  "These career tools do not write. There is no tool that verifies or edits a fact.",
  "This server does not accept a custom system prompt.",
  "Add this server by its URL. The client sends you to tinker to approve access.",
  "After you approve, the client stores a credential that starts with mcp_. It works until you revoke it from MCP access.",
  "A Stytch session still works for the writing app. A 401 means the credential is missing or revoked.",
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

const DRAFT_LINKEDIN_TOOL = {
  name: "draft_linkedin_post",
  title: "Draft a LinkedIn post or DM",
  description: [
    "Draft or revise a LinkedIn post or direct message in Tyler's voice for Elevating Developer Fintech.",
    "Pass notes: a topic or bullet points. The server owns the voice and niche prompt (short plain sentences, no em dashes).",
    "Pass kind \"dm\" for a direct message. Omit kind, or pass \"post\", for a feed post. Notes that start with \"DM:\" also draft a message.",
    "Pass currentDraft to revise an existing draft, and an optional instruction for what to change.",
    "Returns the copy only. Does not post, schedule, or publish to LinkedIn. Stanley posts.",
    "Do not send a system prompt.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      notes: {
        type: "string",
        description: "Topic or bullet notes the post or DM should be built from.",
      },
      kind: {
        type: "string",
        enum: ["post", "dm"],
        description: "post (default) or dm. A direct message uses the same voice and does not read like a feed post.",
      },
      currentDraft: {
        type: "string",
        description: "Existing draft to revise. Omit to write a new post or DM from the notes.",
      },
      instruction: {
        type: "string",
        description: "Optional change request: length, emphasis, post vs DM, or what to cut. Cannot ask the tool to publish.",
      },
    },
    required: ["notes"],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
};

const GET_AUTONOMY_SETTINGS_TOOL = {
  name: "get_autonomy_settings",
  title: "Read autonomy settings",
  description: [
    "Return the on or off state of this connector user's 14 autonomy settings.",
    "Takes no input. The user is the person who approved this connector, not a user id in the arguments.",
    "Each setting includes key, label, description, on, and updated_at (when it last changed, or null).",
    "Three sending settings also include send_note.",
    "on true means a bot may do that item on its own. A setting with nothing stored is off.",
    "If the tool returns an error that settings are unavailable, treat every setting as off.",
    "This does not change any setting.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

const GET_CAREER_RECORD_TOOL = {
  name: "get_career_record",
  title: "Read the career record",
  description: [
    "Return this connector user's career record.",
    "Takes no input. The user is the person who approved this connector. A user id in the arguments is ignored.",
    "verified_facts and rules include ids and may be used as facts.",
    "unverified_facts are proposed only. They are not facts. Do not use them in applications or outreach.",
    "Rejected facts are omitted.",
    "If the tool returns an error that the career record is unavailable, do not treat that as an empty record.",
    "This does not verify, edit, or reject anything.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

const CHECK_TEXT_TOOL = {
  name: "check_text",
  title: "Check a draft against the career record",
  description: [
    "Check a draft application answer or outreach note against this connector user's career record.",
    "Pass text. Optional company and field_label add form context.",
    "Returns every factual claim with verdict pass, mismatch, unsupported, or needs_claire.",
    "pass and mismatch include the matching fact or rule id. mismatch includes the correct value.",
    "ready is true only when every claim passes. An empty draft, or a draft with no claims, is not ready.",
    "A title passes only when the employer on that same fact matches. Baseline and mechanism numbers are compared to the verified amount, percentage, and baseline.",
    "Visa, work authorization, EEO, demographic answers, and a field with no rule return needs_claire.",
    "This does not write to the record.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      text: {
        type: "string",
        description: "Draft application answer or outreach note to check.",
      },
      company: {
        type: "string",
        description: "Optional company the draft is for.",
      },
      field_label: {
        type: "string",
        description: "Optional form field label, such as Current location or Work authorization.",
      },
    },
    required: ["text"],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
};

const TOOLS = [
  ASK_FOLLOWUPS_TOOL,
  DRAFT_LINKEDIN_TOOL,
  GET_AUTONOMY_SETTINGS_TOOL,
  GET_CAREER_RECORD_TOOL,
  CHECK_TEXT_TOOL,
];
const NO_STORE = { "Cache-Control": "no-store" };

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

// mcp_ keys stay off the Stytch path, including typos. A dotted session
// JWT never starts with mcp_, so the two bearers do not overlap.
// Either bearer resolves to the Tinker user it belongs to.
async function authorize(token) {
  if (!token) {
    throw Object.assign(new Error("Missing token."), { status: 401 });
  }
  if (isMcpApiKey(token)) {
    const key = await authenticateMcpKey(token);
    return { userId: key.userId };
  }
  const session = await authenticateSession(token);
  const userId = userIdFromSession(session);
  if (!userId) {
    throw Object.assign(new Error("Session missing user id."), { status: 401 });
  }
  return { userId };
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

// McpApiKey.userId is session.user_id from connector approval
// (userIdFromSession). Autonomy hashes use that same session.user_id
// (callerFromSession). The tool reads autonomy:<that id> and ignores
// any user id in the arguments.
async function autonomyCall(msg, user) {
  try {
    const userId = user && typeof user.userId === "string" ? user.userId : "";
    if (!userId) throw new Error("missing user");
    const shaped = toolSettings(await readAll(userId));
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, {
        content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
        structuredContent: shaped,
      }),
    };
  } catch {
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError(UNAVAILABLE)),
    };
  }
}

async function careerReadCall(msg, user) {
  try {
    const userId = user && typeof user.userId === "string" ? user.userId : "";
    if (!userId) throw new Error("missing user");
    const shaped = shapeForTool(await readForTool(userId));
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, {
        content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
        structuredContent: shaped,
      }),
    };
  } catch {
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError(CAREER_UNAVAILABLE)),
    };
  }
}

async function careerCheckCall(msg, user, args) {
  if (!args || typeof args.text !== "string") {
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError("text is required.")),
    };
  }
  try {
    const userId = user && typeof user.userId === "string" ? user.userId : "";
    if (!userId) throw new Error("missing user");
    const record = await readForTool(userId);
    let shaped;
    try {
      shaped = await checkText({
        record,
        text: args.text,
        company: typeof args.company === "string" ? args.company : "",
        field_label: typeof args.field_label === "string" ? args.field_label : "",
      });
    } catch {
      return {
        status: 200,
        headers: NO_STORE,
        body: rpcOk(msg.id, toolError("Could not check that text.")),
      };
    }
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, {
        content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
        structuredContent: shaped,
      }),
    };
  } catch {
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError(CAREER_UNAVAILABLE)),
    };
  }
}

async function handleRpc(msg, user) {
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
    return { status: 200, body: rpcOk(msg.id, { tools: TOOLS }) };
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
    if (
      name !== "ask_followups"
      && name !== "draft_linkedin_post"
      && name !== "get_autonomy_settings"
      && name !== "get_career_record"
      && name !== "check_text"
    ) {
      return {
        status: 200,
        body: rpcOk(msg.id, toolError(`Unknown tool: ${name || "(missing)"}`)),
      };
    }
    if (name === "get_autonomy_settings") {
      return autonomyCall(msg, user);
    }
    if (name === "get_career_record") {
      return careerReadCall(msg, user);
    }
    if (name === "check_text") {
      return careerCheckCall(msg, user, args);
    }
    try {
      if (name === "draft_linkedin_post") {
        const shaped = await draftLinkedInPost(args);
        return {
          status: 200,
          body: rpcOk(msg.id, {
            content: [{ type: "text", text: shaped.post }],
            structuredContent: shaped,
          }),
        };
      }
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
  let caller;
  try {
    caller = await authorize(token); // principal is the approving user, or the session user
  } catch (err) {
    const status = err.status || 401;
    const extra = status === 401 ? { "WWW-Authenticate": wwwAuthenticate(req) } : undefined;
    sendJson(res, status, { error: err.message || "Unauthorized" }, protocolFrom(req), extra);
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

  const outcome = await handleRpc(parsed.message, caller);
  const protocol = outcome.protocol || protocolFrom(req);
  if (outcome.empty) {
    sendEmpty(res, outcome.status, protocol);
    return;
  }
  sendJson(res, outcome.status, outcome.body, protocol, outcome.headers);
});
