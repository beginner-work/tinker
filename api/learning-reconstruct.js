/* POST /api/learning-reconstruct
 *
 * After a technical essay This is everything: reconstruct the desktop ZPD
 * exercise (goal stays; next prompt + starting practice file + level) via
 * Claude Opus 5.5. Idempotent per essay revision key. Persists
 * learning_progress (+ practice file) in Postgres.
 *
 * Non-blocking for the client: fire-and-forget from /repo after save.
 * The handler runs the job to completion so serverless does not drop work.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const reconstruct = require("./_lib/exercise-reconstruct.js");

function bearer(header) {
  const match = header && String(header).match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

function readBody(req) {
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (!body.trim()) return {};
    try {
      body = JSON.parse(body);
    } catch {
      throw Object.assign(new Error("Invalid JSON"), { status: 400 });
    }
  }
  if (body == null) return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
  return body;
}

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

async function resolve(req) {
  const token = bearer(req.headers && req.headers.authorization);
  if (!token) {
    throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  }
  if (token.startsWith("mcp_")) {
    throw Object.assign(
      new Error("Connector credentials cannot reconstruct learning progress."),
      { status: 401 }
    );
  }
  let session;
  try {
    session = await authenticateSession(token);
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) {
      throw Object.assign(new Error("Session expired."), { status: 401 });
    }
    throw err;
  }
  const userId = userIdFromSession(session);
  if (!userId) {
    throw Object.assign(new Error("Session missing user id."), { status: 401 });
  }
  return { userId };
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, { error: "Method not allowed" });
    return;
  }
  let auth;
  try {
    auth = await resolve(req);
  } catch (err) {
    send(res, err.status || 401, { error: err.message || "Unauthorized" });
    return;
  }
  let body = {};
  try {
    body = readBody(req);
  } catch (err) {
    send(res, err.status || 400, { error: err.message || "Bad request" });
    return;
  }
  try {
    const result = await reconstruct.reconstructLearningFromEssay({
      userId: auth.userId,
      essayId: body.essayId || body.id,
      essayBody: body.essayBody != null ? body.essayBody : body.body,
      essayUpdatedAt: body.essayUpdatedAt || body.updatedAt,
      force: !!body.force,
    });
    send(res, 200, result);
  } catch (err) {
    const status = err.status || 500;
    send(res, status, {
      error: err.message || "Server error",
      code: err.code || undefined,
    });
  }
});
