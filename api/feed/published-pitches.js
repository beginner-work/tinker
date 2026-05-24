/* GET /api/feed/published-pitches
 *
 * Authorization: Bearer <stytch session_token>
 * Reply: { pitches: [ { slug, title, updatedAt }, ... ] }
 *
 * Lists the founder's published pitches so the founders surface can
 * render a picker — "which of your pitches do you want to share with
 * the founder network?". Slugs come from kind="published:<slug>"
 * rows; titles + updatedAt come from the row's data blob (set by
 * /api/publish/pitch). Most-recently-published first.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

  try {
    const rows = await prisma.tinkerUserData.findMany({
      where: { userId, kind: { startsWith: "published:" } },
      orderBy: { updatedAt: "desc" },
    });
    const pitches = [];
    for (const row of rows) {
      const d = row.data || {};
      const slug = typeof d.slug === "string" && d.slug
        ? d.slug
        : row.kind.slice("published:".length);
      const title = typeof d.title === "string" && d.title.trim() ? d.title.trim() : slug;
      pitches.push({ slug, title, updatedAt: row.updatedAt });
    }
    res.status(200).json({ pitches });
  } catch (err) {
    res.status(500).json({ error: err.message || "Internal error" });
  }
}

module.exports = withResponseLogging(handler);
module.exports._raw = handler;
