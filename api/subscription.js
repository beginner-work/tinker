/* GET /api/subscription
 *
 * The founder's current plan tier, read from the shared user-data store
 * where beginner's Stripe webhook keeps it in sync. Stripe is the source
 * of truth: every subscription change (checkout completed, renewed,
 * cancelled, payment failed) is written by beginner into TinkerUserData
 * under (userId, "subscription"); this endpoint just reads it back for
 * the authenticated founder so the client can reconcile its optimistic
 * local cache.
 *
 * Auth: Stytch session token (Bearer), same as /api/user-data/*.
 *
 * Reply (200): { tier: "free" | "pre-seed", active: boolean, updatedAt }
 *
 * A founder with no subscription row reads as the free tier.
 */

"use strict";

const prisma = require("./_lib/db.js");
const { resolveUserId } = require("./_lib/user-data.js");
const { withResponseLogging } = require("./_lib/log.js");

const KIND = "subscription";
const PAID_TIERS = new Set(["pre-seed"]);

module.exports = withResponseLogging(async function handler(req, res) {
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
      where: { userId_kind: { userId, kind: KIND } },
    });
    const data = row && row.data ? row.data : null;
    const tier = data && typeof data.tier === "string" ? data.tier : "free";
    res.status(200).json({
      tier,
      active: PAID_TIERS.has(tier),
      updatedAt: row ? row.updatedAt : null,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
