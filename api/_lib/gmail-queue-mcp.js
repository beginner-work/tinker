/* MCP tools for the assistant's Gmail connector (TYL-66).
 * list_send_queue / mark_sent / mark_send_failed / add_reply.
 * No tool queues or approves a send — only the owner's Send button does.
 */
"use strict";

const store = require("./leads-store.js");
const replies = require("./lead-replies-store.js");

const LIST_SEND_QUEUE_TOOL = {
  name: "list_send_queue",
  title: "List Gmail send queue",
  description: [
    "List Gmail messages this owner queued to send from Tinker.",
    "Each item includes messageId, to, subject, body, fromAddress, queuedAt,",
    "gmailThreadId (if any), and lead { id, personName, email, company }.",
    "Send each through the owner's Gmail connector, then call mark_sent or mark_send_failed.",
    "This tool does not send email and cannot queue or approve a send.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

const MARK_SENT_TOOL = {
  name: "mark_sent",
  title: "Mark queued Gmail as sent",
  description: [
    "After you send a queued Gmail message through the owner's Gmail connector,",
    "call mark_sent with the Tinker messageId and the Gmail message/thread ids.",
    "Only queued messages owned by this connector user can be marked sent.",
    "This tool does not send email and cannot queue a send.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      messageId: { type: "string", description: "Tinker draft id from list_send_queue." },
      gmailMessageId: { type: "string", description: "Gmail API message id after send." },
      gmailThreadId: { type: "string", description: "Gmail API thread id after send." },
      sentAt: { type: "string", description: "ISO timestamp when sent. Optional." },
    },
    required: ["messageId", "gmailMessageId", "gmailThreadId"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const MARK_SEND_FAILED_TOOL = {
  name: "mark_send_failed",
  title: "Mark queued Gmail send failed",
  description: [
    "If sending a queued Gmail message failed, call mark_send_failed with the",
    "Tinker messageId and a short reason. The owner can edit and re-queue.",
    "This tool does not send email and cannot queue a send.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      messageId: { type: "string", description: "Tinker draft id from list_send_queue." },
      reason: { type: "string", description: "Short failure reason for the owner." },
    },
    required: ["messageId", "reason"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const ADD_REPLY_TOOL = {
  name: "add_reply",
  title: "Add a Gmail reply to a lead thread",
  description: [
    "When a reply arrives on a Gmail thread Tinker started, call add_reply so it",
    "shows as a left bubble in that lead's thread. Pass leadId or gmailThreadId,",
    "plus from, body, receivedAt, and gmailMessageId. Duplicate gmailMessageId is a no-op.",
    "This tool does not send email and cannot queue a send.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      leadId: { type: "string", description: "Tinker lead id. Optional if gmailThreadId is set." },
      gmailThreadId: { type: "string", description: "Gmail thread id from a prior mark_sent." },
      from: { type: "string", description: "Reply from address." },
      body: { type: "string", description: "Reply body text." },
      receivedAt: { type: "string", description: "ISO timestamp when the reply was received." },
      gmailMessageId: { type: "string", description: "Gmail message id for dedupe." },
    },
    required: ["body", "gmailMessageId"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const TOOLS = [LIST_SEND_QUEUE_TOOL, MARK_SENT_TOOL, MARK_SEND_FAILED_TOOL, ADD_REPLY_TOOL];
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

function ok(msg, shaped) {
  return {
    status: 200,
    headers: { "Cache-Control": "no-store" },
    body: {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
        structuredContent: shaped,
      },
    },
  };
}

function fail(msg, message) {
  return {
    status: 200,
    headers: { "Cache-Control": "no-store" },
    body: {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: message }],
        isError: true,
      },
    },
  };
}

async function callTool(msg, user, name, args) {
  const userId = user && typeof user.userId === "string" ? user.userId : "";
  if (!userId) return fail(msg, "Sign in to tinker first.");
  const emailHint = "";
  try {
    if (name === "list_send_queue") {
      const queue = await store.listSendQueue({ userId, emailHint });
      return ok(msg, { queue });
    }
    if (name === "mark_sent") {
      const result = await store.markDraftSentByAssistant({
        userId,
        emailHint,
        messageId: args.messageId,
        gmailMessageId: args.gmailMessageId,
        gmailThreadId: args.gmailThreadId,
        sentAt: args.sentAt,
      });
      return ok(msg, {
        draft: store.presentDraft(result.draft),
        lead: result.lead ? store.presentLead(result.lead) : null,
      });
    }
    if (name === "mark_send_failed") {
      const result = await store.markDraftSendFailed({
        userId,
        emailHint,
        messageId: args.messageId,
        reason: args.reason,
      });
      return ok(msg, { draft: store.presentDraft(result.draft) });
    }
    if (name === "add_reply") {
      const result = await replies.addReply({
        userId,
        leadId: args.leadId,
        gmailThreadId: args.gmailThreadId,
        from: args.from,
        body: args.body,
        receivedAt: args.receivedAt,
        gmailMessageId: args.gmailMessageId,
      });
      return ok(msg, { reply: result.reply, deduped: result.deduped });
    }
    return fail(msg, `Unknown tool: ${name}`);
  } catch (err) {
    const status = err && err.status;
    if (status && status >= 400 && status < 500) return fail(msg, err.message || "Bad request");
    return fail(msg, err && err.message ? err.message : store.UNAVAILABLE);
  }
}

module.exports = { TOOLS, TOOL_NAMES, callTool, LIST_SEND_QUEUE_TOOL, MARK_SENT_TOOL, MARK_SEND_FAILED_TOOL, ADD_REPLY_TOOL };
