/* Shared GET/PUT handler factory for /api/user-data/<kind>.
 *
 * Each kind (essays, drafts, seeds, taxonomy) is one row in the shared
 * TinkerUserData table keyed by (userId, kind). The client owns the
 * inner shape — the server just round-trips JSON.
 *
 * Auth: every request re-validates against Stytch (same pattern as
 * /api/search and /api/claude/converse) and pulls the user_id out of
 * the session response. No JWT clock, no client trust.
 */

"use strict";

const { authenticateSession } = require("./stytch.js");
const prisma = require("./db.js");
const { withResponseLogging } = require("./log.js");

// Cap the JSON payload at 256 KB. The whole-blob semantics mean even
// busy users (hundreds of essays) stay well under this; anything larger
// is almost certainly a bug.
const MAX_BYTES = 256 * 1024;

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

async function resolveUserId(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  const session = await authenticateSession(token);
  const userId =
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    "";
  if (!userId) {
    throw Object.assign(new Error("Session missing user id"), { status: 401 });
  }
  return userId;
}

function makeHandler(kind) {
  return withResponseLogging(async function handler(req, res) {
    if (req.method !== "GET" && req.method !== "PUT") {
      res.setHeader("Allow", "GET, PUT");
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    let userId;
    try {
      userId = await resolveUserId(req);
    } catch (err) {
      res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
      return;
    }

    try {
      if (req.method === "GET") {
        const row = await prisma.tinkerUserData.findUnique({
          where: { userId_kind: { userId, kind } },
        });
        // `data` defaults to null at the column level; clients should
        // treat null as "nothing stored yet" and use their own default.
        res.status(200).json({ data: row ? row.data : null, updatedAt: row ? row.updatedAt : null });
        return;
      }

      const body = await readJsonBody(req);
      if (!body || !Object.prototype.hasOwnProperty.call(body, "data")) {
        res.status(400).json({ error: "Body must include a `data` field" });
        return;
      }
      const data = body.data;

      const saved = await prisma.tinkerUserData.upsert({
        where: { userId_kind: { userId, kind } },
        create: { userId, kind, data },
        update: { data },
      });
      res.status(200).json({ ok: true, updatedAt: saved.updatedAt });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message || "Internal error" });
    }
  });
}

module.exports = { makeHandler };
