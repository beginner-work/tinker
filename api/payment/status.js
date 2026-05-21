/* GET /api/payment/status
 *
 * Authorization: Bearer <stytch session_token>
 * Reply: { isSubscribed: boolean, currentPeriodEnd: number | null }
 *
 * The renderer calls this on page load to populate
 * window.tinkerAuth.isSubscribed(). Subscription state is server-side
 * authoritative — the renderer caches the last-known value in
 * localStorage for instant reads, but always re-fetches on boot.
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

async function resolveUserId(token) {
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

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = extractBearer(req.headers && req.headers.authorization);
  let userId;
  try {
    userId = await resolveUserId(token);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  let row = null;
  try {
    row = await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId, kind: "subscription" } },
    });
  } catch {
    row = null;
  }

  const sub = (row && row.data && row.data.sharpening) || null;
  let isSubscribed = false;
  let currentPeriodEnd = null;
  if (sub && sub.status === "active") {
    if (sub.currentPeriodEnd && Number.isFinite(sub.currentPeriodEnd)) {
      isSubscribed = sub.currentPeriodEnd * 1000 > Date.now();
      currentPeriodEnd = sub.currentPeriodEnd;
    } else {
      // No period-end stored (webhook hadn't resolved subscription
      // details yet) — trust the active flag.
      isSubscribed = true;
    }
  }

  res.status(200).json({ isSubscribed, currentPeriodEnd });
});
