/* GET /api/team/connections
 *
 * Authorization: Bearer <stytch session_token>
 * Reply: {
 *   me: <my user id>,          // so the client can stamp ?from= on send links
 *   connections: [
 *     {
 *       userId,                // the other founder
 *       name,                  // their profile name ("A founder" fallback)
 *       state,                 // "connected" | "waiting" | "incoming"
 *       at,                    // latest edge timestamp
 *     }, ...
 *   ]
 * }
 *
 * The connection model is the mutual $9 handshake (see beginner's
 * /api/pay/intent plan "send-9" and _lib/connections.js): sending
 * someone $9 is the connection request; they accept by sending $9
 * back. Beginner's Stripe webhook writes one row per user (kind
 * "connections") into the shared TinkerUserData table; this endpoint
 * reads MY row and derives:
 *
 *   connected — $9 both ways
 *   waiting   — I sent; they haven't sent back yet
 *   incoming  — they sent me $9; I accept by sending $9 back
 */

"use strict";

const { resolveUserId } = require("../_lib/user-data.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

const CONNECTIONS_KIND = "connections";
const PROFILE_KIND = "profile";

// Pure: fold my row's edges into per-founder states.
function deriveStates(row) {
  const base = row && typeof row === "object" ? row : {};
  const sent = Array.isArray(base.sent) ? base.sent : [];
  const received = Array.isArray(base.received) ? base.received : [];

  const byUser = new Map();
  const touch = (userId, dir, at) => {
    if (!userId || typeof userId !== "string") return;
    const cur = byUser.get(userId) || { sent: false, received: false, at: 0 };
    cur[dir] = true;
    cur.at = Math.max(cur.at, Number(at) || 0);
    byUser.set(userId, cur);
  };
  for (const e of sent) touch(e && e.to, "sent", e && e.at);
  for (const e of received) touch(e && e.from, "received", e && e.at);

  const out = [];
  for (const [userId, v] of byUser) {
    const state = v.sent && v.received ? "connected" : v.sent ? "waiting" : "incoming";
    out.push({ userId, state, at: v.at });
  }
  // Incoming first (they're waiting on you), then connected, then waiting.
  const rank = { incoming: 0, connected: 1, waiting: 2 };
  out.sort((a, b) => (rank[a.state] - rank[b.state]) || (b.at - a.at));
  return out;
}

const handler = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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
    const row = await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId, kind: CONNECTIONS_KIND } },
    });
    const states = deriveStates(row ? row.data : null);

    const ids = states.map((s) => s.userId);
    const profiles = ids.length
      ? await prisma.tinkerUserData.findMany({
          where: { kind: PROFILE_KIND, userId: { in: ids } },
        })
      : [];
    const nameById = new Map();
    for (const p of profiles) {
      const name = p && p.data && typeof p.data.name === "string" ? p.data.name.trim() : "";
      if (name) nameById.set(p.userId, name);
    }

    res.status(200).json({
      me: userId,
      connections: states.map((s) => ({
        userId: s.userId,
        name: nameById.get(s.userId) || "A founder",
        state: s.state,
        at: s.at,
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});

module.exports = handler;
module.exports.__test__ = { deriveStates };
