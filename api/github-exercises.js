/* POST /api/github-exercises
 *
 * GitHub storage for polished exercise goals (not attempts).
 * action=status | confirm | publish | load
 * Desktop loads polished goals from GitHub when confirmed; otherwise Tinker.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const githubExercises = require("./_lib/github-exercise-repo.js");
const workspaceStore = require("./_lib/exercise-workspace-store.js");
const progressApi = require("../src/renderer/lib/learning-progress.js");
const revision = require("../src/renderer/lib/exercise-revision.js");

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
      new Error("Connector credentials cannot manage GitHub exercises."),
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
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
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
    if (req.method === "POST") body = readBody(req);
  } catch (err) {
    send(res, err.status || 400, { error: err.message || "Bad request" });
    return;
  }
  const action =
    (body && body.action) ||
    (req.query && (req.query.action || req.query.a)) ||
    (req.method === "GET" ? "status" : "");
  try {
    if (action === "status" || req.method === "GET") {
      const status = await githubExercises.status({ userId: auth.userId });
      send(res, 200, status);
      return;
    }
    if (action === "confirm") {
      const result = await githubExercises.confirmAndEnsureRepo({
        userId: auth.userId,
        confirmed: !!(body.confirmed || body.confirm),
      });
      send(res, 200, result);
      return;
    }
    if (action === "publish") {
      const result = await githubExercises.publishPolishedGoal({
        userId: auth.userId,
        progress: body.progress || {},
        polishedContent:
          body.polishedContent != null
            ? body.polishedContent
            : body.content != null
              ? body.content
              : "",
      });
      send(res, 200, result);
      return;
    }
    if (action === "load") {
      const progress = body.progress || {
        goalId: body.goalId,
        practicePath: body.practicePath,
        exerciseId: body.exerciseId,
        goalTitle: body.goalTitle,
      };
      const result = await githubExercises.loadPolishedGoal({
        userId: auth.userId,
        progress,
      });
      // Optional: seed empty Tinker practice file from GitHub (never overwrite attempts).
      if (
        result &&
        result.ok &&
        body.hydrate !== false &&
        result.content != null &&
        String(progress.practicePath || "").trim()
      ) {
        try {
          const exerciseId =
            String(progress.exerciseId || "").trim() ||
            progressApi.DEFAULT_EXERCISE_ID ||
            "from-essays";
          const practicePath = String(progress.practicePath)
            .replace(/^\/+|\/+$/g, "")
            .replace(/\\/g, "/");
          const listed = await workspaceStore.listWorkspace({
            userId: auth.userId,
            readOnly: true,
          });
          const ws = (listed && listed.workspace) || listed || {};
          const ex = ws.exercises && ws.exercises[exerciseId];
          let existing = "";
          if (ex && Array.isArray(ex.nodes) && typeof revision.findNodeByPath === "function") {
            const node = revision.findNodeByPath(ex.nodes, practicePath);
            if (node && node.type === "file") {
              existing = String(node.content || "");
            }
          }
          if (!String(existing || "").trim()) {
            const written = await workspaceStore.writePracticePath({
              userId: auth.userId,
              exerciseId,
              practicePath,
              content: result.content,
              exerciseName: progress.goalTitle || exerciseId,
            });
            result.hydrated = true;
            result.workspace = written && written.workspace;
          } else {
            result.hydrated = false;
            result.reasonKeptAttempt = "tinker_has_content";
          }
        } catch (hydrateErr) {
          result.hydrated = false;
          result.hydrateError = hydrateErr && hydrateErr.message;
        }
      }
      send(res, 200, result);
      return;
    }
    send(res, 400, { error: "Unknown action." });
  } catch (err) {
    send(res, err.status || 500, {
      error: err.message || "Server error",
      code: err.code || undefined,
    });
  }
});
