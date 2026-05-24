/* /api/feed/discoverable
 *
 * Authorization: Bearer <stytch session_token>
 *
 * GET  → { discoverableAt: <iso8601> | null }
 * POST { optIn: true|false } → { discoverableAt: <iso8601> | null }
 *
 * The opt-in flag for the "founders" social feed surface. Stored as a
 * sibling row on TinkerUserData under a fixed kind — null means "not
 * discoverable", a timestamp means "opted in at that moment". The
 * timestamp (rather than a boolean) is the source of truth so we can
 * later show "opted in N days ago" without a schema change.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

const DISCOVERABLE_KIND = "discoverable";

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
      if (total > 4096) {
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

function discoverableAtFrom(row) {
  if (!row || !row.data || typeof row.data !== "object") return null;
  const v = row.data.discoverableAt;
  if (typeof v === "string" && v) return v;
  return null;
}

async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    const token = extractBearer(req.headers && req.headers.authorization);
    const session = await authenticateSession(token);
    userId =
      (session && session.session && session.session.user_id) ||
      (session && session.user && session.user.user_id) ||
      "";
    if (!userId) {
      throw Object.assign(new Error("Session missing user id"), { status: 401 });
    }
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  if (req.method === "GET") {
    try {
      const row = await prisma.tinkerUserData.findUnique({
        where: { userId_kind: { userId, kind: DISCOVERABLE_KIND } },
      });
      res.status(200).json({ discoverableAt: discoverableAtFrom(row) });
    } catch (err) {
      res.status(500).json({ error: err.message || "Internal error" });
    }
    return;
  }

  let body;
  try { body = await readJsonBody(req); }
  catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Bad request" });
    return;
  }
  if (!body || typeof body !== "object" || typeof body.optIn !== "boolean") {
    res.status(400).json({ error: "optIn (boolean) is required" });
    return;
  }

  const data = body.optIn
    ? { discoverableAt: new Date().toISOString() }
    : { discoverableAt: null };

  try {
    await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: DISCOVERABLE_KIND } },
      create: { userId, kind: DISCOVERABLE_KIND, data },
      update: { data },
    });
    res.status(200).json({ discoverableAt: data.discoverableAt });
  } catch (err) {
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

module.exports = withResponseLogging(handler);
module.exports._raw = handler;
module.exports._DISCOVERABLE_KIND = DISCOVERABLE_KIND;
