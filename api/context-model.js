/* /api/context-model
 *
 * Context model of what the signed-in user understands.
 *
 *   GET  /api/context-model              → inferred beliefs + graph + recent signals
 *   GET  /api/context-model?action=read  → same
 *   POST /api/context-model?action=signal → ingest honest_statement | reading | ask | skip | …
 *   POST /api/context-model?action=concept → upsert a concept node (signed-in)
 *
 * Auth: Stytch session Bearer. Users always see what was inferred about them.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { withResponseLogging } = require("./_lib/log.js");
const { readJsonBody } = require("./_lib/user-data.js");
const defaultPrisma = require("./_lib/db.js");
const store = require("./_lib/context-model/store.js");
const path = require("node:path");
const cm = require(path.join(
  __dirname,
  "..",
  "packages",
  "context-model",
  "src",
  "index.js",
));

function actionOf(req) {
  try {
    const q = req.query && req.query.action;
    if (typeof q === "string" && q) return q;
    return (
      new URL(req.url || "/", "https://tinker.local").searchParams.get(
        "action",
      ) || ""
    );
  } catch {
    return "";
  }
}

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function createHandler(deps) {
  const prisma = (deps && deps.prisma) || defaultPrisma;
  const authenticate =
    (deps && deps.authenticateSession) || authenticateSession;
  const readBody = (deps && deps.readJsonBody) || readJsonBody;
  const ingest = (deps && deps.ingestSignal) || store.ingestSignal;
  const readCtx = (deps && deps.readUserContext) || store.readUserContext;
  const ensureConcept = (deps && deps.ensureConcept) || store.ensureConcept;
  const scoreDepth = (deps && deps.scoreDepth) || cm.scoreDepth;
  const resolveJev = (deps && deps.resolveJevConfig) || cm.resolveJevConfig;

  async function resolveUserId(req) {
    const token = extractBearer(
      (req.headers && (req.headers.authorization || req.headers.Authorization)) ||
        "",
    );
    if (!token || token.startsWith("mcp_")) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }
    const session = await authenticate(token);
    const userId =
      (session && session.session && session.session.user_id) ||
      (session && session.user && session.user.user_id) ||
      "";
    if (!userId) {
      throw Object.assign(new Error("Session missing user id"), { status: 401 });
    }
    return userId;
  }

  return withResponseLogging(async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    let userId;
    try {
      userId = await resolveUserId(req);
    } catch (err) {
      res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
      return;
    }

    const action = actionOf(req) || (req.method === "GET" ? "read" : "");

    try {
      if (req.method === "GET" && (action === "read" || action === "")) {
        const ctx = await readCtx(prisma, userId);
        res.status(200).json(ctx);
        return;
      }

      if (req.method === "POST" && action === "signal") {
        const body = await readBody(req);
        const batch = cm.parseSignalBatch(body);
        const results = [];
        for (const signal of batch) {
          let applyOpts = {};
          if (
            signal.type === "honest_statement" &&
            body.useJev !== false &&
            resolveJev().available &&
            signal.conceptIds.length
          ) {
            try {
              const conceptTitle = signal.conceptIds[0];
              const scored = await scoreDepth({
                conceptTitle,
                state: {
                  honest_statement: signal.text,
                  conceptIds: signal.conceptIds,
                },
              });
              applyOpts = {
                depthScore: scored.depth,
                depthConfidence: scored.confidence,
              };
            } catch (err) {
              // Fall back to heuristic update; surface Jev skip reason.
              applyOpts = {
                jevSkipped: err && err.message ? err.message : String(err),
              };
            }
          }
          results.push(await ingest(prisma, userId, signal, applyOpts));
        }
        const ctx = await readCtx(prisma, userId);
        res.status(200).json({ ok: true, results, context: ctx });
        return;
      }

      if (req.method === "POST" && action === "concept") {
        const body = await readBody(req);
        const row = await ensureConcept(prisma, body.concept || body);
        res.status(200).json({ concept: row });
        return;
      }

      res.setHeader("Allow", "GET, POST");
      res.status(405).json({ error: "Method or action not allowed" });
    } catch (err) {
      const status = err && err.status ? err.status : 500;
      res.status(status).json({
        error: err && err.message ? err.message : "Internal error",
      });
    }
  });
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
