/* /api/feed/discoverable
 *
 * Authorization: Bearer <stytch session_token>
 *
 * GET  → { discoverableAt: <iso8601> | null, pitchSlug: <slug> | null }
 * POST { optIn: true, pitchSlug: <slug> } → { discoverableAt, pitchSlug }
 * POST { optIn: false } → { discoverableAt: null, pitchSlug: null }
 *
 * The opt-in flag for the "founders" social feed surface. Stored as a
 * sibling row on TinkerUserData under a fixed kind. `discoverableAt`
 * null means "not discoverable", a timestamp means "opted in at that
 * moment". `pitchSlug` records WHICH of the founder's published
 * pitches is the one being shared with the network — the founder
 * picks from their published pitches; the picked slug is what the
 * adjacency endpoint will return to other founders as the link target.
 *
 * The timestamp (rather than a boolean) is the source of truth so we
 * can later show "opted in N days ago" without a schema change.
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

function shapeFrom(row) {
  if (!row || !row.data || typeof row.data !== "object") {
    return { discoverableAt: null, pitchSlug: null };
  }
  const at = typeof row.data.discoverableAt === "string" && row.data.discoverableAt
    ? row.data.discoverableAt
    : null;
  const slug = typeof row.data.pitchSlug === "string" && row.data.pitchSlug
    ? row.data.pitchSlug
    : null;
  // Either both are present (opted in to a specific pitch) or both
  // are null (not opted in). A timestamp without a slug shouldn't
  // happen but we collapse it to "not opted in" defensively.
  if (!at || !slug) return { discoverableAt: null, pitchSlug: null };
  return { discoverableAt: at, pitchSlug: slug };
}

function isValidSlug(s) {
  return typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s);
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
      res.status(200).json(shapeFrom(row));
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

  let data;
  if (body.optIn) {
    if (!isValidSlug(body.pitchSlug)) {
      res.status(400).json({ error: "pitchSlug is required when opting in" });
      return;
    }
    // Confirm the slug actually maps to a published pitch this user
    // owns — otherwise other founders would see broken links.
    try {
      const pub = await prisma.tinkerUserData.findUnique({
        where: { userId_kind: { userId, kind: `published:${body.pitchSlug}` } },
      });
      if (!pub) {
        res.status(400).json({ error: "Pick a pitch you've already published." });
        return;
      }
    } catch (err) {
      res.status(500).json({ error: err.message || "Internal error" });
      return;
    }
    data = {
      discoverableAt: new Date().toISOString(),
      pitchSlug: body.pitchSlug,
    };
  } else {
    data = { discoverableAt: null, pitchSlug: null };
  }

  try {
    await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: DISCOVERABLE_KIND } },
      create: { userId, kind: DISCOVERABLE_KIND, data },
      update: { data },
    });
    res.status(200).json({
      discoverableAt: data.discoverableAt,
      pitchSlug: data.pitchSlug,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

module.exports = withResponseLogging(handler);
module.exports._raw = handler;
module.exports._DISCOVERABLE_KIND = DISCOVERABLE_KIND;
