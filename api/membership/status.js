/* GET /api/membership/status — does the signed-in user have an active
 * pre-seed membership? The tinker client calls this to unlock paid surfaces
 * (viewing other founders' pitches/essays, creating a profile).
 */

"use strict";

const { withResponseLogging } = require("../_lib/log.js");
const { resolveUserId } = require("../_lib/user-data.js");
const { readMembership, isActiveMembership } = require("../_lib/membership.js");

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
    const data = await readMembership(userId);
    res.status(200).json({
      active: isActiveMembership(data),
      tier: (data && data.tier) || null,
      status: (data && data.status) || null,
      currentPeriodEnd: (data && data.currentPeriodEnd) || null,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
